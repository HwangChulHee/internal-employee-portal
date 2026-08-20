import { useContext } from 'react'

import { AuthContext, type AuthState } from '../auth/context'

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다')
  }
  return ctx
}
