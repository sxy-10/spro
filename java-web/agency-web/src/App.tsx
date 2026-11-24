import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Alert, Button, Card, Descriptions, Layout, Space, Tag, Typography } from 'antd'
import { api, ApiError } from './lib/http'
import { xsrfToken } from './lib/csrf'

const { Header, Content, Footer } = Layout
const { Title, Paragraph, Text } = Typography

type PingData = { app: string; framework: string; runtime: string; time: string }
type MeData = { user_id?: string; username?: string; roles?: string[] }

/**
 * 骨架期自检页：验证三件事就行——同源能拿到 /api、CSRF Cookie 已下发、会话能建立与销毁。
 * 正式页面按规范 §10.4 拆到 pages/agency 与 pages/platform。
 */
export default function App() {
  const location = useLocation()
  const [ping, setPing] = useState<PingData | null>(null)
  const [me, setMe] = useState<MeData | null>(null)
  const [session, setSession] = useState<'unknown' | 'guest' | 'authed'>('unknown')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const csrf = xsrfToken()

  const load = useCallback(async () => {
    setError(null)
    try {
      setPing(await api.get<PingData>('/api/ping'))
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status} / code ${e.code}）` : String(e))
    }
    try {
      setMe(await api.get<MeData>('/api/me'))
      setSession('authed')
    } catch (e) {
      setMe(null)
      if (e instanceof ApiError && e.status === 401) {
        setSession('guest')
      } else if (e instanceof ApiError) {
        setError(`${e.message}（HTTP ${e.status} / code ${e.code}）`)
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function devLogin() {
    setBusy(true)
    setNotice(null)
    try {
      await api.post('/api/auth/dev-login', { username: 'super' })
      setNotice('开发登录成功，会话已建立')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status} / code ${e.code}）` : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setNotice(null)
    try {
      await api.post('/api/auth/logout')
      setNotice('已登出，会话已销毁')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}（HTTP ${e.status} / code ${e.code}）` : String(e))
    } finally {
      setBusy(false)
    }
  }

  const envItems = [
    { key: 'framework', label: '后端框架', children: ping?.framework ?? '（未连上）' },
    { key: 'runtime', label: '运行时', children: ping?.runtime ?? '—' },
    { key: 'time', label: '服务端时间', children: ping?.time ?? '—' },
    {
      key: 'session',
      label: '会话状态',
      children:
        session === 'authed' ? (
          <Space>
            <Tag color="green">已登录</Tag>
            <Text>{me?.username}</Text>
            <Text type="secondary">{(me?.roles ?? []).join(', ')}</Text>
          </Space>
        ) : session === 'guest' ? (
          <Tag color="default">未登录（/api/me 返回 401）</Tag>
        ) : (
          <Tag>检测中</Tag>
        ),
    },
    {
      key: 'csrf',
      label: 'CSRF Token',
      children: csrf ? (
        <Space>
          <Tag color="blue">已下发</Tag>
          <Text code>{csrf.slice(0, 12)}…</Text>
        </Space>
      ) : (
        <Tag color="orange">未下发（会写操作 403）</Tag>
      ),
    },
    { key: 'path', label: '当前路由', children: <Text code>{location.pathname}</Text> },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Title level={4} style={{ color: '#fff', margin: 0 }}>
          旅游规划智能体 · 管理后台
        </Title>
        <Tag color="geekblue">Spring Boot 3.3 + React 18 同源 SPA</Tag>
      </Header>

      <Content style={{ padding: 24, maxWidth: 1080, width: '100%', margin: '0 auto' }}>
        {notice && <Alert type="success" showIcon message={notice} style={{ marginBottom: 16 }} />}
        {error && (
          <Alert type="error" showIcon message="请求失败" description={error} style={{ marginBottom: 16 }} />
        )}

        <Card title="环境自检" extra={<Button onClick={() => void load()} disabled={busy}>重新检测</Button>}>
          <Descriptions column={1} size="small" items={envItems} />
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" onClick={() => void devLogin()} loading={busy}>
              开发登录（dev-only）
            </Button>
            <Button onClick={() => void logout()} disabled={busy}>
              登出
            </Button>
          </Space>
        </Card>

        <Card title="骨架已就绪，下一步" style={{ marginTop: 16 }}>
          <Paragraph type="secondary" style={{ marginBottom: 8 }}>
            本页只做链路自检。正式页面按规范 §10.4 落在 <Text code>src/pages/agency/*</Text> 与{' '}
            <Text code>src/pages/platform/*</Text>。
          </Paragraph>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#595959' }}>
            <li>迁移 <Text code>frontend/agency-web</Text> 的登录屏、Layout、客服台、大屏（换请求层，删 shared-auth）</li>
            <li>接真实登录：Java 调 Node <Text code>/auth/login/account</Text> + <Text code>/users/me/permissions</Text>，删除 dev-login</li>
            <li>加 <Text code>RequirePermission</Text> 守卫与 <Text code>&lt;Permission code=&quot;...&quot;&gt;</Text> 按钮</li>
          </ul>
        </Card>
      </Content>

      <Footer style={{ textAlign: 'center', color: '#8c8c8c' }}>
        浏览器只持 JSESSIONID 与 XSRF-TOKEN；token 与 HMAC 签名止于 Java 服务端
      </Footer>
    </Layout>
  )
}
