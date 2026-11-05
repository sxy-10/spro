/**
 * 组员4（阶段三·前端状态流与网络层）
 * Axios 实例 + 三大拦截器，全项目唯一的 HTTP 出口。
 *
 * 拦截器做了四件事：
 * 1. 请求拦截：自动带 Authorization: Bearer <token>；
 * 2. 请求拦截：写请求（POST/PUT/PATCH/DELETE）自动补 Idempotency-Key，
 *    登录态下再补 X-Timestamp / X-Nonce / X-Signature（HMAC-SHA256，密钥=当前 token），
 *    这是 API_V1.md 规定的防重放签名，签名原文必须与实际发出的 body 完全一致；
 * 3. 响应拦截：剥掉 {code,message,data,trace_id} 外壳，code!==0 一律抛 ApiError；
 * 4. 响应拦截：401（业务码 20012）时「单飞」刷新令牌，成功后自动重放原请求一次；
 *    刷新失败则清空会话并抛 AuthExpiredError，UI 订阅到 expired 自动回登录页。
 */
import axios, { AxiosError, AxiosHeaders, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL, API_PREFIX, AUTH_CONFIG } from './config';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getSession,
  updateTokens
} from './session';

/** 后端统一响应外壳 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  trace_id?: string;
}

/** 业务异常：页面只认 ApiError，不用关心 axios 的细节 */
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

  /** 未登录 / 会话失效（后端固定 401 + 20012） */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 20012;
  }

  /** 已登录但没权限（后端固定 403 + 20013），组员5 的守卫用这个判断 */
  get isForbidden(): boolean {
    return this.status === 403 || this.code === 20013;
  }

  /** 限流（429 + 20014） */
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 20014;
  }
}

/** 会话彻底失效时抛出，调用方据此跳登录页 */
export class AuthExpiredError extends ApiError {
  constructor(message = '登录状态已失效，请重新登录') {
    super(401, 20012, message);
    this.name = 'AuthExpiredError';
  }
}

export interface RequestOptions {
  /** 幂等键，重试同一个业务时传同一个值 */
  idempotencyKey?: string;
  /** 额外请求头（如 X-Captcha-Id） */
  headers?: Record<string, string>;
  /** 不携带 Authorization（登录/注册/换票本身用） */
  skipAuth?: boolean;
  /** 禁止 401 自动换票（换票请求自己用，避免递归） */
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

const sha256Hex = async (text: string) =>
  toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

/** HMAC-SHA256：密钥 = 当前 Bearer token */
const hmacSha256Hex = async (key: string, message: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
};

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // 极老浏览器兜底：16-128 位的字母数字与中划线
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** 需要签名与幂等键的方法 */
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
});

/* ------------------------------------------------------------------ */
/* 请求拦截器：鉴权头 + 幂等键 + 防重放签名                              */
/* ------------------------------------------------------------------ */
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

  // 固定 body 的序列化结果：签名 = f(实际发出的字节)，否则后端必然验签失败
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

/* ------------------------------------------------------------------ */
/* 401 静默换票：单飞（同一时刻只发一次 refresh，其余请求在队列里等）      */
/* ------------------------------------------------------------------ */
let renewing: Promise<boolean> | null = null;

const performRenewal = async (): Promise<boolean> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await httpClient.request<ApiEnvelope<Record<string, unknown>>>({
      url: AUTH_CONFIG.refreshPath,
      method: 'POST',
      data: { refresh_token: refreshToken },
      skipAuth: true,
      skipRefresh: true
    } as AxiosRequestConfig);
    const payload = (response.data?.data ?? {}) as {
      token?: string;
      access_token?: string;
      refresh_token?: string;
    };
    const accessToken = payload.token ?? payload.access_token;
    if (!accessToken) return false;
    updateTokens(accessToken, payload.refresh_token ?? refreshToken);
    return true;
  } catch {
    // 404/405/501 = 后端还没实现 refresh 接口，静默降级为重新登录
    return false;
  }
};

/** 外部（例如页面切回前台）也可以主动续期 */
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
    if (!axiosError.response) return new ApiError(0, 0, '网络异常，请检查网络或后端服务是否已启动');
    const status = axiosError.response.status;
    const body = axiosError.response.data;
    const trace = body?.trace_id;
    const message = body?.message ?? `请求失败（HTTP ${status}）`;
    return new ApiError(status, body?.code ?? 0, trace ? `${message}（追踪号：${trace}）` : message, trace);
  }
  return new ApiError(0, 0, error instanceof Error ? error.message : '未知错误');
};

/* ------------------------------------------------------------------ */
/* 响应拦截器：401 换票 → 重放一次                                       */
/* ------------------------------------------------------------------ */
httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const apiError = toApiError(error);
    const config = error.config as InternalConfig | undefined;

    // 只有「带着令牌却被拒」才值得换票；匿名请求的 401 直接抛给调用方
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
    // 重放：重放会再次经过请求拦截器，签名自动用新 token 重算
    return httpClient.request(config);
  }
);

/* ------------------------------------------------------------------ */
/* 对外唯一入口：剥壳 + 类型化                                          */
/* ------------------------------------------------------------------ */
const unwrap = <T>(response: AxiosResponse<ApiEnvelope<T> | undefined>): T => {
  const body = response.data;
  if (response.status === 204 || body === undefined || body === null) return undefined as T;
  if (typeof body !== 'object') return body as unknown as T;
  if (!('code' in body)) return body as unknown as T;
  if (body.code !== 0) throw new ApiError(response.status, body.code, body.message, body.trace_id);
  return body.data;
};

/**
 * 全项目统一请求函数。
 * 兼容旧签名 request(path, method, body, idempotencyKey:string)。
 * 默认泛型保留 any：老代码（App.tsx / BookingScreen.tsx）直接用返回值的字段，
 * 新代码建议显式写 request<MyType>(...)。
 */
export async function request<T = any>(
  path: string,
  method = 'GET',
  body?: unknown,
  options?: string | RequestOptions
): Promise<T> {
  const opts: RequestOptions = typeof options === 'string' ? { idempotencyKey: options } : (options ?? {});
  const config: InternalConfig = {
    url: path,
    method: method.toUpperCase(),
    data: body,
    idempotencyKey: opts.idempotencyKey,
    extraHeaders: opts.headers,
    skipAuth: opts.skipAuth,
    skipRefresh: opts.skipRefresh
  } as InternalConfig;
  const response = await httpClient.request<ApiEnvelope<T>>(config);
  return unwrap<T>(response);
}

/** 需要拿到完整响应（含 trace_id）时用；一般业务直接用 request */
export const rawRequest = async (config: AxiosRequestConfig): Promise<AxiosResponse> =>
  httpClient.request(config);

/** 当前是否有令牌（旧 api.ts 的 isLoggedIn 从这里转发） */
export const hasAccessToken = (): boolean => Boolean(getSession().accessToken);

export default request;
