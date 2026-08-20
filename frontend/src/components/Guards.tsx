import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

import { useAuth } from '../hooks/useAuth'
import { FullPageSpinner } from './Spinner'

/**
 * 프론트엔드 가드는 UX를 위한 것이며 보안 수단이 아니다.
 * 실제 차단은 백엔드가 한다. 브라우저는 신뢰할 수 없으므로,
 * 여기를 우회하더라도 API가 401/403으로 막는다.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // 확인이 끝나기 전에 판단하면 로그인 상태인데도 로그인 화면이 깜빡인다.
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <>{children}</>
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />

  if (user.role !== 'ADMIN') {
    // 403과 같은 성격이다. 로그인 화면으로 보내지 않고 안내만 한다.
    return (
      <div className="rounded-md bg-white p-6 ring-1 ring-slate-200">
        <h1 className="text-base font-semibold text-slate-900">
          접근 권한이 없습니다
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          이 화면은 관리자만 볼 수 있습니다.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
