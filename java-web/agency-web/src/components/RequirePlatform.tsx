import { Spin } from 'antd'
import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'

/**
 * 平台端页面守卫：无任何平台菜单权限码的账号直接弹回商家端工作台。
 * 双层闸门的体验层——真正的数据闸门在 Node 的 requireAction（403）；
 * 这里拦掉「手敲 URL 看到平台空壳」的情况，避免误导。
 */
const PLATFORM_ACCESS_CODES = [
  'analytics:platform:query', // 总览 / 订单监督 / 内容审核 / 数据分析
  'finance:platform:query', // 财务结算
  'system:agency:query', // 旅行社管理 / 系统参数
  'system:user:query', // 账号管理
  'ai:service:query', // AI 服务
] as const

export function RequirePlatform({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin tip="正在确认登录状态…" />
      </div>
    )
  }
  const codes = me?.buttons?.map((b) => b.code) ?? []
  const allowed = PLATFORM_ACCESS_CODES.some((code) => codes.includes(code))
  if (!allowed) {
    return <Navigate to="/agency/dashboard" replace />
  }
  return <>{children}</>
}
