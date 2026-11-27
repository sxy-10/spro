import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { api, ApiError } from '../../lib/http'
import { useAuth } from '../../lib/auth'

const { Title, Text } = Typography

interface CaptchaData {
  captcha_id: string
  captcha_image: string
  dev_code?: string
}

type LoginValues = { account: string; password: string; captcha_code: string }

export default function LoginPage() {
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<LoginValues>()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const loadCaptcha = useCallback(async () => {
    try {
      setCaptcha(await api.get<CaptchaData>('/api/auth/captcha'))
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status}）` : String(e))
    }
  }, [])

  useEffect(() => {
    void loadCaptcha()
  }, [loadCaptcha])

  async function onSubmit(values: LoginValues) {
    if (!captcha) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', values, { 'X-Captcha-Id': captcha.captcha_id })
      const nextMe = await refresh()
      // 落点不能用渲染闭包里的 me（登录前是 null），要用 refresh 返回的最新会话
      const target =
        (location.state as { from?: string } | null)?.from ??
        (nextMe?.buttons.some((b) => b.code === 'system:agency:query')
          ? '/platform/overview'
          : '/agency/dashboard')
      navigate(target, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
      // 验证码是一次性的，失败必须换一张
      form.setFieldValue('captcha_code', '')
      await loadCaptcha()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size={4} style={{ marginBottom: 20 }}>
          <Title level={4} style={{ margin: 0 }}>
            旅游规划智能体 · 管理后台
          </Title>
          <Text type="secondary">账号密码由 Node 校验，图形验证码一次性有效</Text>
        </Space>

        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        <Form form={form} layout="vertical" onFinish={(values) => void onSubmit(values)} requiredMark={false}>
          <Form.Item name="account" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" placeholder="手机号或用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" placeholder="密码" />
          </Form.Item>
          <Form.Item label="图形验证码" required>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="captcha_code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                <Input placeholder="不区分大小写" maxLength={6} />
              </Form.Item>
              <Button icon={<ReloadOutlined />} onClick={() => void loadCaptcha()} title="换一张">
                换一张
              </Button>
            </Space.Compact>
            <div
              style={{ marginTop: 8, height: 44, cursor: 'pointer' }}
              onClick={() => void loadCaptcha()}
              // Node 直接返回 SVG 字符串，原样渲染；这里不引入任何第三方验证码组件
              dangerouslySetInnerHTML={{ __html: captcha?.captcha_image ?? '' }}
            />
            {/* 拿不到图时给一句话，否则用户只看到一块空白，不知道该点"换一张" */}
            {!captcha?.captcha_image && (
              <Text type="secondary">验证码没加载出来，点「换一张」重试</Text>
            )}
            {captcha?.dev_code && <Text type="secondary">开发环境验证码：{captcha.dev_code}</Text>}
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={busy}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
