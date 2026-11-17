/**
 * shared-auth · 公共入口
 *
 * 跨端共享的鉴权包：C 端 React 应用（frontend/src/lib 薄壳）与
 * Web 管理端原型（prototype/assets/api.js 兼容层）共用这一份实现。
 *
 * 模块分层：
 *   config.js   全局配置（baseUrl / persist / storage key），configureAuth() 注入
 *   session.js  会话仓库（令牌/用户/权限，订阅式，多档持久化）
 *   http.js     网络层（包络剥壳 / Bearer / 幂等键 / HMAC 防重放 / 401 单飞刷新重放）
 *   auth.js     认证接口（验证码 / 登录 / 短信 / 重置密码 / 资料 / 权限拉取 / 登出 / 恢复）
 *   rbac.js     权限判定纯函数（hasPermissionCode / canAccessPath / 角色码）
 *   guard.js    Web 管理端守卫（登录门禁 / 角色守卫 / 无权面板）
 */
export { configureAuth, getAuthConfig, getStorage } from './src/config.js';

export {
  getSession,
  subscribeSession,
  getAccessToken,
  getRefreshToken,
  getUserId,
  isLoggedIn,
  startSession,
  updateTokens,
  setUser,
  setPermissions,
  clearSession,
  hydrateSession
} from './src/session.js';

export {
  ApiError,
  AuthExpiredError,
  request,
  renewToken,
  hasAccessToken,
  randomId
} from './src/http.js';

export {
  fetchCaptcha,
  loginByAccount,
  loginBySms,
  loginWithPassword,
  registerAccount,
  sendSmsCode,
  resetPassword,
  loadProfile,
  loadPermissions,
  logout,
  restoreSession,
  peekSession
} from './src/auth.js';

export {
  hasPermissionCode,
  hasAnyPermissionCode,
  flattenMenus,
  canAccessPath,
  roleCodesOf,
  currentRoleCodes,
  currentPerm,
  currentIsAdmin
} from './src/rbac.js';

export { requireSession, checkPageAccess, showForbidden } from './src/guard.js';
