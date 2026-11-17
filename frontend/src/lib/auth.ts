/**
 * 组员4（阶段三·前端状态流与网络层）
 * 认证接口薄壳：全部实现已迁移至 shared-auth/src/auth.js（跨端共享）。
 *
 * 对应后端（组员3）已交付的 4 个接口：
 *   POST /v1/auth/login/account  统一账号登录（account + password + captcha_code）
 *   GET  /v1/auth/captcha        图形验证码（captcha_id + captcha_image + dev_code）
 *   POST /v1/auth/login/sms      短信登录（mobile + sms_code）
 *   POST /v1/auth/reset-password 重置密码（mobile + sms_code + new_password）
 * 另有旧的 POST /v1/auth/login（mobile + password，不带验证码）用于「注册后自动登录」。
 *
 * 登录成功统一收口（共享包 completeLogin）：写令牌 → 拉资料 → 拉权限；
 * 任一步失败整体回滚清会话，不留半登录态。
 */
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

export interface AccountLoginInput {
  account: string;
  password: string;
  captchaCode: string;
  captchaId?: string;
}

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
} from '../../../shared-auth/index.js';
