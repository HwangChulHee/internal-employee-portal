import { createContext } from 'react'

import type { MeResponse } from '../api/types'

export interface AuthState {
  user: MeResponse | null
  /** 초기 확인 중. 끝나기 전에 라우팅을 판단하면 화면이 깜빡인다. */
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  setUser: (user: MeResponse) => void
}

export const AuthContext = createContext<AuthState | null>(null)
