/**
 * shared-auth · 认证接口封装
 *
 * 对应后端 4+1 个认证接口：
 *   POST /v1/auth/login/account  统一账号登录（account + password + captcha_code，验证码 id 走请求头）
 *   GET  /v1/auth/captcha        图形验证码（captcha_id + captcha_image + dev_code）
 *   POST /v1/auth/login/sms      短信登录（mobile + sms_code）
 *   POST /v1/auth/reset-password 重置密码（mobile + sms_code + new_password）
 *   POST /v1/auth/logout         退出登录
 * 登录成功统一收口 completeLogin：写令牌 → 拉资料 → 拉权限；任一步失败整体回滚，不留半登录态。
 */
import { getAuthConfig } from './config.js';
import { ApiError, request, renewToken } from './http.js';
import {
  clearSession,
  getRefreshToken,
  getSession,
  setPermissions,
  setUser,
  startSession
} from './session.js';

/* ----------------------------- 图形验证码 ----------------------------- */

export const fetchCaptcha = () => request('/auth/captcha');

/* ------------------------------- 登录 -------------------------------- */

/** 统一账号登录：账号/手机号 + 密码 + 图形验证码 */
export async function loginByAccount(input) {
  const opts = {};
  if (input.captchaId) opts.headers = { [getAuthConfig().captchaHeader]: input.captchaId };
  const result = await request(
    '/auth/login/account',
    'POST',
    { account: input.account, password: input.password, captcha_code: input.captchaCode },
    opts
  );
  return completeLogin(result);
}

/** 短信验证码登录 */
export async function loginBySms(mobile, smsCode) {
  const result = await request('/auth/login/sms', 'POST', { mobile, sms_code: smsCode });
  return completeLogin(result);
}

/** 手机号 + 密码（旧接口，无验证码）：注册成功后自动登录用 */
export async function loginWithPassword(mobile, password) {
  const result = await request('/auth/login', 'POST', { mobile, password });
  return completeLogin(result);
}

export const registerAccount = (mobile, password) =>
  request('/auth/register', 'POST', { mobile, password });

/**
 * 发送短信验证码。
 * 开发环境后端把码原样回传 dev_code 供页面显示；
 * 接口未实现（401/403/404/405/501）时降级为提示，调用方照常启动倒计时。
 */
export async function sendSmsCode(mobile, scene = 'login') {
  try {
    const data = await request('/auth/sms/send', 'POST', { mobile, scene });
    return { sent: true, devCode: data?.dev_code };
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404, 405, 501].includes(error.status)) {
      return { sent: false, hint: '短信服务暂不可用，请改用密码登录' };
    }
    throw error;
  }
}

/* ----------------------------- 找回密码 ------------------------------ */

export async function resetPassword(input) {
  await request('/auth/reset-password', 'POST', {
    mobile: input.mobile,
    sms_code: input.smsCode,
    new_password: input.newPassword
  });
}

/* ------------------------------ 资料/权限 ---------------------------- */

const maskMobile = (value) => value?.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') ?? value;

/**
 * 拉取当前用户资料（GET /users/me，失败降级 GET /users/{id}）。
 * roles 统一折算成角色码字符串数组（C 端历史口径）；
 * 原始角色对象（含显示名 name）保存在 roles_detail，供 Web 端顶栏展示。
 */
export const loadProfile = async (userId) => {
  try {
    const me = await request('/users/me');
    if (me && (me.user_id || me.id)) {
      const roleList = Array.isArray(me.roles) ? me.roles : [];
      const codes = roleList.map((r) => (typeof r === 'string' ? r : r?.code)).filter(Boolean);
      return {
        ...me,
        user_id: String(me.user_id || me.id || userId),
        mobile: me.phone ? maskMobile(me.phone) : (me.mobile || null),
        roles: codes,
        role: codes[0] || me.role,
        roles_detail: roleList
      };
    }
  } catch {
    // 优雅降级走基础用户资料接口
  }
  const profile = await request(`/users/${userId}`);
  return { ...profile, user_id: userId };
};

/**
 * 动态菜单/按钮权限：GET /users/me/permissions → {menus, buttons}
 * 登录成功后顺手取一次，失败不影响登录。
 */
export const loadPermissions = async () => {
  try {
    const data = await request('/users/me/permissions');
    return { menus: data?.menus ?? [], buttons: data?.buttons ?? [] };
  } catch {
    return null;
  }
};

/** 登录成功后的统一收口：写令牌 → 拉资料 → 拉权限 */
async function completeLogin(result) {
  startSession({
    accessToken: result.token,
    refreshToken: result.refresh_token,
    userId: result.user_id
  });
  try {
    const user = await loadProfile(result.user_id);
    setUser(user);
    const permissions = await loadPermissions();
    if (permissions) setPermissions(permissions);
    return user;
  } catch (error) {
    // 拿到票却拉不到资料（例如后端会话表异常）→ 整体回滚，不留半登录态
    clearSession();
    throw error;
  }
}

/* ------------------------------- 登出 -------------------------------- */

export async function logout() {
  try {
    await request('/auth/logout', 'POST', {});
  } catch {
    // 令牌已过期时退出也要能清干净本地状态，不能把用户锁在页面上
  } finally {
    clearSession();
  }
}

/* --------------------------- 刷新页面后恢复 -------------------------- */

/**
 * 仅当 persist='refresh'（sessionStorage 里有 refresh_token）时可用：
 * 用 refresh_token 换新 access_token，再拉一次资料。返回 null 表示没恢复成功。
 */
export async function restoreSession() {
  if (!getRefreshToken()) return null;
  const renewed = await renewToken();
  if (!renewed) return null;
  const userId = getSession().userId;
  if (!userId) return null;
  try {
    const user = await loadProfile(userId);
    setUser(user);
    const permissions = await loadPermissions();
    if (permissions) setPermissions(permissions);
    return user;
  } catch {
    return null;
  }
}

/** 供 UI 显示「当前令牌是否快过期」等提示时使用 */
export const peekSession = () => getSession();
