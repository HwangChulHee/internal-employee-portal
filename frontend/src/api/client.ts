import type { AmbiguousSurnameDetail } from './types'

/**
 * 백엔드가 반환한 에러. status와 detail을 그대로 들고 있는다.
 *
 * detail은 보통 문자열이지만, 복성 확정이 필요한 409에서만 객체다.
 * 그 경우를 구분하려고 raw를 남겨둔다.
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : '요청을 처리하지 못했습니다')
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** 사용자에게 보여줄 문구. 기술적인 상태 코드를 노출하지 않는다. */
  get displayMessage(): string {
    if (typeof this.detail === 'string') return this.detail
    if (isAmbiguousSurname(this.detail)) return this.detail.message
    if (Array.isArray(this.detail)) return formatValidationErrors(this.detail)
    return '요청을 처리하지 못했습니다'
  }
}

export function isAmbiguousSurname(
  detail: unknown,
): detail is AmbiguousSurnameDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { code?: unknown }).code === 'AMBIGUOUS_SURNAME'
  )
}

/** FastAPI 422의 detail은 배열이다. 필드별 메시지로 풀어준다. */
interface ValidationItem {
  loc?: unknown[]
  msg?: string
}

function formatValidationErrors(items: unknown[]): string {
  const lines = items
    .filter((i): i is ValidationItem => typeof i === 'object' && i !== null)
    .map((i) => {
      const field = Array.isArray(i.loc) ? i.loc[i.loc.length - 1] : undefined
      return field ? `${String(field)}: ${i.msg ?? ''}` : (i.msg ?? '')
    })
    .filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : '입력값을 확인해 주세요'
}

/** 422의 필드별 오류를 폼에 붙이기 위해 { 필드: 메시지 } 로 변환한다. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.detail)) return {}
  const out: Record<string, string> = {}
  for (const raw of error.detail) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as ValidationItem
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null
    if (typeof field === 'string' && item.msg) out[field] = item.msg
  }
  return out
}

// 401을 만나면 전역 인증 상태를 비워야 한다. client가 AuthContext를 직접
// import하면 순환 참조가 되므로, Provider가 콜백을 등록하는 방식을 쓴다.
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

interface FetchOptions extends RequestInit {
  /** 로그인 요청처럼 401이 정상 흐름인 경우 전역 처리를 건너뛴다. */
  skipUnauthorizedHandler?: boolean
}

async function parseDetail(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json()
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      return (body as { detail: unknown }).detail
    }
    return body
  } catch {
    return null
  }
}

/**
 * 모든 API 호출이 거치는 함수. 401 처리가 여기 한곳에 모인다.
 *
 * 401과 403의 처리가 다르다.
 * 401은 신원을 확인할 수 없는 상태이므로 인증 상태를 비우고 로그인 화면으로 보낸다.
 * 403은 신원은 확인됐으나 권한이 없는 것이므로 리다이렉트하지 않고 화면에 안내한다.
 */
export async function apiFetch(
  path: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { skipUnauthorizedHandler, headers, ...rest } = options

  const res = await fetch(path, {
    ...rest,
    // 쿠키 전송에 필수다. 빠뜨리면 세션이 실려가지 않아 계속 401이 난다.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
  })

  if (res.status === 401 && !skipUnauthorizedHandler) {
    unauthorizedHandler?.()
  }

  return res
}

/** 성공하면 파싱된 본문을, 실패하면 ApiError를 던진다. */
export async function apiJson<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const res = await apiFetch(path, options)
  if (!res.ok) {
    throw new ApiError(res.status, await parseDetail(res))
  }
  return (await res.json()) as T
}

export function jsonBody(data: unknown): FetchOptions {
  return { body: JSON.stringify(data) }
}
