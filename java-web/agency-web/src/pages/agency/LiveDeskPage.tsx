/**
 * 在线客服工作台（迁自 frontend/agency-web/src/pages/LiveDesk.tsx）。
 *
 * 业务逻辑、UI 结构、节奏常量（15s 池子兜底 / 30s 在线状态 / 90s 活跃窗口）逐行保留，
 * 只替换了「怎么和服务器说话」这一层：
 *   - request()  → api.get/post/del，路径从 /im/** 变成 /api/im/**（BFF 透传）；
 *   - getAccessToken() → 不再存在，浏览器只带 Cookie；WS 由 BFF 桥接到 Node；
 *   - getUserId() → useAuth().me.user_id（权限与身份同源，避免两套缓存漂移）；
 *   - ImWsClient 换成 lib/imWs（去掉了 auth 帧，握手即鉴权）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/http'
import { useAuth } from '../../lib/auth'
import { ImWsClient, type ImMessageFrame, type ImNotifyFrame, type WsConnectionStatus } from '../../lib/imWs'
import { imStore, type ImStoreMessage } from '../../lib/imStore'

/* ---------------- 接口数据类型 ---------------- */

type Scope = 'pool' | 'mine' | 'closed'
type AgentPresence = 'ONLINE' | 'AWAY' | 'OFFLINE' | 'UNKNOWN'

/** GET /api/im/agent/queue 的一行 */
interface QueueRow {
  conversation_id: string
  conversation_no: string
  conversation_type: string
  title: string | null
  status: 'ACTIVE' | 'CLOSED'
  assignee_id: string | null
  assignee_name: string | null
  queued_at: string | null
  assigned_at: string | null
  closed_at: string | null
  agent_note: string | null
  last_message_seq: number
  last_message_at: string | null
  created_at: string
  counterpart_id: string | null
  counterpart_name: string | null
  counterpart_phone: string | null
  unread_count: number
  last_message_preview: string | null
  wait_seconds: number
  sla_breached: boolean
}

interface QueueResp {
  scope: Scope
  sla_seconds: number
  counters: { pool: number; mine: number; closed: number }
  list: QueueRow[]
  total: number
  has_more: boolean
}

interface PresenceRow {
  user_id: string
  online: boolean
  device_count: number
  last_seen_at: string | null
  agent_status: AgentPresence
  max_concurrent: number | null
  active_load: number
}

interface QuickReplyRow {
  id: string
  owner_id: string | null
  category: string
  content: string
  sort: number
  is_shared: boolean
}

interface RatingSummary {
  agent_id: string
  total: number
  avg_score: number | null
  distribution: Record<'5' | '4' | '3' | '2' | '1', number>
  recent: {
    id: string
    conversation_id: string
    score: number
    comment: string | null
    tags: string[] | null
    created_at: string
    rater_name: string
  }[]
}

/* ---------------- 常量与格式化 ---------------- */

const ACTIVE_WINDOW_MS = 90000
const POOL_POLL_MS = 15000
const PRESENCE_POLL_MS = 30000

const SCOPE_META: { key: Scope; label: string }[] = [
  { key: 'pool', label: '待接入' },
  { key: 'mine', label: '我的接待' },
  { key: 'closed', label: '已结束' },
]

const fmtWait = (seconds: number): string => {
  const value = Math.max(0, Math.floor(seconds))
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.floor(value / 60)}m${String(value % 60).padStart(2, '0')}s`
  return `${Math.floor(value / 3600)}h${String(Math.floor((value % 3600) / 60)).padStart(2, '0')}m`
}

const fmtTime = (value: string | null): string =>
  value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

const convTitleOf = (row: QueueRow): string => {
  if (row.counterpart_name) return row.counterpart_name
  if (row.title) return row.title
  return row.conversation_type === 'GROUP'
    ? `群聊 ${row.conversation_no.slice(-6)}`
    : `游客 ${row.conversation_no.slice(-6)}`
}

/* ---------------- 组件 ---------------- */

export default function LiveDeskPage() {
  const { me } = useAuth()
  const myId = me?.user_id ?? 'me'

  const [scope, setScope] = useState<Scope>('pool')
  const [convs, setConvs] = useState<QueueRow[]>([])
  const [counters, setCounters] = useState({ pool: 0, mine: 0, closed: 0 })
  const [slaSeconds, setSlaSeconds] = useState(120)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [activeConvId, setActiveConvId] = useState<string>('')
  const [messages, setMessages] = useState<ImStoreMessage[]>([])
  const [historyTick, setHistoryTick] = useState(0)
  const [inputText, setInputText] = useState('')
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>('disconnected')
  const [lastActive, setLastActive] = useState<Record<string, number>>({})
  const [loadError, setLoadError] = useState<string>('')
  const [actionError, setActionError] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const [presence, setPresence] = useState<Record<string, PresenceRow>>({})

  const [quickReplies, setQuickReplies] = useState<QuickReplyRow[]>([])
  const [newReply, setNewReply] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)

  const [closing, setClosing] = useState(false)
  const [closeNote, setCloseNote] = useState('')

  const [rating, setRating] = useState<RatingSummary | null>(null)

  const wsClientRef = useRef<ImWsClient | null>(null)
  const activeConvRef = useRef<string>('')
  const myIdRef = useRef<string>(myId)
  const timerMapRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  /** WS 回调是长生命周期闭包，用 ref 读最新 scope（否则 notify 里永远刷的是初始 tab） */
  const scopeRef = useRef<Scope>('pool')
  const pendingSelectRef = useRef<string>('')

  myIdRef.current = myId

  const activeConv = useMemo(
    () => convs.find((row) => row.conversation_id === activeConvId) ?? null,
    [convs, activeConvId],
  )
  const canReadHistory = Boolean(activeConv?.assignee_id)
  const activePresence =
    activeConvId && activeConv?.counterpart_id ? presence[activeConv.counterpart_id] : undefined

  /* ---------------- 队列加载（含兜底轮询） ---------------- */

  const loadQueue = useCallback(async (target: Scope) => {
    try {
      const res = await api.get<QueueResp>(
        `/api/im/agent/queue?scope=${target}&size=50&sort=-last_message_at`,
      )
      const list = res.list ?? []
      setConvs(list)
      setCounters(res.counters ?? { pool: 0, mine: 0, closed: 0 })
      setSlaSeconds(res.sla_seconds ?? 120)
      setUnread(Object.fromEntries(list.map((row) => [row.conversation_id, Number(row.unread_count ?? 0)])))
      setActiveConvId((prev) => {
        const wanted = pendingSelectRef.current
        pendingSelectRef.current = ''
        if (wanted && list.some((row) => row.conversation_id === wanted)) return wanted
        if (list.some((row) => row.conversation_id === prev)) return prev
        return list[0]?.conversation_id ?? ''
      })
      setLoadError('')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '队列加载失败')
    }
  }, [])

  useEffect(() => {
    scopeRef.current = scope
    setConvs([])
    setActiveConvId('')
    void loadQueue(scope)
    const timer = setInterval(() => {
      void loadQueue(scope)
    }, POOL_POLL_MS)
    return () => clearInterval(timer)
  }, [scope, loadQueue])

  /* ---------------- 话术 / 评分 ---------------- */

  const loadQuickReplies = useCallback(async () => {
    try {
      const rows = await api.get<QuickReplyRow[]>('/api/im/quick-replies')
      setQuickReplies(Array.isArray(rows) ? rows : [])
    } catch {
      setQuickReplies([])
    }
  }, [])

  const loadRating = useCallback(async () => {
    try {
      setRating(await api.get<RatingSummary>('/api/im/agent/ratings'))
    } catch {
      setRating(null)
    }
  }, [])

  useEffect(() => {
    void loadQuickReplies()
    void loadRating()
  }, [loadQuickReplies, loadRating])

  /* ---------------- 在线状态批量刷新 ---------------- */

  const counterpartIds = useMemo(
    () =>
      [
        ...new Set(convs.map((row) => row.counterpart_id).filter((value): value is string => Boolean(value))),
      ].join(','),
    [convs],
  )

  useEffect(() => {
    if (!counterpartIds) {
      setPresence({})
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.get<{ items: PresenceRow[] }>(`/api/im/presence?user_ids=${counterpartIds}`)
        if (!cancelled) {
          setPresence(Object.fromEntries((res.items ?? []).map((item) => [item.user_id, item])))
        }
      } catch {
        // 在线状态拿不到不影响聊天
      }
    }
    void load()
    const timer = setInterval(load, PRESENCE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [counterpartIds])

  /* ---------------- WS：一条连接服务全部会话 ---------------- */

  useEffect(() => {
    if (!me) return

    const client = new ImWsClient({
      getLastSeq: (convId) => imStore.getLastSeq(convId),
    })
    wsClientRef.current = client

    const unbindStatus = client.onStatusChange((status) => {
      setWsStatus(status)
      if (status === 'connected' && activeConvRef.current) {
        client.syncMissedMessages(activeConvRef.current)
      }
    })

    const unbindMsg = client.onMessage((msg: ImMessageFrame) => {
      const convId = String(msg.convId)
      imStore.mergeIncomingMessage(msg)
      setLastActive((prev) => ({ ...prev, [convId]: Date.now() }))
      if (convId === activeConvRef.current) {
        client.sendAck(convId, msg.seq)
      } else {
        setUnread((prev) => ({ ...prev, [convId]: (prev[convId] ?? 0) + 1 }))
      }
    })

    const unbindNotify = client.onNotify((notify: ImNotifyFrame) => {
      const convId = String(notify.convId)
      setLastActive((prev) => ({ ...prev, [convId]: Date.now() }))
      if (convId !== activeConvRef.current) {
        setUnread((prev) => ({ ...prev, [convId]: (prev[convId] ?? 0) + 1 }))
      }
      void loadQueue(scopeRef.current)
    })

    const unbindAck = client.onAck((ack) => {
      imStore.markMessageSent(ack.clientMsgId, ack.seq)
      const timer = timerMapRef.current.get(ack.clientMsgId)
      if (timer) {
        clearTimeout(timer)
        timerMapRef.current.delete(ack.clientMsgId)
      }
    })

    client.connect()

    return () => {
      unbindStatus()
      unbindMsg()
      unbindNotify()
      unbindAck()
      client.destroy()
      wsClientRef.current = null
      timerMapRef.current.forEach((timer) => clearTimeout(timer))
      timerMapRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user_id])

  /* ---------------- 当前会话切换：拉历史 + 清零未读 + 补 ack ---------------- */

  useEffect(() => {
    activeConvRef.current = activeConvId
    if (!activeConvId) {
      setMessages([])
      return
    }

    const unsubscribe = imStore.subscribe(activeConvId, (list) => setMessages(list))

    setUnread((prev) => ({ ...prev, [activeConvId]: 0 }))
    setClosing(false)
    setCloseNote('')

    if (canReadHistory) {
      void (async () => {
        try {
          const history = await api.get<unknown>(`/api/im/conversations/${activeConvId}/messages?since_id=0`)
          const list = Array.isArray(history)
            ? history
            : ((history as { list?: unknown[] })?.list ?? [])
          imStore.mergeBatch(activeConvId, list)
          const lastSeq = imStore.getLastSeq(activeConvId)
          if (lastSeq > 0) wsClientRef.current?.sendAck(activeConvId, lastSeq)
        } catch {
          // 历史拉取失败不阻塞：WS 在线消息照常收
        }
      })()
    }
    // 未接入的会话不是我的 participant，服务端会拒绝拉历史；接入后 canReadHistory 变 true 会自动补拉。

    return unsubscribe
  }, [activeConvId, canReadHistory, historyTick])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* ---------------- 发送 ---------------- */

  const executeSend = useCallback((text: string, existingClientMsgId?: string) => {
    const convId = activeConvRef.current
    const trimmed = text.trim()
    if (!convId || !trimmed) return

    const clientMsgId = existingClientMsgId || `kf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    imStore.addSendingMessage(convId, clientMsgId, myIdRef.current, trimmed)
    if (!existingClientMsgId) setInputText('')

    wsClientRef.current?.sendMessage(convId, clientMsgId, trimmed)

    const prev = timerMapRef.current.get(clientMsgId)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      imStore.markMessageFailed(clientMsgId)
      timerMapRef.current.delete(clientMsgId)
    }, 3000)
    timerMapRef.current.set(clientMsgId, timer)
  }, [])

  /* ---------------- 接待动作 ---------------- */

  const runAction = useCallback(
    async (work: () => Promise<unknown>, after?: () => void, nextScope?: Scope) => {
      setBusy(true)
      setActionError('')
      try {
        await work()
        after?.()
        await loadQueue(nextScope ?? scope)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '操作失败')
        // 失败也要刷新：可能是别人抢先接单了，列表需要回到真实状态
        await loadQueue(scope)
      } finally {
        setBusy(false)
      }
    },
    [loadQueue, scope],
  )

  const claim = (convId: string) =>
    runAction(
      () => api.post(`/api/im/agent/conversations/${convId}/claim`, {}),
      () => {
        pendingSelectRef.current = convId
        setScope('mine')
      },
      'mine',
    )

  const release = (convId: string) =>
    runAction(
      () => api.post(`/api/im/agent/conversations/${convId}/release`, {}),
      () => {
        setActiveConvId('')
        setScope('pool')
      },
      'pool',
    )

  const closeConv = (convId: string, note: string) =>
    runAction(
      () => api.post(`/api/im/agent/conversations/${convId}/close`, note ? { note } : {}),
      () => {
        setClosing(false)
        setCloseNote('')
        setHistoryTick((tick) => tick + 1)
      },
    )

  const reopenConv = (convId: string) =>
    runAction(
      () => api.post(`/api/im/agent/conversations/${convId}/reopen`, {}),
      () => {
        pendingSelectRef.current = convId
        setScope('mine')
      },
      'mine',
    )

  const addReply = useCallback(async () => {
    const content = newReply.trim()
    if (!content) return
    setReplyBusy(true)
    setActionError('')
    try {
      await api.post('/api/im/quick-replies', { content, category: '我的' })
      setNewReply('')
      await loadQuickReplies()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '新增话术失败')
    } finally {
      setReplyBusy(false)
    }
  }, [newReply, loadQuickReplies])

  const removeReply = useCallback(
    async (replyId: string) => {
      setReplyBusy(true)
      setActionError('')
      try {
        await api.del(`/api/im/quick-replies/${replyId}`)
        await loadQuickReplies()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '删除话术失败')
      } finally {
        setReplyBusy(false)
      }
    },
    [loadQuickReplies],
  )

  /* ---------------- 渲染准备 ---------------- */

  const wsLabel: Record<WsConnectionStatus, { text: string; cls: string }> = {
    connected: { text: 'WS 实时在线', cls: 'connected' },
    connecting: { text: '连接中…', cls: 'connecting' },
    reconnecting: { text: '退避重连中…', cls: 'reconnecting' },
    degraded_polling: { text: '降级长轮询 /api/im/poll', cls: 'polling' },
    disconnected: { text: '未连接', cls: 'disconnected' },
  }
  const conn = wsLabel[wsStatus]
  const isPool = scope === 'pool'

  return (
    <div className="ops-embed">
      <div className="livedesk">
        {/* 左栏：接待队列 */}
        <aside className="livedesk-conv-panel">
          <div className="panel-title">
            接待队列
            <span className="panel-sub">{counters.pool + counters.mine} 个进行中</span>
          </div>

          <div className="desk-tabs">
            {SCOPE_META.map((tab) => {
              const badge =
                tab.key === 'pool' ? counters.pool : tab.key === 'mine' ? counters.mine : counters.closed
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`desk-tab ${scope === tab.key ? 'active' : ''} ${tab.key === 'pool' && counters.pool > 0 ? 'has-work' : ''}`}
                  onClick={() => setScope(tab.key)}
                >
                  {tab.label}
                  <span className="desk-tab-badge">{badge > 99 ? '99+' : badge}</span>
                </button>
              )
            })}
          </div>

          {loadError && <div className="conv-load-error">⚠️ {loadError}</div>}

          <div className="conv-list">
            {convs.length === 0 && !loadError && (
              <div className="conv-empty">
                {isPool
                  ? '待接入队列为空。游客在 C 端「咨询」Tab 发起对话后会落到这里。'
                  : scope === 'mine'
                    ? '你还没有接待中的会话。去「待接入」接一个吧。'
                    : '还没有已结束的会话。'}
              </div>
            )}
            {convs.map((row) => {
              const count = unread[row.conversation_id] ?? 0
              const counterpart = row.counterpart_id ? presence[row.counterpart_id] : undefined
              const online = counterpart
                ? counterpart.online
                : Date.now() - (lastActive[row.conversation_id] ?? 0) < ACTIVE_WINDOW_MS
              return (
                <button
                  key={row.conversation_id}
                  type="button"
                  className={`conv-item ${row.conversation_id === activeConvId ? 'active' : ''} ${row.sla_breached ? 'sla' : ''}`}
                  onClick={() => setActiveConvId(row.conversation_id)}
                >
                  <span
                    className={`conv-dot ${online ? 'on' : ''}`}
                    title={
                      counterpart
                        ? counterpart.online
                          ? '客户端在线（Redis 心跳有效）'
                          : '当前不在线'
                        : '暂无在线数据'
                    }
                  />
                  <span className="conv-main">
                    <span className="conv-name">
                      {convTitleOf(row)}
                      {row.counterpart_phone && <span className="conv-phone">{row.counterpart_phone}</span>}
                    </span>
                    <span className="conv-preview">{row.last_message_preview || '（暂无消息）'}</span>
                    <span className="conv-meta">
                      {isPool && (
                        <span className={`conv-wait ${row.sla_breached ? 'breached' : ''}`}>
                          已等 {fmtWait(row.wait_seconds)}
                        </span>
                      )}
                      {scope === 'mine' && <span>接入于 {fmtTime(row.assigned_at)}</span>}
                      {scope === 'closed' && <span>结束于 {fmtTime(row.closed_at)}</span>}
                      <span className="conv-meta-time">{fmtTime(row.last_message_at)}</span>
                    </span>
                  </span>
                  {count > 0 && <span className="conv-unread">{count > 99 ? '99+' : count}</span>}
                </button>
              )
            })}
          </div>

          <div className="self-card">
            <div className="self-row">
              <span>客服坐席</span>
              <strong>唯一坐席</strong>
            </div>
            <div className="side-note">
              本端只设 1 个客服坐席，接入的会话都归你接待。队列按最后一条消息时间倒序。
            </div>
          </div>
        </aside>

        {/* 中栏：当前会话 */}
        <section className="livedesk-chat-panel">
          <header className="chat-header">
            <div>
              <div className="chat-title">
                {activeConv ? convTitleOf(activeConv) : '未选择会话'}
                {activeConv && <span className="chat-title-id">#{activeConv.conversation_id}</span>}
              </div>
              <div className={`chat-conn ${conn.cls}`}>● {conn.text}</div>
            </div>
            <div className="chat-header-right">
              {activeConv && (
                <span className={`presence-pill ${activeConv.status === 'CLOSED' ? 'closed' : ''}`}>
                  {activeConv.status === 'CLOSED' ? '已结束' : activeConv.assignee_id ? '接待中' : '待接入'}
                </span>
              )}
            </div>
          </header>

          {actionError && <div className="paused-banner error">{actionError}</div>}

          {activeConv && isPool && !activeConv.assignee_id && (
            <div className={`pool-banner ${activeConv.sla_breached ? 'sla' : ''}`}>
              <span>
                待接入会话：只能看到最后一条消息预览，接入后才能查看完整对话（服务端按会话参与者鉴权）。
                {activeConv.sla_breached &&
                  ` 已等待 ${fmtWait(activeConv.wait_seconds)}，超过 ${fmtWait(slaSeconds)} 的响应目标。`}
              </span>
              <button
                type="button"
                className="mini-btn primary"
                disabled={busy}
                onClick={() => claim(activeConv.conversation_id)}
              >
                立即接入
              </button>
            </div>
          )}

          <div className="chat-message-list">
            {!activeConv && <div className="chat-empty">从左侧选择一个会话。</div>}
            {activeConv && !canReadHistory && (
              <div className="chat-empty">
                尚未接入，无法拉取历史消息。
                {activeConv.last_message_preview && (
                  <div className="preview-only">最后一条：{activeConv.last_message_preview}</div>
                )}
              </div>
            )}
            {activeConv && canReadHistory && messages.length === 0 && (
              <div className="chat-empty">该会话暂无消息。历史消息会在打开会话时自动从服务端补齐。</div>
            )}
            {activeConv &&
              canReadHistory &&
              messages.map((message) => {
                const mine = String(message.senderId) === String(myIdRef.current)
                return (
                  <div
                    key={message.clientMsgId || `${message.convId}_${message.seq}`}
                    className={`chat-row ${mine ? 'mine' : 'theirs'}`}
                  >
                    <div className="chat-bubble">
                      <div className="chat-text">{message.content}</div>
                      <div className="chat-meta">
                        <span className="chat-time">
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {mine && (
                          <span className={`msg-state ${message.status}`}>
                            {message.status === 'sending' && '发送中…'}
                            {message.status === 'sent' && '✓ 已送达'}
                            {message.status === 'failed' && (
                              <button
                                type="button"
                                className="retry-btn"
                                onClick={() => executeSend(message.content, message.clientMsgId)}
                              >
                                ⚠ 失败 · 点击重发
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            <div ref={messagesEndRef} />
          </div>

          <div className="quick-replies">
            {quickReplies.map((reply) => (
              <span key={reply.id} className={`quick-chip-wrap ${reply.is_shared ? 'shared' : 'personal'}`}>
                <button
                  type="button"
                  className="quick-chip"
                  title={`${reply.category} · ${reply.is_shared ? '公共话术' : '我的话术'}`}
                  disabled={!canReadHistory}
                  onClick={() => executeSend(reply.content)}
                >
                  {reply.content}
                </button>
                {!reply.is_shared && (
                  <button
                    type="button"
                    className="quick-del"
                    title="删除我的话术"
                    disabled={replyBusy}
                    onClick={() => void removeReply(reply.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <span className="quick-add">
              <input
                type="text"
                value={newReply}
                placeholder="新增我的话术…"
                maxLength={500}
                onChange={(event) => setNewReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addReply()
                }}
              />
              <button
                type="button"
                className="mini-btn"
                disabled={replyBusy || !newReply.trim()}
                onClick={() => void addReply()}
              >
                添加
              </button>
            </span>
          </div>

          <form
            className="chat-input-bar"
            onSubmit={(event) => {
              event.preventDefault()
              executeSend(inputText)
            }}
          >
            <input
              type="text"
              value={inputText}
              disabled={!canReadHistory}
              placeholder={canReadHistory ? '回复客户…（回车发送）' : '接入后才能回复'}
              onChange={(event) => setInputText(event.target.value)}
            />
            <button type="submit" disabled={!inputText.trim() || !canReadHistory}>
              发送
            </button>
          </form>
        </section>

        {/* 右栏：会话详情 + 操作 + 评分 */}
        <aside className="livedesk-side-panel">
          <div className="panel-title">会话详情</div>

          {!activeConv && <div className="conv-empty">未选择会话。</div>}

          {activeConv && (
            <>
              <div className="side-card">
                <div className="side-row">
                  <span>客户</span>
                  <span>{activeConv.counterpart_name ?? '—'}</span>
                </div>
                <div className="side-row">
                  <span>手机</span>
                  <span>{activeConv.counterpart_phone ?? '—'}</span>
                </div>
                <div className="side-row">
                  <span>在线</span>
                  <span className={activePresence?.online ? 'text-on' : 'text-off'}>
                    {activePresence
                      ? activePresence.online
                        ? `在线（${activePresence.device_count} 台设备）`
                        : '离线'
                      : '未知'}
                  </span>
                </div>
                <div className="side-row">
                  <span>会话状态</span>
                  <span>
                    {activeConv.status === 'CLOSED' ? '已结束' : activeConv.assignee_id ? '接待中' : '待接入'}
                  </span>
                </div>
                <div className="side-row">
                  <span>已等待</span>
                  <span>{fmtWait(activeConv.wait_seconds)}</span>
                </div>
                <div className="side-row">
                  <span>接待客服</span>
                  <span>{activeConv.assignee_name ?? '无人'}</span>
                </div>
                {activeConv.agent_note && (
                  <div className="side-row note">
                    <span>结单备注</span>
                    <span>{activeConv.agent_note}</span>
                  </div>
                )}
              </div>

              <div className="side-card">
                {isPool && !activeConv.assignee_id && (
                  <button
                    type="button"
                    className="mini-btn primary full"
                    disabled={busy}
                    onClick={() => claim(activeConv.conversation_id)}
                  >
                    接入这条会话
                  </button>
                )}

                {scope === 'mine' && (
                  <>
                    <button
                      type="button"
                      className="mini-btn full"
                      disabled={busy}
                      onClick={() => release(activeConv.conversation_id)}
                    >
                      放回待接入队列
                    </button>
                    <button
                      type="button"
                      className="mini-btn danger full"
                      disabled={busy}
                      onClick={() => setClosing(true)}
                    >
                      结束会话
                    </button>
                    {closing && (
                      <div className="transfer-panel">
                        <input
                          type="text"
                          value={closeNote}
                          maxLength={255}
                          placeholder="结单备注（选填）"
                          onChange={(event) => setCloseNote(event.target.value)}
                        />
                        <button
                          type="button"
                          className="mini-btn danger"
                          disabled={busy}
                          onClick={() => closeConv(activeConv.conversation_id, closeNote.trim())}
                        >
                          确认结束
                        </button>
                        <button type="button" className="mini-btn ghost" onClick={() => setClosing(false)}>
                          取消
                        </button>
                      </div>
                    )}
                  </>
                )}

                {scope === 'closed' && (
                  <button
                    type="button"
                    className="mini-btn full"
                    disabled={busy}
                    onClick={() => reopenConv(activeConv.conversation_id)}
                  >
                    重新打开
                  </button>
                )}
              </div>
            </>
          )}

          <div className="side-card rating-box">
            <div className="side-note-title">我的满意度</div>
            {!rating || rating.total === 0 ? (
              <div className="rating-empty">还没有客户评价。会话结束后客户可在 C 端评分。</div>
            ) : (
              <>
                <div className="rating-avg">
                  <strong>{rating.avg_score?.toFixed(1) ?? '—'}</strong>
                  <span>/ 5.0 · {rating.total} 条</span>
                </div>
                <div className="rating-bars">
                  {(['5', '4', '3', '2', '1'] as const).map((star) => {
                    const count = rating.distribution[star] ?? 0
                    const percent = rating.total ? Math.round((count / rating.total) * 100) : 0
                    return (
                      <div key={star} className="rating-bar">
                        <span>{star}★</span>
                        <span className="rating-track">
                          <span style={{ width: `${percent}%` }} />
                        </span>
                        <span>{count}</span>
                      </div>
                    )
                  })}
                </div>
                {rating.recent.slice(0, 2).map((item) => (
                  <div key={item.id} className="rating-item">
                    <span>{'★'.repeat(item.score)}</span>
                    <span className="rating-item-text">{item.comment || '（未留言）'}</span>
                    <span className="rating-item-who">{item.rater_name}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="side-card side-note">
            <div className="side-note-title">口径说明</div>
            绿点 = 客户客户端与 WS 连接在线（Redis 的 im:online:用户ID 心跳有效）；
            状态由 im_agent_status 落库，「接待中/小休/离线」换设备也一致。
            待接入池 15 秒兜底刷新，接入后转 WS 实时。
          </div>
        </aside>
      </div>
    </div>
  )
}
