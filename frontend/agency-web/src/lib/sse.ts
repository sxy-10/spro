/**
 * 第 5 棒 · 组员5（agency-web · 大屏取数通道）
 *
 * 为什么不用原生 EventSource（对应分工文档 5.3 的取舍说明）：
 *   原生 EventSource **不能自定义请求头**，而 /v1/stats/live 走 authenticateJwt，
 *   后端 passport 只从 `Authorization: Bearer` 头取令牌（passport.ts ExtractJwt
 *   .fromAuthHeaderAsBearerToken()，不认 query token）。要改后端就得动第 2 棒的
 *   statsRouter —— 违反接力规则 §5 文件归属。所以本文件用 **fetch 流式读取** 实现
 *   与 EventSource 完全相同的协议语义：
 *     ① 解析 `event:` / `data:` / `id:` / `retry:` / `:` 注释行；
 *     ② 服务端下发 `retry: 3000` 就按 3s 重连（含 ±20% 抖动防重连风暴）；
 *     ③ 连续失败按台阶退避 3→6→12→30s 封顶，恢复后自动清零；
 *     ④ 组件卸载 / 手动 close() 时 AbortController 立即断流并清定时器。
 *
 * 三条与后端约定的工程约束对齐（statsRouter.ts 头注释）：
 *   服务端每 5s 聚合一次快照、一条 SQL，前端**只消费不轮询**；
 *   降级项在 snapshot.degraded 里，前端据此做红闪；
 *   任何一路拿不到都不断流 —— 前端同样承诺：单次解析失败不重连。
 */

export interface LiveSnapshot {
  online_count: number;
  online_conn: number;
  today_order_count: number;
  message_count: number;
  seckill_qps: number;
  ts: number;
  /** 哪些指标是降级值（Redis 不可用 / 计数缺失 / MySQL 异常） */
  degraded: string[];
}

export interface LiveStatsHandlers {
  getToken: () => string;
  /** 收到一拍 stats 快照 */
  onStats: (snapshot: LiveSnapshot) => void;
  /** 流建立成功（首次连上与每次重连成功都回调） */
  onOpen?: () => void;
  /** 服务端推来的 event: error（单拍采集失败，流未断） */
  onServerError?: (message: string) => void;
  /** 连接断开（含断开原因），准备重连 */
  onDown?: (reason: string) => void;
}

interface LiveStatsHandle {
  close: () => void;
}

const DEFAULT_RETRY_MS = 3000;
const BACKOFF_CAP_MS = 30000;
/** 空闲超时：服务端 5s 一拍，超过 30s 一拍都没有 → 视为半死连接主动重连 */
const STALL_TIMEOUT_MS = 30000;

/** 解析一块完整的 SSE 事件（已按空行切好） */
function parseSseEvent(block: string): { event: string; dataLines: string[]; retryMs: number | null } {
  let event = 'message';
  const dataLines: string[] = [];
  let retryMs: number | null = null;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue; // 注释 / 心跳行
    const colonIdx = line.indexOf(':');
    const field = colonIdx < 0 ? line : line.slice(0, colonIdx);
    // 规范：冒号后若有空格只剥一个
    let value = colonIdx < 0 ? '' : line.slice(colonIdx + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'retry') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) retryMs = parsed;
    }
    // id 字段本流不使用（服务端仅作单调序号），忽略
  }
  return { event, dataLines, retryMs };
}

/**
 * 建立 /v1/stats/live 的 SSE 消费通道。
 * 用法：
 *   const handle = openLiveStats({ getToken, onStats, onDown });
 *   handle.close();  // 卸载时必须调用，否则 fetch 流和重连定时器会泄漏
 */
export function openLiveStats(handlers: LiveStatsHandlers): LiveStatsHandle {
  let closed = false;
  let abort: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let retryHintMs = DEFAULT_RETRY_MS;
  let consecutiveFailures = 0;

  const clearStall = (): void => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };

  const scheduleReconnect = (reason: string): void => {
    clearStall();
    if (closed) return;
    handlers.onDown?.(reason);
    // 台阶：3 → 6 → 12 → 24 → 30s 封顶，叠 ±20% 抖动
    const step = Math.min(consecutiveFailures, 4);
    const base = Math.min(retryHintMs * Math.pow(2, step), BACKOFF_CAP_MS);
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(base * jitter);
    consecutiveFailures += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void consume();
    }, delay);
  };

  const consume = async (): Promise<void> => {
    if (closed) return;
    abort = new AbortController();
    const token = handlers.getToken();

    try {
      const res = await fetch('/v1/stats/live', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          // 原生 EventSource 给不了的头 —— 这正是改用 fetch 的唯一理由
          Authorization: `Bearer ${token}`
        },
        signal: abort.signal,
        cache: 'no-store'
      });

      if (!res.ok || !res.body) {
        // 401/403：令牌问题，不猛冲，按重连节奏等下一个有效令牌
        scheduleReconnect(`HTTP ${res.status}`);
        return;
      }

      // 连上了：清失败计数，retry 语义回到服务端给的 3s
      consecutiveFailures = 0;
      retryHintMs = DEFAULT_RETRY_MS;
      handlers.onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 半死连接看门狗：30s 没有任何字节就主动断开走重连
      const armStall = (): void => {
        clearStall();
        stallTimer = setTimeout(() => {
          abort?.abort();
        }, STALL_TIMEOUT_MS);
      };
      armStall();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall();
        buffer += decoder.decode(value, { stream: true });

        // 事件块以空行分隔（\n\n；兼容 \r\n\r\n —— 先统一掉 \r\n）
        buffer = buffer.replace(/\r\n/g, '\n');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!block.trim()) continue;

          const parsed = parseSseEvent(block);
          if (parsed.retryMs !== null) retryHintMs = parsed.retryMs;

          if (parsed.event === 'stats' && parsed.dataLines.length) {
            try {
              const snapshot = JSON.parse(parsed.dataLines.join('\n')) as LiveSnapshot;
              handlers.onStats(snapshot);
            } catch {
              // 单拍 JSON 解析失败：按协议承诺「任何一路拿不到都不让流断」，
              // 丢掉这一拍等下一拍，不重连
            }
          } else if (parsed.event === 'error' && parsed.dataLines.length) {
            try {
              const err = JSON.parse(parsed.dataLines.join('\n')) as { message?: string };
              handlers.onServerError?.(err.message ?? '统计采集失败');
            } catch {
              handlers.onServerError?.('统计采集失败');
            }
          }
        }
      }

      // 服务端正常关流（如优雅停机）→ 走重连
      scheduleReconnect('服务端关闭了流');
    } catch (err: any) {
      if (closed || err?.name === 'AbortError') return; // 主动 close，不算故障
      scheduleReconnect(err?.message ? `网络异常：${err.message}` : '网络异常');
    }
  };

  void consume();

  return {
    close: () => {
      closed = true;
      clearStall();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      abort?.abort();
      abort = null;
    }
  };
}
