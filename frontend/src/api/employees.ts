import { apiJson, jsonBody } from './client'
import type {
  EmployeeAdminUpdate,
  EmployeeCreate,
  EmployeeDetail,
  EmployeeListItem,
  EmployeeStatus,
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

export function createEmployee(payload: EmployeeCreate): Promise<EmployeeDetail> {
  return apiJson<EmployeeDetail>('/api/employees', {
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
