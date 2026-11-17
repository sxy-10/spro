/**
 * shared-auth · 网络层（全项目唯一 HTTP 出口，fetch 实现、零依赖）
 *
 * 与后端契约（backend/src/api/core.ts + API_V1.md）逐条对齐：
 * 1. 统一包络 {code, message, data, trace_id}，code !== 0 视为业务错误抛 ApiError；
 * 2. 自动携带 Authorization: Bearer <token>；
 * 3. 写请求（POST/PUT/PATCH/DELETE）自动补 Idempotency-Key（后端 write() 强制校验）；
 * 4. 登录态写请求补 HMAC-SHA256 防重放签名，签名原文必须与实际发出的 body 完全一致：
 *      message = METHOD \n /v1原始路径(含query) \n X-Timestamp \n X-Nonce \n sha256(body)
 *      key     = 当前 access token；时间戳必须以 Z 结尾（后端 zod offset:false）
 * 5. 401（业务码 20012）时「单飞」刷新令牌，成功后自动重放原请求一次（重放自动用新 token 重签）；
 *    刷新失败清空会话并抛 AuthExpiredError，UI 订阅 expired 自动回登录页。
 */
import { getAuthConfig } from './config.js';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  updateTokens
} from './session.js';

/** 业务异常：页面只认 ApiError，不关心传输细节 */
export class ApiError extends Error {
  constructor(status, code, message, traceId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
  /** 未登录 / 会话失效（后端固定 401 + 20012） */
  get isUnauthorized() {
    return this.status === 401 || this.code === 20012;
  }
  /** 已登录但没权限（后端固定 403 + 20013），页面守卫用这个判断 */
  get isForbidden() {
    return this.status === 403 || this.code === 20013;
  }
  /** 限流（429 + 20014） */
  get isRateLimited() {
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

const encoder = new TextEncoder();
const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (text) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

/** HMAC-SHA256：密钥 = 当前 Bearer token */
const hmacSha256Hex = async (key, message) => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
};

export const randomId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/* ------------------------------------------------------------------ */
/* 401 静默换票：单飞（同一时刻只发一次 refresh，其余请求排队等）          */
/* ------------------------------------------------------------------ */
let renewing = null;

const performRenewal = async () => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const cfg = getAuthConfig();
  try {
    const res = await fetch(cfg.baseUrl + cfg.refreshPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const env = await res.json().catch(() => null);
    const payload = (env && env.data) || {};
    const accessToken = payload.token ?? payload.access_token;
    if (!env || env.code !== 0 || !accessToken) return false;
    updateTokens(accessToken, payload.refresh_token ?? refreshToken);
    return true;
  } catch {
    // 404/405/501 = 后端还没实现 refresh 接口，静默降级为重新登录
    return false;
  }
};

/** 外部（页面切回前台、restoreSession）也可以主动续期 */
export const renewToken = () => {
  if (!renewing) {
    renewing = performRenewal().finally(() => {
      renewing = null;
    });
  }
  return renewing;
};

/** 当前是否有令牌（旧 http.ts 的 hasAccessToken 从这里转发） */
export const hasAccessToken = () => Boolean(getAccessToken());

/* ------------------------------------------------------------------ */
/* 统一请求函数                                                        */
/* ------------------------------------------------------------------ */
/**
 * request(path, method?, body?, options?)
 * options 兼容旧签名：传 string 视为 idempotencyKey。
 * 返回剥壳后的 data；失败抛 ApiError（页面无需处理包络）。
 */
export async function request(path, method = 'GET', body, options) {
  const cfg = getAuthConfig();
  let opts = options ?? {};
  if (typeof opts === 'string') opts = { idempotencyKey: opts };
  const verb = String(method || 'GET').toUpperCase();
  const isWrite = WRITE_METHODS.includes(verb);
  const accessToken = getAccessToken();

  // body 序列化规则与两个历史实现完全一致：
  //   GET/DELETE 且未显式传 body → 不发请求体，签名摘要取 sha256('')
  //   POST/PUT/PATCH 未传 body  → 发 '{}'
  let bodyText;
  if (body !== undefined && body !== null) bodyText = JSON.stringify(body);
  else if (verb !== 'GET' && verb !== 'DELETE' && verb !== 'HEAD') bodyText = '{}';

  const url = cfg.baseUrl + path + (opts._retry ? (path.indexOf('?') >= 0 ? '&' : '?') + '_r=1' : '');
  const headers = { Accept: 'application/json' };
  if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.skipAuth && accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
  // 额外请求头（如登录的 X-Captcha-Id）
  if (opts.headers) {
    for (const [name, value] of Object.entries(opts.headers)) headers[name] = value;
  }

  const signNeeded = isWrite && !opts.skipAuth && accessToken && !opts.skipSign;
  let signedPath = '';
  if (isWrite) {
    // 幂等键：所有写请求无条件携带（后端 write() 强制校验，匿名写如登录也不例外）
    headers['Idempotency-Key'] = opts.idempotencyKey || randomId();
  }
  if (signNeeded) {
    headers['X-Timestamp'] = new Date().toISOString();
    headers['X-Nonce'] = randomId();
    // 后端 req.originalUrl 带 /v1 前缀（baseUrl 以 /v1 结尾），签名原文必须逐字节一致
    signedPath = cfg.apiPrefix + path + (opts._retry ? (path.indexOf('?') >= 0 ? '&' : '?') + '_r=1' : '');
  }

  const doSign = async () => {
    if (!signNeeded) return;
    const digest = await sha256Hex(bodyText ?? '');
    headers['X-Signature'] = await hmacSha256Hex(accessToken, [verb, signedPath, headers['X-Timestamp'], headers['X-Nonce'], digest].join('\n'));
  };

  const send = async () => {
    await doSign();
    const res = await fetch(url, {
      method: verb,
      headers,
      body: bodyText,
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(cfg.timeoutMs) : undefined
    });
    const env = await res.json().catch(() => ({ code: -1, message: '响应解析失败' }));
    // 401：只有「带着令牌却被拒」才值得换票；匿名请求的 401 直接抛给调用方
    const hasCredential = Boolean(getAccessToken() || getRefreshToken());
    const shouldRenew =
      res.status === 401 && hasCredential && !opts._retry && !opts.skipRefresh && !opts.skipAuth;
    if (shouldRenew) {
      const renewed = await renewToken();
      if (!renewed) {
        clearSession({ expired: true });
        throw new AuthExpiredError();
      }
      // 重放：重新走一遍 request，签名自动用新 token 重算
      return request(path, verb, body, { ...opts, _retry: true });
    }
    if (res.status >= 400 || env.code !== 0) {
      if (res.status === 401 && opts._retry) clearSession({ expired: true });
      throw new ApiError(res.status, env.code ?? 0, env.message || `请求失败（HTTP ${res.status}）`, env.trace_id);
    }
    return env.data;
  };

  return send();
}
