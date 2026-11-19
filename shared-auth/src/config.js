/**
 * shared-auth · 全局配置
 *
 * 跨端共享的鉴权包唯一配置入口：
 * - C 端（frontend/src/lib/config.ts）在模块加载时调用 configureAuth() 注入 Vite/Capacitor 计算出的 BaseURL；
 * - Web 管理端（prototype）由 web.js 读取 localStorage 的 web_api_base 后注入。
 * 所有配置项都是「运行时可变」，http/session 模块在每次请求时读取，避免 import 时序问题。
 */

const defaults = {
  /** 后端 API 根地址（含 /v1 前缀） */
  baseUrl: 'http://127.0.0.1:3001/v1',
  /** 统一 API 前缀（参与 HMAC 签名原文，必须与后端 req.originalUrl 前缀一致） */
  apiPrefix: '/v1',
  /** 请求超时（毫秒），fetch + AbortSignal.timeout */
  timeoutMs: 30000,
  /** 静默换票接口；后端未实现时自动降级为重新登录 */
  refreshPath: '/auth/refresh',
  /** 图形验证码 id 走请求头，避免污染后端 .strict() 请求体校验 */
  captchaHeader: 'X-Captcha-Id',
  /**
   * 令牌持久化策略：
   * - 'none'    仅内存（C 端默认，XSS 拿不到；刷新页面需重新登录）
   * - 'refresh' 仅持久化 refresh_token + userId（C 端 VITE_AUTH_PERSIST=1 时启用，存 sessionStorage）
   * - 'full'    完整令牌 + 用户 + 权限缓存（Web 管理端多页面跳转需要，存 localStorage）
   */
  persist: 'none',
  /** 持久化使用的 storage：'session' | 'local' */
  storage: 'session',
  /** 'refresh' 模式的 sessionStorage key（与 C 端历史 key 保持一致） */
  storageKey: 'shared-auth',
  /** 'full' 模式的 localStorage key（与 prototype 历史 key 保持一致） */
  cacheKeys: { tokens: 'web_tokens', me: 'web_me', perms: 'web_perms' },
  /** 会话失效/未登录时的登录页（Web 端守卫跳转用） */
  loginPath: 'login.html'
};

let state = { ...defaults, cacheKeys: { ...defaults.cacheKeys } };

/** 合并配置；未传的字段保持原值。必须在发第一个请求前调用。 */
export function configureAuth(options = {}) {
  const next = { ...state, ...options };
  next.cacheKeys = { ...state.cacheKeys, ...(options.cacheKeys || {}) };
  state = next;
  return getAuthConfig();
}

export function getAuthConfig() {
  return state;
}

/** 取 storage 实现（仅浏览器环境可用；Node 冒烟测试下返回 null） */
export function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return state.storage === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}
