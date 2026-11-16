/**
 * 网络层：axios 实例 + 四个拦截器，与 C 端 frontend/src/lib/http.ts 同一套语义。
 *
 * 1. 请求拦截：自动带 Authorization: Bearer <token>；
 * 2. 写请求自动补 Idempotency-Key；登录态下再补 X-Timestamp / X-Nonce / X-Signature
 *    （HMAC-SHA256，密钥=当前 token，签名原文 = METHOD\n/v1路径\nts\nnonce\nsha256(body)）；
 * 3. 响应拦截：剥掉 {code,message,data,trace_id} 外壳，code!==0 抛 ApiError；
 * 4. 401（业务码 20012）单飞刷新令牌，成功后重放原请求一次，失败清会话抛 AuthExpiredError。
 */
import axios, { AxiosError, AxiosHeaders, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ApiEnvelope } from '../types';
import { clearSession, getAccessToken, getRefreshToken, getUserId, setTokens } from './session';

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** 后端根地址（不含 /v1），空 = 同源交给 Vite 代理 */
export const API_ORIGIN = stripTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '');
export const API_PREFIX = '/v1';
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

/** 业务异常：页面只认 ApiError */
export class ApiError extends Error {
  readonly status: number;
  readonly code: number;
  readonly traceId?: string;

  constructor(status: number, code: number, message: string, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 20012;
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.code === 20013;
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 20014;
  }
}

export class AuthExpiredError extends ApiError {
  constructor(message = '登录状态已失效，请重新登录') {
    super(401, 20012, message);
    this.name = 'AuthExpiredError';
  }
}

export interface RequestOptions {
  idempotencyKey?: string;
  headers?: Record<string, string>;
  /** 不携带 Authorization（登录/换票本身用） */
  skipAuth?: boolean;
  /** 禁止 401 自动换票（换票请求自己用） */
  skipRefresh?: boolean;
}

type InternalConfig = InternalAxiosRequestConfig & {
  idempotencyKey?: string;
  extraHeaders?: Record<string, string>;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  retried?: boolean;
};

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (text: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

const hmacSha256Hex = async (key: string, message: string) => {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
};

const randomId = (): string =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
});

/* ---------------- 请求拦截：鉴权头 + 幂等键 + 防重放签名 ---------------- */
httpClient.interceptors.request.use(async (config) => {
  const internal = config as InternalConfig;
  const method = (internal.method ?? 'get').toUpperCase();
  const headers = internal.headers instanceof AxiosHeaders ? internal.headers : new AxiosHeaders(internal.headers);

  if (internal.extraHeaders) {
    for (const [name, value] of Object.entries(internal.extraHeaders)) headers.set(name, value);
  }

  const accessToken = getAccessToken();
  if (!internal.skipAuth && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  } else {
    headers.delete('Authorization');
  }

  if (!WRITE_METHODS.includes(method)) return internal;

  if (!internal.idempotencyKey) internal.idempotencyKey = randomId();
  headers.set('Idempotency-Key', internal.idempotencyKey);

  // 固定 body 序列化结果：签名必须对实际发出的字节
  const rawBody =
    typeof internal.data === 'string'
      ? internal.data
      : internal.data === undefined || internal.data === null
        ? '{}'
        : JSON.stringify(internal.data);
  internal.data = rawBody;

  if (!internal.skipAuth && accessToken) {
    const timestamp = new Date().toISOString();
    const nonce = randomId();
    const digest = await sha256Hex(rawBody);
    const path = `${API_PREFIX}${internal.url ?? ''}`;
    const message = [method, path, timestamp, nonce, digest].join('\n');
    headers.set('X-Timestamp', timestamp);
    headers.set('X-Nonce', nonce);
    headers.set('X-Signature', await hmacSha256Hex(accessToken, message));
  } else {
    headers.delete('X-Timestamp');
    headers.delete('X-Nonce');
    headers.delete('X-Signature');
  }
  return internal;
});

/* ---------------- 401 单飞换票 ---------------- */
let renewing: Promise<boolean> | null = null;

const performRenewal = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await httpClient.request<ApiEnvelope<Record<string, unknown>>>({
      url: '/auth/refresh',
      method: 'POST',
      data: { refresh_token: refreshToken },
      skipAuth: true,
      skipRefresh: true
    } as AxiosRequestConfig);
    const payload = (response.data?.data ?? {}) as { token?: string; refresh_token?: string; user_id?: string };
    if (!payload.token) return false;
    setTokens({
      token: payload.token,
      refresh_token: payload.refresh_token ?? refreshToken,
      user_id: payload.user_id ?? getUserId() ?? ''
    });
    return true;
  } catch {
    return false;
  }
};

export const renewToken = (): Promise<boolean> => {
  if (!renewing) {
    renewing = performRenewal().finally(() => {
      renewing = null;
    });
  }
  return renewing;
};

const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiEnvelope<unknown>>;
    if (axiosError.code === 'ECONNABORTED') return new ApiError(0, 0, '请求超时，请稍后重试');
    if (!axiosError.response) return new ApiError(0, 0, '网络异常，请检查后端服务是否已启动');
    const status = axiosError.response.status;
    const body = axiosError.response.data;
    const message = body?.message ?? `请求失败（HTTP ${status}）`;
    return new ApiError(status, body?.code ?? 0, body?.trace_id ? `${message}（追踪号：${body.trace_id}）` : message, body?.trace_id);
  }
  return new ApiError(0, 0, error instanceof Error ? error.message : '未知错误');
};

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const apiError = toApiError(error);
    const config = error.config as InternalConfig | undefined;
    const hasCredential = Boolean(getAccessToken() || getRefreshToken());
    const shouldRenew =
      apiError.isUnauthorized && config && !config.retried && !config.skipRefresh && !config.skipAuth && hasCredential;
    if (!shouldRenew) throw apiError;

    config.retried = true;
    const renewed = await renewToken();
    if (!renewed) {
      clearSession({ expired: true });
      throw new AuthExpiredError();
    }
    return httpClient.request(config);
  }
);

/* ---------------- 对外唯一入口：剥壳 ---------------- */
const unwrap = <T>(response: AxiosResponse<ApiEnvelope<T> | undefined>): T => {
  const body = response.data;
  if (response.status === 204 || body === undefined || body === null) return undefined as T;
  if (typeof body !== 'object') return body as T;
  if (!('code' in body)) return body as T;
  if (body.code !== 0) throw new ApiError(response.status, body.code, body.message, body.trace_id);
  return body.data;
};

export async function request<T = unknown>(path: string, method = 'GET', body?: unknown, options?: RequestOptions): Promise<T> {
  const config: InternalConfig = {
    url: path,
    method: method.toUpperCase(),
    data: body,
    idempotencyKey: options?.idempotencyKey,
    extraHeaders: options?.headers,
    skipAuth: options?.skipAuth,
    skipRefresh: options?.skipRefresh
  } as InternalConfig;
  const response = await httpClient.request<ApiEnvelope<T>>(config);
  return unwrap<T>(response);
}
