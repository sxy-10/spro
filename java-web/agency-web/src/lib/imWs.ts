/**
 * 客服台的 IM WebSocket 客户端（基于 BFF 桥接的 /api/im/ws）。
 *
 * 与旧实现（frontend/shared/ws.ts）的三处差异，都是架构变化逼出来的：
 *   1. 地址从 ws://host/v1/im/ws?token=… 换成 ws://host/api/im/ws：
 *      token 只存在于服务端会话里，Java 侧连 Node 时自己带，浏览器不再接触；
 *   2. 因此**不再发送 auth 帧**：握手完成即代表鉴权完成（Java 用 ?token= 直连 Node），
 *      再发 auth 反而会用空 token 覆盖掉服务端已建立的认证状态；
 *   3. HTTP 兜底（长轮询 / 发消息）改走 /api/im/**，靠 Cookie + X-XSRF-TOKEN。
 *
 * 协议帧、心跳节奏、重连退避、断线 sync 对账全部与 Node protocol.ts v1 保持一致。
 */

import { xsrfToken } from './csrf'

export const PROTOCOL_VERSION = 1

export type WsConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded_polling'

export interface ImMessageFrame {
  v?: number
  t: 'msg'
  convId: string | number
  seq: number
  clientMsgId: string
  senderId: string | number
  type?: string
  content: string
  ts?: number
}

export interface ImAckOkFrame {
  v?: number
  t: 'ack_ok'
  clientMsgId: string
  seq: number
}

export interface ImNotifyFrame {
  v?: number
  t: 'notify'
  kind: string
  convId: string | number
  preview: string
}

export interface ImErrorFrame {
  v?: number
  t: 'error'
  code: string
  msg: string
}

export interface ImWsClientOptions {
  /** 覆盖默认地址（默认按当前页面 host 推导 /api/im/ws） */
  url?: string
  /** HTTP 根路径，长轮询降级用 */
  apiBase?: string
  /** 心跳间隔，默认 30s */
  heartbeatIntervalMs?: number
  /** 心跳应答超时，默认 10s */
  pongTimeoutMs?: number
  /** 默认监听的会话 ID（断线重连时自动请求 sync） */
  defaultConvId?: string | number
  /** 获取已知最新 seq，断线重连 sync 帧对账用 */
  getLastSeq?: (convId: string | number) => number
}

const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000]
const MAX_CONSECUTIVE_FAILURES_BEFORE_DEGRADE = 3

export class ImWsClient {
  private options: Required<Pick<ImWsClientOptions, 'apiBase' | 'heartbeatIntervalMs' | 'pongTimeoutMs'>> &
    ImWsClientOptions
  private socket: WebSocket | null = null
  private status: WsConnectionStatus = 'disconnected'
  private reconnectAttempts = 0
  private consecutiveFailures = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private pollingTimer: ReturnType<typeof setTimeout> | null = null
  private isDestroyed = false
  private isPollingActive = false

  private messageListeners = new Set<(msg: ImMessageFrame) => void>()
  private ackListeners = new Set<(ack: ImAckOkFrame) => void>()
  private notifyListeners = new Set<(notify: ImNotifyFrame) => void>()
  private statusListeners = new Set<(status: WsConnectionStatus) => void>()
  private errorListeners = new Set<(err: ImErrorFrame) => void>()

  constructor(options: ImWsClientOptions = {}) {
    this.options = {
      apiBase: '/api/im',
      heartbeatIntervalMs: 30000,
      pongTimeoutMs: 10000,
      ...options,
    }
  }

  onMessage(callback: (msg: ImMessageFrame) => void): () => void {
    this.messageListeners.add(callback)
    return () => this.messageListeners.delete(callback)
  }

  onAck(callback: (ack: ImAckOkFrame) => void): () => void {
    this.ackListeners.add(callback)
    return () => this.ackListeners.delete(callback)
  }

  onNotify(callback: (notify: ImNotifyFrame) => void): () => void {
    this.notifyListeners.add(callback)
    return () => this.notifyListeners.delete(callback)
  }

  onStatusChange(callback: (status: WsConnectionStatus) => void): () => void {
    this.statusListeners.add(callback)
    callback(this.status)
    return () => this.statusListeners.delete(callback)
  }

  onError(callback: (err: ImErrorFrame) => void): () => void {
    this.errorListeners.add(callback)
    return () => this.errorListeners.delete(callback)
  }

  getStatus(): WsConnectionStatus {
    return this.status
  }

  private setStatus(next: WsConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.statusListeners.forEach((listener) => {
      try {
        listener(next)
      } catch (error) {
        console.error('[ImWsClient] 状态监听器异常:', error)
      }
    })
  }

  private resolveWsUrl(): string {
    if (this.options.url) return this.options.url
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/api/im/ws`
  }

  connect(): void {
    if (this.isDestroyed) return

    this.clearTimers()
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // 忽略：旧连接已经不可用
      }
      this.socket = null
    }

    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    try {
      this.socket = new WebSocket(this.resolveWsUrl())

      this.socket.onopen = () => {
        // 鉴权在握手阶段由 BFF 完成，这里只需要维持心跳；连上后等 auth_ok 再改状态
        this.startHeartbeat()
      }

      this.socket.onmessage = (event) => this.handleIncoming(event.data)

      this.socket.onerror = () => {
        // 具体原因由 onclose 的 code 决定，这里不重复处理
      }

      this.socket.onclose = (event) => this.handleClose(event.code, event.reason)
    } catch (error) {
      console.error('[ImWsClient] WebSocket 实例化失败:', error)
      this.scheduleReconnect()
    }
  }

  private handleIncoming(rawData: unknown): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(String(rawData)) as Record<string, unknown>
    } catch {
      return
    }
    if (!frame || typeof frame.t !== 'string') return

    switch (frame.t) {
      case 'auth_ok': {
        this.consecutiveFailures = 0
        this.reconnectAttempts = 0
        this.setStatus('connected')
        this.stopPollingDegrade()
        this.syncMissedMessages()
        break
      }

      case 'pong': {
        if (this.pongTimeoutTimer) {
          clearTimeout(this.pongTimeoutTimer)
          this.pongTimeoutTimer = null
        }
        break
      }

      case 'msg': {
        const msg: ImMessageFrame = {
          v: Number(frame.v),
          t: 'msg',
          convId: String(frame.convId),
          seq: Number(frame.seq),
          clientMsgId: String(frame.clientMsgId ?? ''),
          senderId: String(frame.senderId ?? ''),
          type: typeof frame.type === 'string' ? frame.type : 'TEXT',
          content: String(frame.content ?? ''),
          ts: Number(frame.ts ?? Date.now()),
        }
        this.messageListeners.forEach((listener) => {
          try {
            listener(msg)
          } catch (error) {
            console.error('[ImWsClient] 消息分发异常:', error)
          }
        })
        break
      }

      case 'ack_ok': {
        const ack: ImAckOkFrame = {
          v: Number(frame.v),
          t: 'ack_ok',
          clientMsgId: String(frame.clientMsgId ?? ''),
          seq: Number(frame.seq),
        }
        this.ackListeners.forEach((listener) => {
          try {
            listener(ack)
          } catch (error) {
            console.error('[ImWsClient] ACK 分发异常:', error)
          }
        })
        break
      }

      case 'notify': {
        const notify: ImNotifyFrame = {
          v: Number(frame.v),
          t: 'notify',
          kind: String(frame.kind ?? ''),
          convId: String(frame.convId),
          preview: String(frame.preview ?? ''),
        }
        this.notifyListeners.forEach((listener) => {
          try {
            listener(notify)
          } catch (error) {
            console.error('[ImWsClient] Notify 分发异常:', error)
          }
        })
        break
      }

      case 'error': {
        const err: ImErrorFrame = {
          v: Number(frame.v),
          t: 'error',
          code: String(frame.code ?? ''),
          msg: String(frame.msg ?? ''),
        }
        this.errorListeners.forEach((listener) => {
          try {
            listener(err)
          } catch (error) {
            console.error('[ImWsClient] Error 分发异常:', error)
          }
        })
        break
      }
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

      this.sendRaw({ v: PROTOCOL_VERSION, t: 'ping', ts: Date.now() })

      this.pongTimeoutTimer = setTimeout(() => {
        // 心跳超时：说明桥接链路半死，主动断开走重连
        try {
          this.socket?.close(4001, 'heartbeat_timeout')
        } catch {
          // 忽略
        }
      }, this.options.pongTimeoutMs)
    }, this.options.heartbeatIntervalMs)
  }

  /** 断线重连后补齐漏收的消息 */
  syncMissedMessages(convIdHint?: string | number): void {
    const convId = convIdHint ?? this.options.defaultConvId
    if (!convId) return
    const lastSeq = this.options.getLastSeq ? this.options.getLastSeq(convId) : 0
    this.sendRaw({ v: PROTOCOL_VERSION, t: 'sync', convId: String(convId), lastSeq })
  }

  setActiveConversation(convId: string | number): void {
    this.options.defaultConvId = convId
    if (this.status === 'connected') this.syncMissedMessages(convId)
  }

  sendMessage(convId: string | number, clientMsgId: string, content: string, type: 'TEXT' | 'SYSTEM' = 'TEXT'): boolean {
    if (this.status === 'degraded_polling') {
      void this.sendViaHttp(convId, clientMsgId, content)
      return true
    }
    return this.sendRaw({ v: PROTOCOL_VERSION, t: 'msg', convId: String(convId), clientMsgId, type, content })
  }

  sendAck(convId: string | number, seq: number): boolean {
    if (seq <= 0) return false
    return this.sendRaw({ v: PROTOCOL_VERSION, t: 'ack', convId: String(convId), seq })
  }

  private sendRaw(payload: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    try {
      this.socket.send(JSON.stringify(payload))
      return true
    } catch (error) {
      console.error('[ImWsClient] 发送帧异常:', error)
      return false
    }
  }

  private handleClose(code: number, reason: string): void {
    this.clearHeartbeat()
    this.socket = null

    // 4003 鉴权失败 / 4004 缺少权限：重连没有意义，等用户重新登录或提权
    if (code === 4003 || code === 4004) {
      console.warn(`[ImWsClient] 服务端拒绝连接（${code} ${reason}），停止自动重连`)
      this.setStatus('disconnected')
      return
    }

    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_DEGRADE) {
      this.startPollingDegrade()
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    const step = Math.min(this.reconnectAttempts, BACKOFF_STEPS.length - 1)
    const delay = Math.round(BACKOFF_STEPS[step] * (0.8 + Math.random() * 0.4))
    this.reconnectAttempts += 1
    if (this.status !== 'degraded_polling') this.setStatus('reconnecting')

    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  /* ---------------------- 降级：HTTP 长轮询 ---------------------- */

  private startPollingDegrade(): void {
    if (this.isPollingActive) return
    this.isPollingActive = true
    this.setStatus('degraded_polling')
    console.warn('[ImWsClient] WS 连续失败，已降级到 HTTP 轮询 /api/im/poll')
    void this.pollLoop()
  }

  private stopPollingDegrade(): void {
    this.isPollingActive = false
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  private async pollLoop(): Promise<void> {
    if (!this.isPollingActive || this.isDestroyed) return

    const convId = this.options.defaultConvId
    if (convId) {
      const since = this.options.getLastSeq ? this.options.getLastSeq(convId) : 0
      try {
        const res = await fetch(
          `${this.options.apiBase}/poll?convId=${encodeURIComponent(String(convId))}&since=${since}`,
          { credentials: 'same-origin' },
        )
        if (res.ok) {
          const body = (await res.json()) as { data?: unknown[] }
          const rows = Array.isArray(body?.data) ? body.data : []
          rows.forEach((row) => {
            const item = row as Record<string, unknown>
            this.messageListeners.forEach((listener) =>
              listener({
                v: PROTOCOL_VERSION,
                t: 'msg',
                convId: String(item.conversation_id ?? convId),
                seq: Number(item.seq),
                clientMsgId: String(item.client_msg_id ?? ''),
                senderId: String(item.sender_id ?? ''),
                type: String(item.content_type ?? 'TEXT'),
                content: String(item.content ?? ''),
                ts: item.created_at ? new Date(String(item.created_at)).getTime() : Date.now(),
              }),
            )
          })
        }
      } catch {
        // 轮询失败静默重试，不额外打扰用户
      }
    }

    this.pollingTimer = setTimeout(() => void this.pollLoop(), 2000)
  }

  private async sendViaHttp(convId: string | number, clientMsgId: string, content: string): Promise<void> {
    try {
      const res = await fetch(`${this.options.apiBase}/messages`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': xsrfToken(),
        },
        body: JSON.stringify({ conversation_id: String(convId), client_msg_id: clientMsgId, content }),
      })
      if (res.ok) {
        const body = (await res.json()) as { data?: { seq?: number } }
        const seq = Number(body?.data?.seq ?? 0)
        this.ackListeners.forEach((listener) => listener({ t: 'ack_ok', clientMsgId, seq }))
      }
    } catch (error) {
      console.error('[ImWsClient] 降级发送异常:', error)
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer)
      this.pongTimeoutTimer = null
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  destroy(): void {
    this.isDestroyed = true
    this.stopPollingDegrade()
    this.clearTimers()
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // 忽略
      }
      this.socket = null
    }
    this.messageListeners.clear()
    this.ackListeners.clear()
    this.notifyListeners.clear()
    this.statusListeners.clear()
    this.errorListeners.clear()
  }
}
