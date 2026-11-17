/**
 * 组员4（阶段三·前端状态流与网络层）
 * 全局配置：BaseURL、认证相关常量。
 *
 * 鉴权实现已迁移至根目录 shared-auth/ 共享包（与 Web 管理端共用同一份），
 * 本文件只做两件事：
 * 1. 计算 C 端专属 BaseURL（Vite env / Capacitor 原生平台）；
 * 2. 启动时把配置注入共享包（configureAuth），并保留 AUTH_CONFIG 常量供组件读取。
 * 换 Mock / 换真实地址只动 .env，不动任何业务代码。
 */
import { Capacitor } from '@capacitor/core';
import { configureAuth } from '../../../shared-auth/index.js';

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** 动态计算后端根地址（不含 /v1）。 */
const resolveApiOrigin = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return stripTrailingSlash(import.meta.env.VITE_API_BASE_URL);
  }
  if (Capacitor.isNativePlatform()) {
    const customHost = localStorage.getItem('travel_api_base_url');
    return stripTrailingSlash(customHost || 'http://10.0.2.2:3001');
  }
  return '';
};

export const API_ORIGIN = resolveApiOrigin();

/** 所有接口统一挂在 /v1 下 */
export const API_PREFIX = '/v1';

/** axios 实例的 baseURL：{Apifox Mock 根地址} + /v1 */
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

/**
 * 令牌存储策略：默认只在内存（与 API_V1.md「前端只在内存保存令牌，刷新后重新登录」一致）。
 * 需要「刷新页面不掉线」时，把 .env 里 VITE_AUTH_PERSIST 设为 1，仅持久化 refresh_token。
 */
const persistSession = import.meta.env.VITE_AUTH_PERSIST === '1';

/** 注入共享鉴权包：C 端令牌仅内存，可选仅持久化 refresh_token（sessionStorage） */
configureAuth({
  baseUrl: API_BASE_URL,
  apiPrefix: API_PREFIX,
  refreshPath: '/auth/refresh',
  captchaHeader: 'X-Captcha-Id',
  persist: persistSession ? 'refresh' : 'none',
  storage: 'session',
  storageKey: 'travel-agent.auth'
});

export const AUTH_CONFIG = {
  /** 静默换票接口。后端未实现时会自动降级为「重新登录」，不会把用户卡住 */
  refreshPath: '/auth/refresh',
  /** 短信验证码倒计时秒数 */
  smsCooldown: 60,
  /** 图形验证码 id 走请求头，避免污染后端 .strict() 的请求体校验 */
  captchaHeader: 'X-Captcha-Id',
  persistSession,
  /** sessionStorage 的 key */
  storageKey: 'travel-agent.auth'
} as const;
