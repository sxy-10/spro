import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'

/**
 * 按钮级权限。没有权限时**不渲染**（而不是渲染成灰色），
 * 与"菜单里不该出现的入口就不出现"保持同一条原则。
 */
export function Permission({ code, children, fallback = null }: { code: string; children: ReactNode; fallback?: ReactNode }) {
  const { can, loading } = useAuth()
  if (loading) return null
  return <>{can(code) ? children : fallback}</>
}
