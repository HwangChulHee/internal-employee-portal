import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import * as authApi from '../api/auth'
import { setUnauthorizedHandler } from '../api/client'
import type { MeResponse } from '../api/types'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    // 세션 쿠키가 HttpOnly라 JS로 읽을 수 없다.
    // 로그인 상태인지는 서버에 물어보는 방법밖에 없다.
    const me = await authApi.fetchMe()
    setUser(me)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const me = await authApi.fetchMe()
        if (!cancelled) setUser(me)
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 어떤 호출이든 401을 받으면 인증 상태를 비운다.
    // 관리자가 퇴사 처리한 순간 이 경로로 즉시 차단이 드러난다.
    setUnauthorizedHandler(() => setUser(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, logout, setUser }),
    [user, loading, refresh, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
