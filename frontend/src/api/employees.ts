import { apiJson, jsonBody } from './client'
import type {
  EmployeeAdminUpdate,
  EmployeeCreate,
  EmployeeCreated,
  EmployeeDetail,
  EmployeeListItem,
  EmployeeStatus,
  MessageResponse,
} from './types'

export function listEmployees(params: {
  status?: EmployeeStatus | ''
  q?: string
}): Promise<EmployeeListItem[]> {
  const search = new URLSearchParams()
  if (params.status) search.set('status', params.status)
  if (params.q?.trim()) search.set('q', params.q.trim())
  const qs = search.toString()
  return apiJson<EmployeeListItem[]>(`/api/employees${qs ? `?${qs}` : ''}`)
}

export function getEmployee(employeeId: number): Promise<EmployeeDetail> {
  return apiJson<EmployeeDetail>(`/api/employees/${employeeId}`)
}

export function createEmployee(payload: EmployeeCreate): Promise<EmployeeCreated> {
  // 생성 응답에만 초기 비밀번호가 실려 온다. 안내 문구에 그 값을 쓴다.
  return apiJson<EmployeeCreated>('/api/employees', {
    method: 'POST',
    ...jsonBody(payload),
  })
}

export function updateEmployee(
  employeeId: number,
  payload: EmployeeAdminUpdate,
): Promise<EmployeeDetail> {
  return apiJson<EmployeeDetail>(`/api/employees/${employeeId}`, {
    method: 'PATCH',
    ...jsonBody(payload),
  })
}

export function resignEmployee(employeeId: number): Promise<EmployeeDetail> {
  return apiJson<EmployeeDetail>(`/api/employees/${employeeId}/resign`, {
    method: 'POST',
  })
}

/**
 * 비밀번호 초기화. 대상 직원의 세션이 모두 끊긴다.
 * 관리자가 자기 자신을 초기화하면 호출한 쪽의 세션도 함께 사라진다.
 */
export function resetPassword(employeeId: number): Promise<MessageResponse> {
  return apiJson<MessageResponse>(`/api/employees/${employeeId}/password/reset`, {
    method: 'POST',
  })
}
