/**
 * 登录页：统一账号（手机号/用户名）+ 密码 + 图形验证码。
 * 对接 POST /auth/captcha 与 POST /auth/login/account（验证码 id 走 X-Captcha-Id 请求头）。
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchCaptcha, loginByAccount } from '../api/admin';
import { ApiError } from '../api/client';
import { toast } from '../components/ui';

const b64 = (svg: string) => `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(svg)))}`;

export function LoginScreen(props: { onSuccess: () => void }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captcha, setCaptcha] = useState<{ id: string; svg: string; devCode?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    try {
      const data = await fetchCaptcha();
      setCaptcha({ id: data.captcha_id, svg: data.captcha_image, devCode: data.dev_code });
      setCaptchaCode('');
    } catch (error) {
      toast.error(error, '验证码加载失败，请确认后端已启动');
    }
  }, []);

  useEffect(() => { void refreshCaptcha(); }, [refreshCaptcha]);

  // 开发环境后端回传 dev_code，自动回填方便演示；生产环境该字段为 undefined
  useEffect(() => {
    if (captcha?.devCode) setCaptchaCode(captcha.devCode);
  }, [captcha]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account.trim() || !password || !captchaCode.trim() || !captcha) return;
    setSubmitting(true);
    try {
      await loginByAccount(account.trim(), password, captchaCode.trim().toLowerCase(), captcha.id);
      toast.success('登录成功');
      props.onSuccess();
    } catch (error) {
      // 验证码一次性消费：失败必须换图重试
      void refreshCaptcha();
      if (error instanceof ApiError) toast.error(error);
      else toast.error(error, '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="login-logo">旅</div>
          <div>
            <div className="login-title">智能旅游规划平台</div>
            <div className="login-sub">旅行社管理系统 · 管理员入口</div>
          </div>
        </div>
        <div className="login-heading">账号登录</div>

        <div className="login-form">
          <div className="field">
            <label>账号</label>
            <input
              className="input"
              placeholder="请输入手机号或用户名"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label>密码</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码（8-72 位）"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                className="link-btn"
                style={{ position: 'absolute', right: 10, top: 9 }}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
          <div className="field">
            <label>图形验证码</label>
            <div className="captcha-row">
              <input
                className="input"
                placeholder="不区分大小写"
                value={captchaCode}
                onChange={(event) => setCaptchaCode(event.target.value)}
                maxLength={6}
                style={{ flex: 1 }}
              />
              {captcha && (
                <img
                  className="captcha-img"
                  src={b64(captcha.svg)}
                  alt="图形验证码，点击刷新"
                  title="点击刷新"
                  onClick={() => void refreshCaptcha()}
                />
              )}
            </div>
            {captcha?.devCode && <span className="captcha-hint">开发环境：已自动回填验证码</span>}
          </div>

          <button className="btn block" type="submit" disabled={submitting || !account || !password || !captchaCode}>
            {submitting ? '登录中…' : '登 录'}
          </button>
        </div>

        <div className="login-foot">
          仅限旅行社管理员使用 · 数据由平台统一鉴权（Casbin RBAC）
        </div>
      </form>
    </div>
  );
}
