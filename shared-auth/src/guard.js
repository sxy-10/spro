/**
 * shared-auth · Web 管理端页面守卫
 *
 * 提供三层拦截（全部是体验层，真正把关在后端 Casbin）：
 * 1. 登录门禁 requireSession：无令牌 → 跳登录页（?expired=1 提示会话失效）；
 * 2. 页面角色守卫 checkPageAccess：平台页仅 SUPER_ADMIN 可开；社端页拒绝纯游客账号；
 * 3. 越权提示 showForbidden：渲染「无权访问」面板并给出正确的跳转出口，
 *    而不是把页面放行给无权用户。
 */
import { getSession } from './session.js';
import { currentIsAdmin, currentRoleCodes, roleCodesOf } from './rbac.js';
import { getAuthConfig } from './config.js';

/**
 * 登录门禁：无令牌跳登录页并返回 false（调用方应中止初始化）。
 * @param {{loginPath?: string}} options
 */
export function requireSession(options = {}) {
  const loginPath = options.loginPath || getAuthConfig().loginPath;
  if (!getSession().accessToken) {
    window.location.replace(loginPath + '?expired=1');
    return false;
  }
  return true;
}

/**
 * 页面角色守卫。在会话加载完成（me/permissions 已就绪）后调用。
 * @param {'platform'|'agency'} pageRole 页面所属端
 * @returns {string|null} 违规原因描述；null 表示放行
 */
export function checkPageAccess(pageRole) {
  const codes = currentRoleCodes();
  if (!codes.length) return '无法读取当前账号角色，请重新登录';
  if (pageRole === 'platform' && codes.indexOf('SUPER_ADMIN') < 0) {
    return '平台管理页仅限超级管理员访问，当前账号为：' + codes.join(' / ');
  }
  if (pageRole === 'agency' && codes.every((code) => code === 'TOURIST')) {
    return '游客账号无法访问管理端页面，请使用 C 端 App';
  }
  return null;
}

/**
 * 渲染「无权访问」全屏面板（覆盖式，不执行页面业务逻辑）。
 * @param {string} message 违规原因
 * @param {{homeHref?: string}} options 可指定正确首页链接
 */
export function showForbidden(message, options = {}) {
  const home = options.homeHref || (currentIsAdmin() ? 'platform-dashboard.html' : 'agency-dashboard.html');
  const me = getSession().user;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;' +
    'background:#f4f7f5;font-family:inherit';
  overlay.innerHTML =
    '<div style="background:#fff;border:1px solid #dbe5dd;border-radius:14px;padding:38px 42px;' +
    'max-width:460px;text-align:center;box-shadow:0 16px 48px rgba(22,60,30,.12)">' +
    '<div style="font-size:44px;line-height:1;margin-bottom:14px">🔒</div>' +
    '<h1 style="font-size:19px;margin:0 0 10px;color:#1f3a28">无权访问此页面</h1>' +
    '<p style="font-size:13px;color:#5d7263;margin:0 0 6px;line-height:1.8">' + String(message || '') + '</p>' +
    '<p style="font-size:12px;color:#8ba192;margin:0 0 22px">当前登录：' +
    ((me && (me.nickname || me.user_id)) || '未知用户') + '</p>' +
    '<div style="display:flex;gap:10px;justify-content:center">' +
    '<a href="' + home + '" style="padding:8px 18px;border-radius:8px;background:#2f6e3e;color:#fff;' +
    'text-decoration:none;font-size:13px">前往我有权限的首页</a>' +
    '<button id="shared-auth-logout" style="padding:8px 18px;border-radius:8px;border:1px solid #dbe5dd;' +
    'background:#fff;color:#b23c3c;font-size:13px;cursor:pointer">退出登录</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#shared-auth-logout').addEventListener('click', () => {
    // 动态引出 logout，避免 guard ↔ auth 循环依赖
    import('./auth.js').then((mod) => mod.logout()).then(() => {
      window.location.replace(getAuthConfig().loginPath);
    });
  });
}

/** 角色码数组便捷导出（页面脚本无需再自己 map） */
export { roleCodesOf };
