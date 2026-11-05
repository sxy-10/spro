/**
 * 组员4（阶段三·前端状态流与网络层）
 * 图形验证码输入框：图片来自 GET /v1/auth/captcha（后端返回 SVG 字符串）。
 * 点击图片或「换一张」都会重新拉取，答案不落库、不缓存。
 */
import type { CaptchaResult } from '../lib/auth';

interface AuthCaptchaProps {
  captcha: CaptchaResult | null;
  code: string;
  onCodeChange: (value: string) => void;
  onRefresh: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** 开发环境提示（后端 dev_code） */
  devHint?: string;
}

/** 后端可能返回 SVG 源码，也可能返回 data:image 数据 URI，这里统一成 <img src> */
const toImageSrc = (raw: string): string => {
  if (!raw) return '';
  if (raw.startsWith('data:')) return raw;
  if (raw.trimStart().startsWith('<')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  return raw;
};

export function AuthCaptcha({ captcha, code, onCodeChange, onRefresh, loading = false, disabled = false, devHint }: AuthCaptchaProps) {
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor="auth-captcha-input">
        图形验证码
      </label>
      <div className="auth-inline-row">
        <input
          id="auth-captcha-input"
          className="auth-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          maxLength={6}
          placeholder="输入图中字符"
          value={code}
          disabled={disabled}
          onChange={(event) => onCodeChange(event.target.value.trim())}
        />
        <button
          type="button"
          className="auth-captcha-image"
          onClick={onRefresh}
          disabled={loading || disabled}
          title="看不清？点击换一张"
          aria-label="点击换一张验证码"
        >
          {captcha ? <img src={toImageSrc(captcha.captcha_image)} alt="图形验证码" /> : <span>{loading ? '加载中…' : '点击获取'}</span>}
        </button>
        <button type="button" className="auth-link-inline" onClick={onRefresh} disabled={loading || disabled}>
          换一张
        </button>
      </div>
      {devHint ? <p className="auth-hint">{devHint}</p> : null}
    </div>
  );
}
