/**
 * 运营大屏的取数通道：消费 BFF 的 GET /api/stats/live（SSE 单向推送）。
 *
 * 为什么不用原生 EventSource：
 *   本项目要遵循「不轮询、只消费」的约定，还需要自己控制重连退避与半死连接看门狗；
 *   同时 BFF 侧是 SseEmitter，语义与标准 SSE 一致，用 fetch 流式解析更可控。
 *
 * 与旧版（frontend/agency-web/src/lib/sse.ts）的差异只有一处：
 *   地址从 Node 的 /v1/stats/live 换成 BFF 的 /api/stats/live，
 *   且不再需要 Authorization —— 浏览器只带 JSESSIONID，token 由 Java 侧注入。
 */

export interface LiveSnapshot {
  online_count: number
  online_conn: number
  today_order_count: number
  message_count: number
  seckill_qps: number
  ts: number
  /** 哪些指标是降级值（Redis 不可用 / 计数缺失 / MySQL 异常） */
  degraded: string[]
  /** 以下字段 Node 已返回，旧大屏未用；保留在类型里，后续扩展不用改契约 */
  gmv_today?: number
  agent?: {
    pending: number
    serving: number
    today_conversations: number
    avg_rating: number | null
    rating_count: number
  }
  order_status?: Record<string, number>
}

export interface LiveStatsHandlers {
  onStats: (snapshot: LiveSnapshot) => void
  onOpen?: () => void
  /** 服务端推来的 event: error（单拍采集失败，流未断） */
  onServerError?: (message: string) => void
  onDown?: (reason: string) => void
}

interface LiveStatsHandle {
  close: () => void
}

const ENDPOINT = '/api/stats/live'
const DEFAULT_RETRY_MS = 3000
const BACKOFF_CAP_MS = 30000
/** 空闲超时：服务端 5s 一拍，超过 30s 一拍都没有 → 视为半死连接主动重连 */
const STALL_TIMEOUT_MS = 30000

function parseSseEvent(block: string): { event: string; dataLines: string[]; retryMs: number | null } {
  let event = 'message'
  const dataLines: string[] = []
  let retryMs: number | null = null

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'retry') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) retryMs = parsed
    }
  }
  return { event, dataLines, retryMs }
}

export function openLiveStats(handlers: LiveStatsHandlers): LiveStatsHandle {
  let closed = false
  let abort: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let retryHintMs = DEFAULT_RETRY_MS
  let consecutiveFailures = 0

  const clearStall = (): void => {
    if (stallTimer) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  const scheduleReconnect = (reason: string): void => {
    clearStall()
    if (closed) return
    handlers.onDown?.(reason)
    const step = Math.min(consecutiveFailures, 4)
    const base = Math.min(retryHintMs * Math.pow(2, step), BACKOFF_CAP_MS)
    const jitter = 0.8 + Math.random() * 0.4
    const delay = Math.round(base * jitter)
    consecutiveFailures += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void consume()
    }, delay)
  }

  const consume = async (): Promise<void> => {
    if (closed) return
    abort = new AbortController()

    try {
      const res = await fetch(ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal: abort.signal,
        cache: 'no-store',
      })

      if (!res.ok || !res.body) {
        // 401（会话过期）也走退避：页面会被 401 拦截器送回登录页，这里不猛冲
        scheduleReconnect(`HTTP ${res.status}`)
        return
      }

      consecutiveFailures = 0
      retryHintMs = DEFAULT_RETRY_MS
      handlers.onOpen?.()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const armStall = (): void => {
        clearStall()
        stallTimer = setTimeout(() => abort?.abort(), STALL_TIMEOUT_MS)
      }
      armStall()

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        armStall()
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')

        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          if (!block.trim()) continue

          const parsed = parseSseEvent(block)
          if (parsed.retryMs !== null) retryHintMs = parsed.retryMs

          if (parsed.event === 'stats' && parsed.dataLines.length) {
            try {
              handlers.onStats(JSON.parse(parsed.dataLines.join('\n')) as LiveSnapshot)
            } catch {
              // 单拍解析失败：丢掉这一拍等下一拍，不重连（与 Node 的「不断流」承诺对齐）
            }
          } else if (parsed.event === 'error' && parsed.dataLines.length) {
            try {
              const err = JSON.parse(parsed.dataLines.join('\n')) as { message?: string }
              handlers.onServerError?.(err.message ?? '统计采集失败')
            } catch {
              handlers.onServerError?.('统计采集失败')
            }
          }
        }
      }

      scheduleReconnect('服务端关闭了流')
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (closed || name === 'AbortError') return
      scheduleReconnect(name ? `网络异常：${name}` : '网络异常')
    }
  }

  void consume()

  return {
    close: () => {
      closed = true
      clearStall()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      abort?.abort()
      abort = null
    },
  }
}
