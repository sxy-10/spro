/**
 * 组员4（阶段三·前端状态流与网络层）
 * 密码输入框：右侧带「显示/隐藏密码」按钮，点击一次变明文、再点一次回到密文。
 * 登录、注册、找回密码三处共用，避免各自维护一份切换逻辑。
 */
import { useState } from 'react';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
}

/** 眼睛（密文状态） */
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

/** 眼睛加一道斜杠（明文状态） */
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M4 4l16 16" strokeLinecap="round" />
    </svg>
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  minLength,
  maxLength,
  disabled = false
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-password-row">
      <input
        id={id}
        className="auth-input"
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="auth-eye-button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        title={visible ? '点击隐藏密码' : '点击显示明文'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
