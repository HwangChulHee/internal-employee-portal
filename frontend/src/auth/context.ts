import { createContext } from 'react'

import type { MeResponse } from '../api/types'

export interface AuthState {
  user: MeResponse | null
  /**
   * 세션이 끊긴 이유. 로그인 화면이 보여준다.
   *
   * 라우터 state로 넘기지 않는다. 인증 상태를 비우는 순간 RequireAuth도
   * 로그인 화면으로 보내려 하고, 어느 쪽 이동이 이기는지에 따라 state가
   * 조용히 사라진다. 컨텍스트에 두면 어느 경로로 도착하든 남는다.
   */
  sessionNotice: string | null
  /** 초기 확인 중. 끝나기 전에 라우팅을 판단하면 화면이 깜빡인다. */
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  setUser: (user: MeResponse) => void
  /**
   * 로컬 인증 상태만 비운다. 서버에 요청하지 않는다.
   * 비밀번호 변경·초기화처럼 서버가 이미 세션을 지운 뒤에 쓴다.
   * logout()을 부르면 없는 세션을 지우려는 401 요청이 한 번 더 나간다.
   *
   * reason을 주면 로그인 화면이 그 문구를 보여준다.
   */
  clearSession: (reason?: string) => void
}

export const AuthContext = createContext<AuthState | null>(null)
