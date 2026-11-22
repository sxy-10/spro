/**
 * 第 5 棒 · 组员5（agency-web · 登录页）
 *
 * 复用 shared-auth 的 fetchCaptcha / loginByAccount（与 C 端、prototype 同一份实现）。
 * 后端接口（组员3 阶段三交付）：
 *   GET  /v1/auth/captcha         → { captcha_id, captcha_image, dev_code? }
 *   POST /v1/auth/login/account   → 账号/手机号 + 密码 + 图形验证码（captcha_id 走 X-Captcha-Id 头）
 * 登录成功统一收口 completeLogin：写令牌 → 拉资料 → 拉权限，任一步失败整体回滚。
 *
 * 演示账号：AGENCY_ADMIN / AGENT 角色用户（database/12_im_perm.sql 绑了
 * im:conv:manage 与 analytics:live:query）。游客登录会因缺权限看到「无权访问」，
 * 这正是 RBAC 的正确表现。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { fetchCaptcha, loginByAccount, ApiError } from '@auth';

interface CaptchaState {
  captchaId: string;
  image: string;
  devCode?: string;
}

export const LoginScreen: React.FC<{ onLoggedIn?: () => void }> = ({ onLoggedIn }) => {
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    setError('');
    setCaptchaCode('');
    try {
      const data = await fetchCaptcha();
      setCaptcha({
        captchaId: data?.captcha_id ?? '',
        image: data?.captcha_image ?? '',
        devCode: data?.dev_code
      });
    } catch (err: any) {
      setError(`验证码加载失败：${err?.message ?? '网络异常'}`);
    }
  }, []);

  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!account.trim() || !password || !captchaCode.trim()) {
      setError('请填写账号、密码与图形验证码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await loginByAccount({
        account: account.trim(),
        password,
        captchaCode: captchaCode.trim(),
        captchaId: captcha?.captchaId
      });
      onLoggedIn?.();
    } catch (err: any) {
      const message =
        err instanceof ApiError
          ? err.isUnauthorized
            ? '账号、密码或验证码不正确'
            : err.message
          : err?.message ?? '登录失败';
      setError(message);
      void refreshCaptcha();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <h1>旅行社工作台</h1>
        <p className="login-sub">实时客服台 + 运营大屏 · 请使用顾问/管理账号登录</p>

        <label className="login-field">
          <span>账号 / 手机号</span>
          <input
            type="text"
            value={account}
            autoComplete="username"
            onChange={(e) => setAccount(e.target.value)}
            placeholder="AGENCY_ADMIN 或 11 位手机号"
          />
        </label>

        <label className="login-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8~72 位密码"
          />
        </label>

        <label className="login-field">
          <span>图形验证码</span>
          <div className="login-captcha-row">
            <input
              type="text"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              placeholder="输入图中字符"
            />
            <div
              className="login-captcha-img"
              onClick={() => void refreshCaptcha()}
              title="看不清？点击刷新"
            >
              {captcha && captcha.image.startsWith('data:') ? (
                <img src={captcha.image} alt="图形验证码" />
              ) : (
                <span dangerouslySetInnerHTML={{ __html: captcha?.image ?? '' }} />
              )}
            </div>
          </div>
        </label>

        {captcha?.devCode && (
          <div className="login-devcode">开发环境验证码：{captcha.devCode}（上线前必须移除）</div>
        )}
        {error && <div className="login-error">⚠ {error}</div>}

        <button type="submit" className="login-submit" disabled={busy}>
          {busy ? '登录中…' : '登录工作台'}
        </button>

        <p className="login-hint">
          权限口径：「在线客服」需 im:conv:manage，「实时大屏」需 analytics:live:query
          （AGENCY_ADMIN / AGENT 已在 12_im_perm.sql 授权）。
        </p>
      </form>
    </div>
  );
};

export default LoginScreen;
