/**
 * 组员4（阶段三·前端状态流与网络层）
 * 登录页：密码登录 / 短信登录 双 Tab + 图形验证码 + 找回密码 + 注册。
 *
 * 交接约定（组员5 会用到）：
 *   登录成功后 session 里已经有 user 与 permissions（GET /v1/users/me/permissions），
 *   通过 const { permissions } = useAuth() 取用即可，不用再请求一次。
 */
import { useCallback, useEffect, useState } from 'react';
import { AUTH_CONFIG } from '../lib/config';
import { ApiError } from '../lib/http';
import {
  fetchCaptcha,
  loginByAccount,
  loginBySms,
  loginWithPassword,
  registerAccount,
  sendSmsCode,
  type CaptchaResult
} from '../lib/auth';
import type { AuthUser } from '../lib/session';
import { useCountdown } from '../hooks/useCountdown';
import { useSession } from '../hooks/useAuth';
import { AuthCaptcha } from './AuthCaptcha';
import { PasswordInput } from './PasswordInput';
import { SmsCodeField } from './SmsCodeField';
import { ResetPasswordScreen } from './ResetPasswordScreen';
import './auth.css';

type LoginMode = 'password' | 'sms';
type AuthView = 'login' | 'register' | 'reset';

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void;
}

const ACCOUNT_PATTERN = /^(\d{11}|[A-Za-z][A-Za-z0-9_@.-]{3,63})$/;
const MOBILE_PATTERN = /^1[3-9]\d{9}$/;

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const session = useSession();

  const [view, setView] = useState<AuthView>('login');
  const [mode, setMode] = useState<LoginMode>('password');

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [captcha, setCaptcha] = useState<CaptchaResult | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaNotice, setCaptchaNotice] = useState('');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [smsHint, setSmsHint] = useState('');

  const countdown = useCountdown(AUTH_CONFIG.smsCooldown);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const result = await fetchCaptcha();
      setCaptcha(result);
      setCaptchaCode('');
      setCaptchaNotice('');
    } catch (err) {
      setCaptcha(null);
      // 后端没装 svg-captcha 时 /auth/captcha 会 500。
      // 此时拿不到 captcha_id，验证码无法校验，只能提示用户重试。
      setCaptchaNotice(
        err instanceof ApiError && err.status >= 500
          ? '验证码图片加载失败，请点击「换一张」重试'
          : err instanceof Error
            ? err.message
            : '验证码加载失败'
      );
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  // 首次进入 + 切回密码登录：确保有验证码
  useEffect(() => {
    if (view !== 'login' || mode !== 'password' || captcha) return;
    void refreshCaptcha();
  }, [view, mode, captcha, refreshCaptcha]);

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError('');
    setNotice('');
    if (next === 'password' && !captcha) void refreshCaptcha();
  };

  const openView = (next: AuthView) => {
    setView(next);
    setError('');
    setNotice('');
    setSmsCode('');
    setConfirmPassword('');
    countdown.reset();
  };

  /* --------------------------- 密码登录 --------------------------- */
  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!ACCOUNT_PATTERN.test(account.trim())) return setError('请输入手机号或账号（4–64 位，字母开头）');
    if (password.length < 8 || password.length > 72) return setError('密码长度需为 8–72 位');
    // 后端按 captcha_id 校验这张图的答案（一次性消费），所以必须带上当前图片的 id
    if (!captcha?.captcha_id) return setError('图形验证码未加载，请点击验证码图片刷新后重试');
    if (captchaCode.trim().length < 4) return setError('请输入图中的 4 位验证码（不区分大小写）');

    setBusy(true);
    try {
      const user = await loginByAccount({
        account: account.trim(),
        password,
        captchaCode: captchaCode.trim(),
        captchaId: captcha.captcha_id
      });
      onLogin(user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 10001) {
        setError(err.message);
        if (err.isRateLimited) return;
        // 验证码一次性使用：失败即换一张，避免被重放
        setCaptcha(null);
        void refreshCaptcha();
      } else {
        setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------- 短信登录 --------------------------- */
  const handleSendSms = async () => {
    if (countdown.running || sending) return;
    setError('');
    if (!MOBILE_PATTERN.test(mobile)) return setError('请输入正确的手机号');
    setSending(true);
    try {
      const result = await sendSmsCode(mobile, 'login');
      setSmsHint(
        result.devCode
          ? `开发环境未接短信通道，本次验证码：${result.devCode}（5 分钟内有效）`
          : result.hint ?? '验证码已发送，请查收短信'
      );
      countdown.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const submitSms = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!MOBILE_PATTERN.test(mobile)) return setError('请输入正确的手机号');
    if (!/^\d{6}$/.test(smsCode)) return setError('请输入 6 位短信验证码');

    setBusy(true);
    try {
      const user = await loginBySms(mobile, smsCode);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------- 注册 ----------------------------- */
  const submitRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!MOBILE_PATTERN.test(mobile)) return setError('请输入正确的手机号');
    if (password.length < 8 || password.length > 72) return setError('密码长度需为 8–72 位');
    if (password !== confirmPassword) return setError('两次输入的密码不一致');

    setBusy(true);
    try {
      await registerAccount(mobile, password);
      // 注册成功直接登录，省一次输入
      const user = await loginWithPassword(mobile, password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------- 找回密码 -------------------------- */
  if (view === 'reset') {
    return (
      <ResetPasswordScreen
        initialMobile={mobile}
        onBack={() => openView('login')}
        onSuccess={() => {
          openView('login');
          setNotice('密码已重置，请用新密码登录');
        }}
      />
    );
  }

  const expiredNotice = session.expired && !notice ? '登录状态已失效，请重新登录' : '';

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-logo" aria-hidden="true">旅</div>
        <h2 className="auth-title">{view === 'register' ? '注册账号' : '登录旅行规划'}</h2>
        <p className="auth-subtitle">
          {view === 'register' ? '注册后即可生成、保存和调整属于自己的行程。' : '登录后可生成、保存和调整自己的行程。'}
        </p>
      </header>

      {view === 'login' ? (
        <div className="auth-segment" role="tablist" aria-label="登录方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'password'}
            className={mode === 'password' ? 'auth-segment-item auth-segment-item-active' : 'auth-segment-item'}
            onClick={() => switchMode('password')}
          >
            密码登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sms'}
            className={mode === 'sms' ? 'auth-segment-item auth-segment-item-active' : 'auth-segment-item'}
            onClick={() => switchMode('sms')}
          >
            短信登录
          </button>
        </div>
      ) : null}

      {notice || expiredNotice ? (
        <p className="auth-notice" role="status">
          {notice || expiredNotice}
        </p>
      ) : null}

      {view === 'login' && mode === 'password' ? (
        <form className="auth-form" onSubmit={submitPassword} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-account">
              账号 / 手机号
            </label>
            <input
              id="auth-account"
              className="auth-input"
              type="text"
              autoComplete="username"
              placeholder="手机号或账号"
              value={account}
              disabled={busy}
              onChange={(event) => setAccount(event.target.value.trim())}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">
              密码
            </label>
            <PasswordInput
              id="auth-password"
              autoComplete="current-password"
              minLength={8}
              maxLength={72}
              placeholder="请输入密码"
              value={password}
              disabled={busy}
              onChange={setPassword}
            />
          </div>

          <AuthCaptcha
            captcha={captcha}
            code={captchaCode}
            onCodeChange={setCaptchaCode}
            onRefresh={() => void refreshCaptcha()}
            loading={captchaLoading}
            disabled={busy}
            devHint={captchaNotice || undefined}
          />

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="auth-primary-button" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      ) : null}

      {view === 'login' && mode === 'sms' ? (
        <form className="auth-form" onSubmit={submitSms} noValidate>
          <SmsCodeField
            mobile={mobile}
            onMobileChange={setMobile}
            code={smsCode}
            onCodeChange={setSmsCode}
            onSend={() => void handleSendSms()}
            remaining={countdown.remaining}
            sending={sending}
            disabled={busy}
            hint={smsHint || undefined}
          />

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="auth-primary-button" disabled={busy}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      ) : null}

      {view === 'register' ? (
        <form className="auth-form" onSubmit={submitRegister} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-register-mobile">
              手机号
            </label>
            <input
              id="auth-register-mobile"
              className="auth-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={11}
              placeholder="请输入 11 位手机号"
              value={mobile}
              disabled={busy}
              onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 11))}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-register-password">
              密码
            </label>
            <PasswordInput
              id="auth-register-password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              placeholder="8–72 位，建议字母 + 数字"
              value={password}
              disabled={busy}
              onChange={setPassword}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-register-confirm">
              确认密码
            </label>
            <PasswordInput
              id="auth-register-confirm"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              placeholder="再输入一次密码"
              value={confirmPassword}
              disabled={busy}
              onChange={setConfirmPassword}
            />
          </div>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="auth-primary-button" disabled={busy}>
            {busy ? '注册中…' : '注册并登录'}
          </button>
        </form>
      ) : null}

      <footer className="auth-footer">
        {view === 'login' ? (
          <>
            <button type="button" className="auth-link" onClick={() => openView('reset')}>
              忘记密码？
            </button>
            <span className="auth-footer-divider" aria-hidden="true">
              ·
            </span>
            <button type="button" className="auth-link" onClick={() => openView('register')}>
              还没有账号，去注册
            </button>
          </>
        ) : (
          <button type="button" className="auth-link" onClick={() => openView('login')}>
            已有账号，去登录
          </button>
        )}
      </footer>
    </div>
  );
}
