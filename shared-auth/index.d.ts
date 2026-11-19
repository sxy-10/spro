/**
 * shared-auth · TypeScript 类型声明
 * 供 frontend/src（TS）以 `import ... from '../../shared-auth/index.js'` 引用时获得类型。
 * 运行时实现全部在 .js 文件中（纯 JS、零构建），此文件只做类型描述。
 */

export interface AuthConfig {
  baseUrl: string;
  apiPrefix: string;
  timeoutMs: number;
  refreshPath: string;
  captchaHeader: string;
  persist: 'none' | 'refresh' | 'full';
  storage: 'session' | 'local';
  storageKey: string;
  cacheKeys: { tokens: string; me: string; perms: string };
  loginPath: string;
}

export interface ConfigureAuthOptions extends Partial<Omit<AuthConfig, 'cacheKeys'>> {
  cacheKeys?: Partial<AuthConfig['cacheKeys']>;
}

export function configureAuth(options?: ConfigureAuthOptions): AuthConfig;
export function getAuthConfig(): AuthConfig;
export function getStorage(): Storage | null;

/* ------------------------------ 会话仓库 ----------------------------- */

export interface SessionSnapshot {
  version: number;
  accessToken: string;
  refreshToken: string;
  userId: string;
  user: any;
  permissions: { menus: any[]; buttons: any[] } | null;
  expired: boolean;
}

export function getSession(): SessionSnapshot;
export function subscribeSession(listener: () => void): () => void;
export function getAccessToken(): string;
export function getRefreshToken(): string;
export function getUserId(): string;
export function isLoggedIn(): boolean;
export function startSession(payload: {
  accessToken: string;
  refreshToken?: string;
  userId?: string;
  user?: any;
  permissions?: any;
}): void;
export function updateTokens(accessToken: string, refreshToken?: string): void;
export function setUser(user: any): void;
export function setPermissions(permissions: any): void;
export function clearSession(options?: { expired?: boolean }): void;
export function hydrateSession(): void;

/* ------------------------------- 网络层 ------------------------------ */

export declare class ApiError extends Error {
  readonly status: number;
  readonly code: number;
  readonly traceId?: string;
  constructor(status: number, code: number, message: string, traceId?: string);
  get isUnauthorized(): boolean;
  get isForbidden(): boolean;
  get isRateLimited(): boolean;
}

export declare class AuthExpiredError extends ApiError {
  constructor(message?: string);
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
  /** 不做 HMAC 签名（仍带 Authorization） */
  skipSign?: boolean;
  /** 内部使用：401 重放标记 */
  _retry?: boolean;
}

export function request<T = any>(
  path: string,
  method?: string,
  body?: unknown,
  options?: string | RequestOptions
): Promise<T>;
export function renewToken(): Promise<boolean>;
export function hasAccessToken(): boolean;
export function randomId(): string;

/* ------------------------------ 认证接口 ----------------------------- */

export function fetchCaptcha(): Promise<any>;
export function loginByAccount(input: {
  account: string;
  password: string;
  captchaCode: string;
  captchaId?: string;
}): Promise<any>;
export function loginBySms(mobile: string, smsCode: string): Promise<any>;
export function loginWithPassword(mobile: string, password: string): Promise<any>;
export function registerAccount(mobile: string, password: string): Promise<any>;
export function sendSmsCode(mobile: string, scene?: 'login' | 'reset'): Promise<any>;
export function resetPassword(input: { mobile: string; smsCode: string; newPassword: string }): Promise<void>;
export function loadProfile(userId: string): Promise<any>;
export function loadPermissions(): Promise<any>;
export function logout(): Promise<void>;
export function restoreSession(): Promise<any>;
export function peekSession(): SessionSnapshot;

/* ------------------------------ RBAC 判定 ---------------------------- */

export function hasPermissionCode(permissions: any, code: string): boolean;
export function hasAnyPermissionCode(permissions: any, codes: readonly string[]): boolean;
export function flattenMenus(menus: any[]): any[];
export function canAccessPath(permissions: any, path: string): boolean;
export function roleCodesOf(user: any): string[];
export function currentRoleCodes(): string[];
export function currentPerm(code: string): boolean;
export function currentIsAdmin(): boolean;

/* --------------------------- Web 管理端守卫 -------------------------- */

export function requireSession(options?: { loginPath?: string }): boolean;
export function checkPageAccess(pageRole: 'platform' | 'agency'): string | null;
export function showForbidden(message: string, options?: { homeHref?: string }): void;
