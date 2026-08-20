import type { Role } from './api/types'

/** 로그인 후 랜딩 경로. 관리자는 직원 관리로, 직원은 내 정보로 보낸다. */
export function landingPathFor(role: Role): string {
  return role === 'ADMIN' ? '/admin/employees' : '/me'
}
