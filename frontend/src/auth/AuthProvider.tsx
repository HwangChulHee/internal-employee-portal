import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import * as authApi from '../api/auth'
import { setUnauthorizedHandler } from '../api/client'
import type { MeResponse } from '../api/types'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // 세션 쿠키가 HttpOnly라 JS로 읽을 수 없다.
    // 로그인 상태인지는 서버에 물어보는 방법밖에 없다.
    const me = await authApi.fetchMe()
    setUser(me)
    // 다시 로그인했으므로 지난 종료 사유는 더 이상 보여줄 필요가 없다.
    setSessionNotice(null)
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

  const clearSession = useCallback((reason?: string) => {
    setUser(null)
    setSessionNotice(reason ?? null)
  }, [])

  useEffect(() => {
    // 어떤 호출이든 401을 받으면 인증 상태를 비운다.
    // 관리자가 퇴사 처리한 순간 이 경로로 즉시 차단이 드러난다.
    setUnauthorizedHandler(() => clearSession())
    return () => setUnauthorizedHandler(null)
  }, [clearSession])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      clearSession()
    }
  }, [clearSession])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      sessionNotice,
      refresh,
      logout,
      setUser,
      clearSession,
    }),
    [user, loading, sessionNotice, refresh, logout, clearSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
