/**
 * 组员4（阶段三·前端状态流与网络层）
 * 认证相关的全部接口，页面只调这里，不直接写 URL。
 *
 * 对应后端（组员3）已交付的 4 个接口：
 *   POST /v1/auth/login/account  统一账号登录（account + password + captcha_code）
 *   GET  /v1/auth/captcha        图形验证码（captcha_id + captcha_image + dev_code）
 *   POST /v1/auth/login/sms      短信登录（mobile + sms_code，码由 /v1/auth/sms/send 下发）
 *   POST /v1/auth/reset-password 重置密码（mobile + sms_code + new_password）
 * 另有旧的 POST /v1/auth/login（mobile + password，不带验证码）用于「注册后自动登录」。
 */
import { AUTH_CONFIG } from './config';
import { ApiError, request, renewToken } from './http';
import {
  clearSession,
  getRefreshToken,
  getSession,
  setPermissions,
  setUser,
  startSession
} from './session';
import type { AuthPermissions, AuthUser } from './session';

export interface LoginResult {
  token: string;
  user_id: string;
  /** 后端实现 /auth/refresh 后才会返回；目前没有也不影响登录 */
  refresh_token?: string;
  expires_in?: number;
  login_type?: string;
}

export interface CaptchaResult {
  captcha_id: string;
  /** SVG 字符串（svg-captcha）或 data:image 开头的数据 URI */
  captcha_image: string;
  /** 仅开发环境返回的答案，用于自测；上线前必须让后端删掉 */
  dev_code?: string;
}

export interface SmsSendResult {
  sent: boolean;
  hint?: string;
  /** 开发环境后端把下发的验证码原样回传，页面上要显示出来，否则用户没法知道码 */
  devCode?: string;
}

/* ----------------------------- 图形验证码 ----------------------------- */

export const fetchCaptcha = (): Promise<CaptchaResult> => request<CaptchaResult>('/auth/captcha');

/* ------------------------------- 登录 -------------------------------- */

export interface AccountLoginInput {
  account: string;
  password: string;
  captchaCode: string;
  captchaId?: string;
}

/** 统一账号登录：账号/手机号 + 密码 + 图形验证码 */
export async function loginByAccount(input: AccountLoginInput): Promise<AuthUser> {
  const result = await request<LoginResult>(
    '/auth/login/account',
    'POST',
    { account: input.account, password: input.password, captcha_code: input.captchaCode },
    input.captchaId ? { headers: { [AUTH_CONFIG.captchaHeader]: input.captchaId } } : undefined
  );
  return completeLogin(result);
}

/** 短信验证码登录 */
export async function loginBySms(mobile: string, smsCode: string): Promise<AuthUser> {
  const result = await request<LoginResult>('/auth/login/sms', 'POST', { mobile, sms_code: smsCode });
  return completeLogin(result);
}

/** 手机号 + 密码（旧接口，无验证码）：注册成功后自动登录用 */
export async function loginWithPassword(mobile: string, password: string): Promise<AuthUser> {
  const result = await request<LoginResult>('/auth/login', 'POST', { mobile, password });
  return completeLogin(result);
}

export const registerAccount = (mobile: string, password: string) =>
  request<{ user_id: string }>('/auth/register', 'POST', { mobile, password });

/**
 * 发送短信验证码。
 * 后端 /auth/sms/send 生成 6 位随机码并保存（5 分钟有效），开发环境把码原样回传 dev_code
 * 供页面显示；登录/重置密码只按这个码校验，没有任何固定兜底码。
 * 若该接口尚未实现（401/403/404/405/501），降级成提示，并让调用方照常启动 60 秒倒计时。
 */
export async function sendSmsCode(mobile: string, scene: 'login' | 'reset' = 'login'): Promise<SmsSendResult> {
  try {
    const data = await request<{ sent?: boolean; dev_code?: string; expires_in?: number }>('/auth/sms/send', 'POST', {
      mobile,
      scene
    });
    return { sent: true, devCode: data?.dev_code };
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404, 405, 501].includes(error.status)) {
      return { sent: false, hint: '短信服务暂不可用，请改用密码登录' };
    }
    throw error;
  }
}

/* ----------------------------- 找回密码 ------------------------------ */

export async function resetPassword(input: {
  mobile: string;
  smsCode: string;
  newPassword: string;
}): Promise<void> {
  await request('/auth/reset-password', 'POST', {
    mobile: input.mobile,
    sms_code: input.smsCode,
    new_password: input.newPassword
  });
}

/* ------------------------------ 资料/权限 ---------------------------- */

const maskMobile = (value?: string | null) => value?.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') ?? value;

export const loadProfile = async (userId: string): Promise<AuthUser> => {
  try {
    const me = await request<any>('/users/me');
    if (me && (me.user_id || me.id)) {
      const roleCodes: string[] = Array.isArray(me.roles)
        ? me.roles.map((r: any) => (typeof r === 'string' ? r : r.code)).filter(Boolean)
        : [];
      return {
        ...me,
        user_id: String(me.user_id || me.id || userId),
        mobile: me.phone ? maskMobile(me.phone) : (me.mobile || null),
        roles: roleCodes,
        role: roleCodes[0] || me.role
      };
    }
  } catch {
    // 优雅降级走基础用户资料接口
  }
  const profile = await request<AuthUser>(`/users/${userId}`);
  return { ...profile, user_id: userId };
};

/**
 * 动态菜单/按钮权限：GET /v1/users/me/permissions → {menus, buttons}
 * 这是组员5 的上游数据，登录成功后顺手取一次，失败不影响登录。
 */
export const loadPermissions = async (): Promise<AuthPermissions | null> => {
  try {
    const data = await request<AuthPermissions>('/users/me/permissions');
    return { menus: data?.menus ?? [], buttons: data?.buttons ?? [] };
  } catch {
    return null;
  }
};

/** 登录成功后的统一收口：写令牌 → 拉资料 → 拉权限 */
async function completeLogin(result: LoginResult): Promise<AuthUser> {
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
    // 拿到票却拉不到资料（例如后端会话表异常）→ 整体回滚，别留半登录态
    clearSession();
    throw error;
  }
}

/* ------------------------------- 登出 -------------------------------- */

export async function logout(): Promise<void> {
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
 * 仅当 VITE_AUTH_PERSIST=1（sessionStorage 里有 refresh_token）时可用：
 * 用 refresh_token 换新 access_token，再拉一次资料。返回 null 表示没恢复成功。
 */
export async function restoreSession(): Promise<AuthUser | null> {
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
