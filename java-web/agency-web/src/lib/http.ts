import { xsrfToken } from './csrf'

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
  trace_id?: string
}

export class ApiError extends Error {
  readonly code: number
  readonly status: number
  readonly traceId?: string

  constructor(code: number, message: string, status: number, traceId?: string) {
    super(message)
    this.code = code
    this.status = status
    this.traceId = traceId
  }

  /** 20012 / 401：会话没了，调用方应把用户送回登录页。 */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 20012
  }

  /** 20013 / 403：已登录但越权（或 CSRF 失败）。 */
  get isForbidden(): boolean {
    return this.status === 403 || this.code === 20013
  }
}

/**
 * 同源请求层：只发 Cookie，不带任何 token，也不做签名。
 * 写请求自动回填 X-XSRF-TOKEN（Spring Security 的 CSRF Cookie 模式）。
 */
async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...extraHeaders,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const token = xsrfToken()
    if (token) {
      headers['X-XSRF-TOKEN'] = token
    }
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : null

  if (!response.ok) {
    throw new ApiError(
      payload?.code ?? response.status,
      payload?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      payload?.trace_id,
    )
  }
  if (!payload) {
    throw new ApiError(-1, '响应为空', response.status)
  }
  if (payload.code !== 0) {
    throw new ApiError(payload.code, payload.message, response.status, payload.trace_id)
  }
  return payload.data
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  /** Node 的删除接口也走幂等写，BFF 会补签名与 Idempotency-Key，前端照常带 XSRF 即可。 */
  del: <T>(path: string) => request<T>('DELETE', path),
}

/** 拼查询串：空值直接丢弃，避免 Node 的 strict 校验报"未知参数"。 */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}
