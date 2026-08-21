import { apiFetch, ApiError, apiJson, jsonBody } from './client'
import type {
  MeResponse,
  MeUpdate,
  MessageResponse,
  PasswordChange,
  PasswordPolicy,
} from './types'

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

/**
 * 비밀번호 변경. 성공하면 서버가 이 세션까지 지우므로,
 * 이후의 모든 호출은 401이 된다. 호출한 쪽이 로그인 화면으로 보내야 한다.
 */
export function changePassword(payload: PasswordChange): Promise<MessageResponse> {
  return apiJson<MessageResponse>('/api/me/password', {
    method: 'PATCH',
    ...jsonBody(payload),
  })
}

// 정책은 사용자마다 다르지 않고 실행 중에 바뀌지도 않는다. 한 번만 받아 재사용한다.
let policyCache: Promise<PasswordPolicy> | null = null

export function fetchPasswordPolicy(): Promise<PasswordPolicy> {
  // 실패한 응답은 캐시하지 않는다. 캐시하면 화면에 다시 들어와도 계속 실패한다.
  policyCache ??= apiJson<PasswordPolicy>('/api/auth/password-policy').catch(
    (err: unknown) => {
      policyCache = null
      throw err
    },
  )
  return policyCache
}
