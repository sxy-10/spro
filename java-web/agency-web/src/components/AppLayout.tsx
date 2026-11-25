import { useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd'
import {
  AppstoreOutlined,
  LogoutOutlined,
  ProfileOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import { useAuth } from '../lib/auth'

const { Header, Sider, Content } = Layout
const { Text } = Typography

/** B 端菜单是静态的：入口是否出现由权限码决定，而不是由角色字符串决定。 */
const AGENCY_MENU = [
  { key: '/agency/dashboard', icon: <AppstoreOutlined />, label: '工作台', code: 'order:manage:query' },
  { key: '/agency/routes', icon: <ProfileOutlined />, label: '线路管理', code: 'route:line:query' },
  { key: '/agency/orders', icon: <ShoppingCartOutlined />, label: '订单管理', code: 'order:manage:query' },
  { key: '/agency/stock', icon: <DatabaseOutlined />, label: '库存管理', code: 'route:line:query' },
  { key: '/agency/customers', icon: <TeamOutlined />, label: '客户管理', code: 'customer:customer:query' },
]

export default function AppLayout() {
  const { me, logout, can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const items = useMemo(
    () =>
      AGENCY_MENU.filter((item) => can(item.code)).map((item) => ({
        key: item.key,
        icon: item.icon,
        label: <Link to={item.key}>{item.label}</Link>,
      })),
    [can],
  )

  const selected = AGENCY_MENU.find((item) => location.pathname.startsWith(item.key))?.key ?? '/agency/dashboard'

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={200} breakpoint="lg">
        <div style={{ padding: '18px 16px 10px', fontWeight: 600 }}>旅行社工作台</div>
        <Menu mode="inline" selectedKeys={[selected]} items={items} style={{ borderInlineEnd: 0 }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', gap: 12, paddingInline: 24 }}>
          <Space>
            <Avatar size="small">{me?.username?.slice(0, 1) ?? '?'}</Avatar>
            <Text strong>{me?.username}</Text>
            {(me?.roles ?? []).map((role) => (
              <Tag key={role} color="geekblue">
                {role}
              </Tag>
            ))}
            <Button icon={<LogoutOutlined />} onClick={() => void onLogout()}>
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
