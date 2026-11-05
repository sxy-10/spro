/**
 * 组员4（阶段三·前端状态流与网络层）
 * 找回密码页：手机号 + 短信验证码 + 新密码 + 确认密码。
 * 后端 POST /v1/auth/reset-password 是「防枚举」实现：手机号不存在也返回成功，
 * 所以这里无论结果如何都提示「如果该手机号已注册，密码已重置」，不要暴露手机号是否存在。
 */
import { useEffect, useState } from 'react';
import { AUTH_CONFIG } from '../lib/config';
import { ApiError } from '../lib/http';
import { resetPassword, sendSmsCode } from '../lib/auth';
import { useCountdown } from '../hooks/useCountdown';
import { SmsCodeField } from './SmsCodeField';

interface ResetPasswordScreenProps {
  onBack: () => void;
  onSuccess: () => void;
  /** 从登录页带过来的手机号，省得重新输 */
  initialMobile?: string;
}

export function ResetPasswordScreen({ onBack, onSuccess, initialMobile = '' }: ResetPasswordScreenProps) {
  const [mobile, setMobile] = useState(initialMobile);
  const [smsCode, setSmsCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const countdown = useCountdown(AUTH_CONFIG.smsCooldown);

  useEffect(() => {
    if (!initialMobile) return;
    setMobile(initialMobile);
  }, [initialMobile]);

  const handleSend = async () => {
    if (countdown.running || sending) return;
    setError('');
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      setError('请先输入正确的手机号');
      return;
    }
    setSending(true);
    try {
      const result = await sendSmsCode(mobile, 'reset');
      setHint(
        result.devCode
          ? `开发环境验证码：${result.devCode}（也兼容固定 123456）`
          : result.hint ?? '验证码已发送，请查收短信'
      );
      countdown.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!/^1[3-9]\d{9}$/.test(mobile)) return setError('请输入正确的手机号');
    if (!/^\d{6}$/.test(smsCode)) return setError('请输入 6 位短信验证码');
    if (newPassword.length < 8 || newPassword.length > 72) return setError('新密码需为 8–72 位');
    if (newPassword !== confirmPassword) return setError('两次输入的新密码不一致');

    setBusy(true);
    try {
      await resetPassword({ mobile, smsCode, newPassword });
      setDone(true);
      setHint('密码已重置，请用新密码重新登录');
    } catch (err) {
      if (err instanceof ApiError && err.code === 10001) {
        setError('验证码错误或已过期，请重新获取');
        setSmsCode('');
      } else {
        setError(err instanceof Error ? err.message : '重置失败，请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-result">
          <div className="auth-result-icon" aria-hidden="true">✓</div>
          <h2 className="auth-title">密码已重置</h2>
          <p className="auth-subtitle">为安全起见该账号已登录的其它设备全部下线，请用新密码重新登录。</p>
          <button type="button" className="auth-primary-button" onClick={onSuccess}>
            返回登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <button type="button" className="auth-back-button" onClick={onBack}>
        ← 返回登录
      </button>

      <header className="auth-header">
        <h2 className="auth-title">找回密码</h2>
        <p className="auth-subtitle">通过注册手机号的短信验证码重置密码，重置后所有设备需重新登录。</p>
      </header>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <SmsCodeField
          mobile={mobile}
          onMobileChange={setMobile}
          code={smsCode}
          onCodeChange={setSmsCode}
          onSend={handleSend}
          remaining={countdown.remaining}
          sending={sending}
          disabled={busy}
          hint={hint || undefined}
        />

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-new-password">
            新密码
          </label>
          <input
            id="auth-new-password"
            className="auth-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            placeholder="8–72 位，建议字母 + 数字"
            value={newPassword}
            disabled={busy}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-confirm-password">
            确认新密码
          </label>
          <input
            id="auth-confirm-password"
            className="auth-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            placeholder="再输入一次新密码"
            value={confirmPassword}
            disabled={busy}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="auth-primary-button" disabled={busy}>
          {busy ? '提交中…' : '重置密码'}
        </button>
      </form>
    </div>
  );
}
