import { apiJson, jsonBody } from './client'
import type { BackgroundCheckDetail, BackgroundCheckListItem, Page } from './types'

export function listChecks(
  employeeId: number,
  page = 1,
  pageSize = 5,
): Promise<Page<BackgroundCheckListItem>> {
  return apiJson<Page<BackgroundCheckListItem>>(
    `/api/employees/${employeeId}/background-checks?page=${page}&page_size=${pageSize}`,
  )
}

export function requestCheck(
  employeeId: number,
  surname?: string,
): Promise<BackgroundCheckDetail> {
  return apiJson<BackgroundCheckDetail>(
    `/api/employees/${employeeId}/background-checks`,
    { method: 'POST', ...jsonBody(surname ? { surname } : {}) },
  )
}

/** 경로의 id는 우리 DB의 내부 PK다. 응답의 check_id(외부 CHK-...)와 다르다. */
export function getCheck(
  backgroundCheckId: number,
  signal?: AbortSignal,
): Promise<BackgroundCheckDetail> {
  return apiJson<BackgroundCheckDetail>(
    `/api/background-checks/${backgroundCheckId}`,
    { signal },
  )
}
