import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from './http'
import type { Me } from './types'

interface AuthValue {
  me: Me | null
  loading: boolean
  refresh: () => Promise<Me | null>
  logout: () => Promise<void>
  /** 按权限码判断能否看到某个按钮/入口；SUPER_ADMIN 视为全通过（与 Node 的授权口径一致）。 */
  can: (code: string) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>('/api/me')
      setMe(data)
      return data
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setMe(null)
        return null
      }
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setMe(null)
    }
  }, [])

  const can = useCallback(
    (code: string) => {
      if (!me) return false
      if (me.roles?.includes('SUPER_ADMIN')) return true
      return (me.buttons ?? []).some((button) => button.code === code)
    },
    [me],
  )

  const value = useMemo<AuthValue>(() => ({ me, loading, refresh, logout, can }), [me, loading, refresh, logout, can])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return value
}
