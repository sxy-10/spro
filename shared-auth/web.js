/**
 * shared-auth · Web 管理端浏览器入口
 *
 * prototype 的 assets/api.js 通过动态 import() 加载本模块（经典脚本里可用动态 import），
 * 加载完成后同时挂载：
 *   window.SharedAuth  —— 完整共享鉴权 API
 *   window.WebApi      —— 旧版兼容层（与原 prototype/assets/api.js 导出面完全一致，
 *                         既有页面代码零改动）
 *
 * 本模块负责注入 Web 端专属配置：
 *   - baseUrl 允许 localStorage.web_api_base 覆盖（login.html 演示提示的切换后端能力）；
 *   - persist='full'：令牌/用户/权限缓存进 localStorage（key 沿用 web_tokens/web_me/web_perms，
 *     跨页面跳转会话不丢，与旧版行为一致）。
 */
import * as SharedAuth from './index.js';

const base = (typeof localStorage !== 'undefined' && localStorage.getItem('web_api_base')) || '';
SharedAuth.configureAuth({
  baseUrl: base || 'http://127.0.0.1:3001/v1',
  apiPrefix: '/v1',
  persist: 'full',
  storage: 'local',
  cacheKeys: { tokens: 'web_tokens', me: 'web_me', perms: 'web_perms' },
  loginPath: 'login.html'
});
// 多页面场景：从 localStorage 恢复上次登录态（同步执行，requireSession 立即可用）
SharedAuth.hydrateSession();

/**
 * 旧版 WebApi 兼容层：方法名/参数/返回值与原 prototype/assets/api.js 保持一致。
 * 会话数据全部来自共享会话仓库，不再有第二份实现。
 */
const WebApi = {
  get BASE() {
    return SharedAuth.getAuthConfig().baseUrl;
  },
  setBase(value) {
    SharedAuth.configureAuth({ baseUrl: value });
    try { localStorage.setItem('web_api_base', value); } catch (e) { /* 忽略 */ }
  },
  call: SharedAuth.request,
  /**
   * 登录（account + password + captchaCode + captchaId）。
   * 返回 {me, perms}，与旧版 loadSession 的返回结构一致。
   */
  async login(account, password, captchaCode, captchaId) {
    await SharedAuth.loginByAccount({ account, password, captchaCode, captchaId });
    return { me: SharedAuth.getSession().user, perms: SharedAuth.getSession().permissions };
  },
  logout: SharedAuth.logout,
  /** 拉取并写入会话：GET /users/me + GET /users/me/permissions，返回 {me, perms} */
  async loadSession() {
    const results = await Promise.all([
      SharedAuth.request('/users/me'),
      SharedAuth.request('/users/me/permissions')
    ]);
    const me = results[0];
    const perms = results[1];
    SharedAuth.setUser(me);
    SharedAuth.setPermissions({ menus: perms?.menus ?? [], buttons: perms?.buttons ?? [] });
    return { me, perms };
  },
  clearSession: () => SharedAuth.clearSession(),
  get me() {
    return SharedAuth.getSession().user;
  },
  get perms() {
    return SharedAuth.getSession().permissions;
  },
  perm: SharedAuth.currentPerm,
  roleCodes: SharedAuth.currentRoleCodes,
  isAdmin: SharedAuth.currentIsAdmin,
  /** 登录门禁：无令牌跳 login.html?expired=1 并返回 false */
  requireSession(options) {
    return SharedAuth.requireSession(options);
  },
  ApiError: SharedAuth.ApiError,
  uuid: SharedAuth.randomId
};

export { SharedAuth, WebApi };
export default { SharedAuth, WebApi };
