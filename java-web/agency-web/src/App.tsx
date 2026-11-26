import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import { RequirePlatform } from './components/RequirePlatform'
import LoginPage from './pages/login/LoginPage'
import DashboardPage from './pages/agency/DashboardPage'
import RoutesPage from './pages/agency/RoutesPage'
import RouteFormPage from './pages/agency/RouteFormPage'
import OrdersPage from './pages/agency/OrdersPage'
import StockPage from './pages/agency/StockPage'
import CustomersPage from './pages/agency/CustomersPage'
import LiveDeskPage from './pages/agency/LiveDeskPage'
import BigScreenPage from './pages/agency/BigScreenPage'
import AgenciesPage from './pages/platform/AgenciesPage'
import UsersPage from './pages/platform/UsersPage'
import OverviewPage from './pages/platform/OverviewPage'
import PlatformOrdersPage from './pages/platform/OrdersPage'
import FinancePage from './pages/platform/FinancePage'
import AnalyticsPage from './pages/platform/AnalyticsPage'
import AuditsPage from './pages/platform/AuditsPage'
import AiServicePage from './pages/platform/AiServicePage'
import SystemMetaPage from './pages/platform/SystemMetaPage'
import ForbiddenPage from './pages/error/ForbiddenPage'
import NotFoundPage from './pages/error/NotFoundPage'

/**
 * 路由结构：/login 独立，/agency/** 全部走 RequireAuth + AppLayout。
 * 页面级权限由"菜单不出现 + Node 的 requireAction"双层保证，前端守卫只负责体验。
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/agency"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/agency/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="routes/new" element={<RouteFormPage />} />
        <Route path="routes/:id/edit" element={<RouteFormPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="customers" element={<CustomersPage />} />
        {/* 接待台与大屏都是"全幅"页面：AppLayout 对这两条路由取消 Content 内边距 */}
        <Route path="livedesk" element={<LiveDeskPage />} />
        <Route path="bigscreen" element={<BigScreenPage />} />
      </Route>
      {/* 平台端：只面向 SUPER_ADMIN；RequirePlatform 弹回无平台权限的账号（数据闸门在 Node 403） */}
      <Route
        path="/platform"
        element={
          <RequireAuth>
            <RequirePlatform>
              <AppLayout />
            </RequirePlatform>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/platform/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="orders" element={<PlatformOrdersPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="agencies" element={<AgenciesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audits" element={<AuditsPage />} />
        <Route path="ai-service" element={<AiServicePage />} />
        <Route path="system-meta" element={<SystemMetaPage />} />
      </Route>
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/" element={<Navigate to="/agency/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
