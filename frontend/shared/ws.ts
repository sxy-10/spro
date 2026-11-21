 /**
  * IM WebSocket 客户端与长轮询降级底座（第 4 棒 · 组员4）
  * 
  * 放置于 frontend/shared/ws.ts，供前台移动端 App 与第 5 棒 agency-web 客服台公共复用。
  * 
  * 核心特性：
  * 1. 严格对齐 backend/src/im/protocol.ts (v:1 协议帧、心跳 30s、探活超时 10s)
  * 2. 重连台阶退避：1s -> 2s -> 4s -> 8s -> 16s -> 30s 封顶，叠 ±20% 随机抖动防风暴
  * 3. 掉线重连自动发送 sync 帧增量对账（防丢消息）
  * 4. 连续重连失败自动降级到 HTTP 长轮询 /v1/im/poll，并在后台探测 WS 自愈
  */
 
 export const PROTOCOL_VERSION = 1;
 
 export type WsConnectionStatus =
   | 'disconnected'
   | 'connecting'
   | 'connected'
   | 'reconnecting'
   | 'degraded_polling';
 
 export interface ImMessageFrame {
   v?: number;
   t: 'msg';
   convId: string | number;
   seq: number;
   clientMsgId: string;
   senderId: string | number;
   type?: string;
   content: string;
   ts?: number;
 }
 
 export interface ImAckOkFrame {
   v?: number;
   t: 'ack_ok';
   clientMsgId: string;
   seq: number;
 }
 
 export interface ImNotifyFrame {
   v?: number;
   t: 'notify';
   kind: string;
   convId: string | number;
   preview: string;
 }
 
 export interface ImErrorFrame {
   v?: number;
   t: 'error';
   code: string;
   msg: string;
 }
 
 export interface ImWsClientOptions {
   /** WebSocket 服务地址，若未传自动推导 ws://<host>/v1/im/ws */
   url?: string;
   /** HTTP API 根路径，长轮询降级用，默认 /v1 */
   apiBaseUrl?: string;
   /** 当前用户 JWT Token 获取函数 */
   getToken: () => string | null;
   /** 本地持久化设备 ID 获取与保存 */
   getDeviceId?: () => string | undefined;
   saveDeviceId?: (id: string) => void;
   /** 心跳间隔，默认 30s */
   heartbeatIntervalMs?: number;
   /** 心跳应答超时，默认 10s */
   pongTimeoutMs?: number;
   /** 默认监听的会话 ID（断线重连时自动请求 sync） */
   defaultConvId?: string | number;
   /** 获取已知最新 seq，断线重连 sync 帧对账用 */
   getLastSeq?: (convId: string | number) => number;
 }
 
 const BACKOFF_STEPS = [1000, 2000, 4000, 8000, 16000, 30000];
 const MAX_CONSECUTIVE_WS_FAILURES_BEFORE_DEGRADE = 3;
 
 export class ImWsClient {
   private options: ImWsClientOptions;
   private socket: WebSocket | null = null;
   private status: WsConnectionStatus = 'disconnected';
   private reconnectAttempts = 0;
   private consecutiveFailures = 0;
   private reconnectTimer: any = null;
   private heartbeatTimer: any = null;
   private pongTimeoutTimer: any = null;
   private pollingTimer: any = null;
   private isDestroyed = false;
   private isPollingActive = false;
 
   private messageListeners = new Set<(msg: ImMessageFrame) => void>();
   private ackListeners = new Set<(ack: ImAckOkFrame) => void>();
   private notifyListeners = new Set<(notify: ImNotifyFrame) => void>();
   private statusListeners = new Set<(status: WsConnectionStatus) => void>();
   private errorListeners = new Set<(err: ImErrorFrame) => void>();
 
   constructor(options: ImWsClientOptions) {
     this.options = {
       heartbeatIntervalMs: 30000,
       pongTimeoutMs: 10000,
       apiBaseUrl: '/v1',
       ...options
     };
   }
 
   /** 订阅消息接收 */
   public onMessage(callback: (msg: ImMessageFrame) => void): () => void {
     this.messageListeners.add(callback);
     return () => this.messageListeners.delete(callback);
   }
 
   /** 订阅消息 ACK 回执（发送成功） */
   public onAck(callback: (ack: ImAckOkFrame) => void): () => void {
     this.ackListeners.add(callback);
     return () => this.ackListeners.delete(callback);
   }
 
   /** 订阅在线通知 */
   public onNotify(callback: (notify: ImNotifyFrame) => void): () => void {
     this.notifyListeners.add(callback);
     return () => this.notifyListeners.delete(callback);
   }
 
   /** 订阅连接状态变化 */
   public onStatusChange(callback: (status: WsConnectionStatus) => void): () => void {
     this.statusListeners.add(callback);
     callback(this.status);
     return () => this.statusListeners.delete(callback);
   }
 
   /** 订阅服务端错误帧 */
   public onError(callback: (err: ImErrorFrame) => void): () => void {
     this.errorListeners.add(callback);
     return () => this.errorListeners.delete(callback);
   }
 
   public getStatus(): WsConnectionStatus {
     return this.status;
   }
 
   private setStatus(newStatus: WsConnectionStatus): void {
     if (this.status === newStatus) return;
     this.status = newStatus;
     this.statusListeners.forEach((listener) => {
       try {
         listener(newStatus);
       } catch (err) {
         console.error('[ImWsClient] 状态监听器执行异常:', err);
       }
     });
   }
 
   /** 获取目标 WebSocket URL */
   private resolveWsUrl(): string {
     if (this.options.url) return this.options.url;
     const token = this.options.getToken();
     const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
     const protocol = isHttps ? 'wss:' : 'ws:';
     const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:3001';
     const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
     return `${protocol}//${host}/v1/im/ws${tokenParam}`;
   }
 
   /** 发起连接 */
   public connect(): void {
     if (this.isDestroyed) return;
     const token = this.options.getToken();
     if (!token) {
       this.setStatus('disconnected');
       return;
     }
 
     this.clearTimers();
     if (this.socket) {
       try {
         this.socket.close();
       } catch {}
       this.socket = null;
     }
 
     this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
 
     try {
       const wsUrl = this.resolveWsUrl();
       this.socket = new WebSocket(wsUrl);
 
       this.socket.onopen = () => {
         this.consecutiveFailures = 0;
         this.reconnectAttempts = 0;
         this.sendAuthFrame();
         this.startHeartbeat();
       };
 
       this.socket.onmessage = (event) => {
         this.handleIncomingRawMessage(event.data);
       };
 
       this.socket.onerror = (event) => {
         console.warn('[ImWsClient] WebSocket 连接错误:', event);
       };
 
       this.socket.onclose = (event) => {
         this.handleSocketClose(event.code, event.reason);
       };
     } catch (err) {
       console.error('[ImWsClient] WebSocket 实例化失败:', err);
       this.scheduleReconnect();
     }
   }
 
   /** 发送第一帧 auth 认证 */
   private sendAuthFrame(): void {
     const token = this.options.getToken();
     if (!token) return;
     const deviceId = this.options.getDeviceId ? this.options.getDeviceId() : undefined;
     this.sendRaw({
       v: PROTOCOL_VERSION,
       t: 'auth',
       token,
       deviceId,
       platform: 'WEB'
     });
   }
 
   /** 处理收到的数据帧 */
   private handleIncomingRawMessage(rawData: any): void {
     let frame: any;
     try {
       frame = typeof rawData === 'string' ? JSON.parse(rawData) : JSON.parse(new TextDecoder().decode(rawData));
     } catch {
       return;
     }
 
     if (!frame || !frame.t) return;
 
     switch (frame.t) {
       case 'auth_ok': {
         this.setStatus('connected');
         if (frame.deviceId && this.options.saveDeviceId) {
           this.options.saveDeviceId(frame.deviceId);
         }
         // 停止轮询降级
         this.stopPollingDegrade();
         // 鉴权成功后，若有指定会话，自动发送 sync 帧增量对账补齐
         this.syncMissedMessages();
         break;
       }
 
       case 'pong': {
         if (this.pongTimeoutTimer) {
           clearTimeout(this.pongTimeoutTimer);
           this.pongTimeoutTimer = null;
         }
         break;
       }
 
       case 'msg': {
         const msgFrame: ImMessageFrame = {
           v: frame.v,
           t: 'msg',
           convId: frame.convId,
           seq: Number(frame.seq),
           clientMsgId: String(frame.clientMsgId),
           senderId: String(frame.senderId),
           type: frame.type || 'TEXT',
           content: String(frame.content),
           ts: Number(frame.ts || Date.now())
         };
         this.messageListeners.forEach((listener) => {
           try {
             listener(msgFrame);
           } catch (err) {
             console.error('[ImWsClient] 消息分发异常:', err);
           }
         });
         break;
       }
 
       case 'ack_ok': {
         const ackFrame: ImAckOkFrame = {
           v: frame.v,
           t: 'ack_ok',
           clientMsgId: String(frame.clientMsgId),
           seq: Number(frame.seq)
         };
         this.ackListeners.forEach((listener) => {
           try {
             listener(ackFrame);
           } catch (err) {
             console.error('[ImWsClient] ACK 分发异常:', err);
           }
         });
         break;
       }
 
       case 'notify': {
         const notifyFrame: ImNotifyFrame = {
           v: frame.v,
           t: 'notify',
           kind: String(frame.kind),
           convId: frame.convId,
           preview: String(frame.preview)
         };
         this.notifyListeners.forEach((listener) => {
           try {
             listener(notifyFrame);
           } catch (err) {
             console.error('[ImWsClient] Notify 分发异常:', err);
           }
         });
         break;
       }
 
       case 'error': {
         const errorFrame: ImErrorFrame = {
           v: frame.v,
           t: 'error',
           code: String(frame.code),
           msg: String(frame.msg)
         };
         this.errorListeners.forEach((listener) => {
           try {
             listener(errorFrame);
           } catch (err) {
             console.error('[ImWsClient] Error 分发异常:', err);
           }
         });
         break;
       }
     }
   }
 
   /** 心跳机制：每 30s 发一次 ping，10s 内无响应判定掉线 */
   private startHeartbeat(): void {
     this.clearHeartbeat();
     this.heartbeatTimer = setInterval(() => {
       if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
 
       this.sendRaw({ v: PROTOCOL_VERSION, t: 'ping', ts: Date.now() });
 
       // 10s 内没有收到 pong 则触发心跳超时重连
       this.pongTimeoutTimer = setTimeout(() => {
         console.warn('[ImWsClient] 心跳超时（10s 无 pong 应答），判定掉线主动重连');
         if (this.socket) {
           try {
             this.socket.close(4001, 'heartbeat_timeout');
           } catch {}
         }
       }, this.options.pongTimeoutMs || 10000);
     }, this.options.heartbeatIntervalMs || 30000);
   }
 
   /** 发送 sync 帧增量对账补齐 */
   public syncMissedMessages(convIdHint?: string | number): void {
     const targetConvId = convIdHint ?? this.options.defaultConvId;
     if (!targetConvId) return;
     const lastSeq = this.options.getLastSeq ? this.options.getLastSeq(targetConvId) : 0;
     this.sendRaw({
       v: PROTOCOL_VERSION,
       t: 'sync',
       convId: String(targetConvId),
       lastSeq
     });
   }
 
   /** 发送业务消息（msg 帧） */
   public sendMessage(
     convId: string | number,
     clientMsgId: string,
     content: string,
     type: 'TEXT' | 'SYSTEM' = 'TEXT'
   ): boolean {
     // 若在降级轮询状态，走 HTTP POST 发送
     if (this.status === 'degraded_polling') {
       this.sendViaHttpFallback(convId, clientMsgId, content);
       return true;
     }
 
     return this.sendRaw({
       v: PROTOCOL_VERSION,
       t: 'msg',
       convId: String(convId),
       clientMsgId,
       type,
       content
     });
   }
 
   /** 发送已读游标确认（ack 帧） */
   public sendAck(convId: string | number, seq: number): boolean {
     if (seq <= 0) return false;
     return this.sendRaw({
       v: PROTOCOL_VERSION,
       t: 'ack',
       convId: String(convId),
       seq
     });
   }
 
   /** 底层发送 JSON 格式帧 */
   private sendRaw(payload: Record<string, any>): boolean {
     if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
       return false;
     }
     try {
       this.socket.send(JSON.stringify(payload));
       return true;
     } catch (err) {
       console.error('[ImWsClient] 发送帧异常:', err);
       return false;
     }
   }
 
   /** 连接关闭处理 */
   private handleSocketClose(code: number, reason: string): void {
     this.clearHeartbeat();
     this.socket = null;
 
     // 4003: 鉴权失败，4004: 缺少权限 -> 不自动频繁重连，等用户换 token
     if (code === 4003 || code === 4004) {
       console.warn(`[ImWsClient] 连接被服务端关闭（code=${code}, reason=${reason}），停止自动重连`);
       this.setStatus('disconnected');
       return;
     }
 
     this.consecutiveFailures++;
     if (this.consecutiveFailures >= MAX_CONSECUTIVE_WS_FAILURES_BEFORE_DEGRADE) {
       // 连续多次失败，触发降级到 HTTP 轮询模式
       this.startPollingDegrade();
     }
 
     this.scheduleReconnect();
   }
 
   /** 计划指数退避重连：1s -> 2s -> 4s -> 8s -> 16s -> 30s + ±20% 抖动 */
   private scheduleReconnect(): void {
     if (this.isDestroyed) return;
     if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
 
     const stepIndex = Math.min(this.reconnectAttempts, BACKOFF_STEPS.length - 1);
     const baseDelay = BACKOFF_STEPS[stepIndex];
     const jitterMultiplier = 0.8 + Math.random() * 0.4;
     const actualDelay = Math.round(baseDelay * jitterMultiplier);
 
     this.reconnectAttempts++;
     if (this.status !== 'degraded_polling') {
       this.setStatus('reconnecting');
     }
 
     console.log(`[ImWsClient] 计划在 ${actualDelay}ms 后执行第 ${this.reconnectAttempts} 次重连...`);
     this.reconnectTimer = setTimeout(() => {
       this.connect();
     }, actualDelay);
   }
 
   /* ---------------------- 长轮询降级机制 (/v1/im/poll) ---------------------- */
 
   private startPollingDegrade(): void {
     if (this.isPollingActive) return;
     this.isPollingActive = true;
     this.setStatus('degraded_polling');
     console.warn('[ImWsClient] WS 不可用，已平滑降级至 HTTP 长轮询通道 /v1/im/poll');
     void this.executePollLoop();
   }
 
   private stopPollingDegrade(): void {
     this.isPollingActive = false;
     if (this.pollingTimer) {
       clearTimeout(this.pollingTimer);
       this.pollingTimer = null;
     }
   }
 
   private async executePollLoop(): Promise<void> {
     if (!this.isPollingActive || this.isDestroyed) return;
 
     const token = this.options.getToken();
     const convId = this.options.defaultConvId;
     if (token && convId) {
       const since = this.options.getLastSeq ? this.options.getLastSeq(convId) : 0;
       try {
         const url = `${this.options.apiBaseUrl}/im/poll?convId=${encodeURIComponent(String(convId))}&since=${since}`;
         const res = await fetch(url, {
           headers: {
             Authorization: `Bearer ${token}`
           }
         });
 
         if (res.ok) {
           const body = await res.json();
           const messages: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
           messages.forEach((row) => {
             const msgFrame: ImMessageFrame = {
               v: PROTOCOL_VERSION,
               t: 'msg',
               convId: row.conversation_id || convId,
               seq: Number(row.seq),
               clientMsgId: String(row.client_msg_id || ''),
               senderId: String(row.sender_id || ''),
               type: row.content_type || 'TEXT',
               content: String(row.content || ''),
               ts: new Date(row.created_at).getTime()
             };
             this.messageListeners.forEach((l) => l(msgFrame));
           });
         }
       } catch {
         // 轮询异常静默，保持重试
       }
     }
 
     // 间隔 2s 继续下一次轮询
     this.pollingTimer = setTimeout(() => {
       void this.executePollLoop();
     }, 2000);
   }
 
   /** 降级模式下的 HTTP 兜底发消息 */
   private async sendViaHttpFallback(
     convId: string | number,
     clientMsgId: string,
     content: string
   ): Promise<void> {
     const token = this.options.getToken();
     if (!token) return;
     try {
       const res = await fetch(`${this.options.apiBaseUrl}/im/messages`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           Authorization: `Bearer ${token}`,
           'Idempotency-Key': clientMsgId
         },
         body: JSON.stringify({
           conversation_id: String(convId),
           client_msg_id: clientMsgId,
           content
         })
       });
 
       if (res.ok) {
         const result = await res.json();
         const seq = Number(result?.data?.seq || 0);
         this.ackListeners.forEach((l) => l({ t: 'ack_ok', clientMsgId, seq }));
       }
     } catch (err) {
       console.error('[ImWsClient] 降级发送异常:', err);
     }
   }
 
   private clearHeartbeat(): void {
     if (this.heartbeatTimer) {
       clearInterval(this.heartbeatTimer);
       this.heartbeatTimer = null;
     }
     if (this.pongTimeoutTimer) {
       clearTimeout(this.pongTimeoutTimer);
       this.pongTimeoutTimer = null;
     }
   }
 
   private clearTimers(): void {
     this.clearHeartbeat();
     if (this.reconnectTimer) {
       clearTimeout(this.reconnectTimer);
       this.reconnectTimer = null;
     }
   }
 
   /** 销毁客户端并断开连接 */
   public destroy(): void {
     this.isDestroyed = true;
     this.stopPollingDegrade();
     this.clearTimers();
     if (this.socket) {
       try {
         this.socket.close();
       } catch {}
       this.socket = null;
     }
     this.messageListeners.clear();
     this.ackListeners.clear();
     this.notifyListeners.clear();
     this.statusListeners.clear();
     this.errorListeners.clear();
   }
 }
