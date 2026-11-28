import { xsrfToken } from './csrf'

/**
 * 长连接换票（S4）。
 *
 * 浏览器不再直接抱着会话去连长连接：客服台的 WS 与大屏的 SSE 都先 POST 换一张
 * 一次性票根（30 秒有效、用后作废），再把它拼进连接 URL。
 * 这样「凭证」在 URL 里只是一次性随机值，Node 的 Bearer token 永远不出服务端。
 */
export interface RealtimeTicket {
  ticket: string
  expires_in: number
  ws_path: string
  sse_path: string
}

export async function fetchRealtimeTicket(): Promise<string> {
  const response = await fetch('/api/realtime/ticket', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrfToken(),
    },
    body: '{}',
  })

  if (!response.ok) {
    throw new Error(`换票失败（HTTP ${response.status}）`)
  }

  const payload = (await response.json()) as { code: number; message: string; data?: RealtimeTicket }
  if (payload.code !== 0 || !payload.data?.ticket) {
    throw new Error(payload.message || '换票失败')
  }
  return payload.data.ticket
}
