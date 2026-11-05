/**
 * 组员4（阶段三·前端状态流与网络层）
 * 手机号 + 短信验证码字段组：登录页、找回密码页共用，倒计时状态由外部 hook 提供。
 */
interface SmsCodeFieldProps {
  mobile: string;
  onMobileChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  onSend: () => void;
  /** 剩余秒数，>0 时按钮置灰 */
  remaining: number;
  sending?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function SmsCodeField({
  mobile,
  onMobileChange,
  code,
  onCodeChange,
  onSend,
  remaining,
  sending = false,
  disabled = false,
  hint
}: SmsCodeFieldProps) {
  const canSend = !disabled && !sending && remaining === 0 && /^1[3-9]\d{9}$/.test(mobile);
  return (
    <>
      <div className="auth-field">
        <label className="auth-label" htmlFor="auth-mobile-input">
          手机号
        </label>
        <input
          id="auth-mobile-input"
          className="auth-input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={11}
          placeholder="请输入 11 位手机号"
          value={mobile}
          disabled={disabled}
          onChange={(event) => onMobileChange(event.target.value.replace(/\D/g, '').slice(0, 11))}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="auth-sms-input">
          短信验证码
        </label>
        <div className="auth-inline-row">
          <input
            id="auth-sms-input"
            className="auth-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 位验证码"
            value={code}
            disabled={disabled}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button type="button" className="auth-sms-button" onClick={onSend} disabled={!canSend}>
            {remaining > 0 ? `${remaining} 秒后重发` : sending ? '发送中…' : '发送验证码'}
          </button>
        </div>
        {hint ? <p className="auth-hint">{hint}</p> : null}
      </div>
    </>
  );
}
