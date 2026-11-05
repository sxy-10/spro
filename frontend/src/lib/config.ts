/**
 * 组员4（阶段三·前端状态流与网络层）
 * 全局配置：BaseURL、认证相关常量。
 *
 * 为什么要单独抽 config：
 * 老师强调「Mock 地址不是给人打开看的网址，而是前端代码里的 BaseURL」。
 * 这个文件就是全项目唯一改 BaseURL 的地方，换 Mock / 换真实地址只动 .env，不动任何业务代码。
 */

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** 后端根地址（不含 /v1）。空字符串表示同源，交给 Vite 代理 */
export const API_ORIGIN = stripTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '');

/** 所有接口统一挂在 /v1 下 */
export const API_PREFIX = '/v1';

/** axios 实例的 baseURL：{Apifox Mock 根地址} + /v1 */
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

export const AUTH_CONFIG = {
  /** 静默换票接口。后端未实现时会自动降级为「重新登录」，不会把用户卡住 */
  refreshPath: '/auth/refresh',
  /** 短信验证码倒计时秒数 */
  smsCooldown: 60,
  /** 图形验证码 id 走请求头，避免污染后端 .strict() 的请求体校验 */
  captchaHeader: 'X-Captcha-Id',
  /**
   * 令牌存储策略：默认只在内存（与 API_V1.md「前端只在内存保存令牌，刷新后重新登录」一致）。
   * 需要「刷新页面不掉线」时，把 .env 里 VITE_AUTH_PERSIST 设为 1，仅持久化 refresh_token。
   */
  persistSession: import.meta.env.VITE_AUTH_PERSIST === '1',
  /** sessionStorage 的 key */
  storageKey: 'travel-agent.auth'
} as const;
