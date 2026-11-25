import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/login/LoginPage'
import DashboardPage from './pages/agency/DashboardPage'
import RoutesPage from './pages/agency/RoutesPage'
import RouteFormPage from './pages/agency/RouteFormPage'
import OrdersPage from './pages/agency/OrdersPage'
import StockPage from './pages/agency/StockPage'
import CustomersPage from './pages/agency/CustomersPage'
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
      </Route>
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/" element={<Navigate to="/agency/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
