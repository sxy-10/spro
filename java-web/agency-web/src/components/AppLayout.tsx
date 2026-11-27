import { useMemo } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd'
import {
  AppstoreOutlined,
  BarChartOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  FundProjectionScreenOutlined,
  LogoutOutlined,
  MoneyCollectOutlined,
  ProfileOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  DatabaseOutlined,
  BankOutlined,
  UserOutlined,
  FileDoneOutlined,
  RobotOutlined,
  SettingOutlined,
  SafetyOutlined,        // ← 追加（S3 角色权限）
  FileSearchOutlined,    // ← 追加（S3 操作日志）
  LoginOutlined,         // ← 追加（S3 登录日志）
  FileTextOutlined,      // ← 追加（S3 系统日志）
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
  // 权限码与 Node 的 requireAction 一一对应：没有 im:agent:query 就看不到接待台，没有
  // analytics:live:query 就看不到大屏。菜单隐藏只是体验，真正的闸门在 Node。
  { key: '/agency/livedesk', icon: <CustomerServiceOutlined />, label: '在线客服', code: 'im:agent:query' },
  {
    key: '/agency/bigscreen',
    icon: <FundProjectionScreenOutlined />,
    label: '实时大屏',
    code: 'analytics:live:query',
  },
]

/** 平台端菜单：入口是否出现由权限码决定（与 Node requireAction 一一对应）。
 *  analytics:platform:query 是平台运营数据专属码，仅授予 SUPER_ADMIN，
 *  商家端的 order:manage:query 不再放行平台接口。 */
const PLATFORM_MENU = [
  { key: '/platform/overview', icon: <DashboardOutlined />, label: '平台总览', code: 'analytics:platform:query' },
  { key: '/platform/orders', icon: <ShoppingCartOutlined />, label: '订单监督', code: 'analytics:platform:query' },
  { key: '/platform/finance', icon: <MoneyCollectOutlined />, label: '财务结算', code: 'finance:platform:query' },
  { key: '/platform/analytics', icon: <BarChartOutlined />, label: '数据分析', code: 'analytics:platform:query' },
  { key: '/platform/agencies', icon: <BankOutlined />, label: '旅行社管理', code: 'system:agency:query' },
  { key: '/platform/users', icon: <UserOutlined />, label: '账号管理', code: 'system:user:query' },
  { key: '/platform/audits', icon: <FileDoneOutlined />, label: '内容审核', code: 'analytics:platform:query' },
  { key: '/platform/ai-service', icon: <RobotOutlined />, label: 'AI 服务', code: 'ai:service:query' },
  { key: '/platform/system-meta', icon: <SettingOutlined />, label: '系统参数', code: 'system:agency:query' },
  { key: '/platform/roles', icon: <SafetyOutlined />, label: '角色权限', code: 'system:role:query' },
  { key: '/platform/logs/operation', icon: <FileSearchOutlined />, label: '操作日志', code: 'system:permission:query' },
  { key: '/platform/logs/login', icon: <LoginOutlined />, label: '登录日志', code: 'system:permission:query' },
  { key: '/platform/logs/system', icon: <FileTextOutlined />, label: '系统日志', code: 'system:permission:query' },
]

/** 这两页要占满可视区，不能套 Content 的 24px 内边距。 */
const FULL_BLEED_PATHS = ['/agency/livedesk', '/agency/bigscreen']

export default function AppLayout() {
  const { me, logout, can } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const isPlatform = location.pathname.startsWith('/platform')
  const menuSource = isPlatform ? PLATFORM_MENU : AGENCY_MENU

  const items = useMemo(
    () =>
      // 平台端只渲染平台菜单（避免旅行社管理员看到灰掉的乱入项）；商家端同理。
      menuSource.filter((item) => can(item.code)).map((item) => ({
        key: item.key,
        icon: item.icon,
        label: <Link to={item.key}>{item.label}</Link>,
      })),
    [can, menuSource],
  )

  // super 登录后落在商家端工作台；进 /platform/* 后侧栏切换为平台菜单。
  const fallback = isPlatform ? '/platform/overview' : '/agency/dashboard'
  const selected = menuSource.find((item) => location.pathname.startsWith(item.key))?.key ?? fallback
  const fullBleed = FULL_BLEED_PATHS.some((path) => location.pathname.startsWith(path))

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={200} breakpoint="lg">
        <div style={{ padding: '18px 16px 10px', fontWeight: 600 }}>
          {isPlatform ? '平台管理后台' : '旅行社工作台'}
        </div>
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
        <Content style={{ padding: fullBleed ? 0 : 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
