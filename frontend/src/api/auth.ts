import { apiFetch, ApiError, apiJson, jsonBody } from './client'
import type { MeResponse, MeUpdate } from './types'

export async function login(loginId: string, password: string): Promise<void> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    // 로그인 실패의 401은 정상 흐름이다. 전역 리다이렉트를 태우지 않는다.
    skipUnauthorizedHandler: true,
    ...jsonBody({ login_id: loginId, password }),
  })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const detail =
      typeof body === 'object' && body !== null && 'detail' in body
        ? (body as { detail: unknown }).detail
        : null
    throw new ApiError(res.status, detail)
  }
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' })
}

/** 세션 쿠키가 HttpOnly라 JS가 읽을 수 없다. 로그인 여부는 이 호출로만 알 수 있다. */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await apiFetch('/api/me', { skipUnauthorizedHandler: true })
  if (res.status === 401) return null
  if (!res.ok) throw new ApiError(res.status, null)
  return (await res.json()) as MeResponse
}

export function updateMe(payload: MeUpdate): Promise<MeResponse> {
  return apiJson<MeResponse>('/api/me', { method: 'PATCH', ...jsonBody(payload) })
}
