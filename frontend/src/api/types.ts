// 백엔드 backend/app/schemas/ 와 1:1로 대응한다.
// 필드가 어긋나면 컴파일 시점에 잡히도록 any를 쓰지 않는다.

export type Role = 'EMPLOYEE' | 'ADMIN'
export type EmployeeStatus = 'ACTIVE' | 'RESIGNED'
export type CheckStatus = 'pending' | 'clear' | 'flagged'
export type CreditScore = 'excellent' | 'good' | 'fair' | 'poor'

/** GET /api/me — password_hash는 응답에 없다. */
export interface MeResponse {
  id: number
  employee_no: string
  login_id: string
  name: string
  date_of_birth: string
  phone: string | null
  address: string | null
  department: string | null
  position: string | null
  role: Role
  status: EmployeeStatus
}

/** 단순 성공 응답. 로그인·로그아웃·비밀번호 변경이 이 형태다. */
export interface MessageResponse {
  message: string
}

/**
 * GET /api/auth/password-policy — 인증 필요.
 * 초기 비밀번호와 최소 길이를 프론트에 적어두지 않고 서버에서 받는다.
 */
export interface PasswordPolicy {
  initial_password: string
  min_length: number
}

/** PATCH /api/me/password — 현재 비밀번호를 함께 보낸다. */
export interface PasswordChange {
  current_password: string
  new_password: string
}

/** PATCH /api/me — 본인이 수정할 수 있는 필드는 이 둘뿐이다. */
export interface MeUpdate {
  phone?: string | null
  address?: string | null
}

export interface EmployeeListItem {
  id: number
  employee_no: string
  name: string
  department: string | null
  position: string | null
  status: EmployeeStatus
}

export interface EmployeeDetail {
  id: number
  employee_no: string
  login_id: string
  name: string
  date_of_birth: string
  phone: string | null
  address: string | null
  department: string | null
  position: string | null
  role: Role
  status: EmployeeStatus
}

/**
 * POST /api/employees — 사번과 비밀번호 필드가 없다.
 * 둘 다 서버가 발급한다. 보내더라도 백엔드 스키마가 무시한다.
 */
export interface EmployeeCreate {
  login_id: string
  name: string
  date_of_birth: string
  phone?: string | null
  address?: string | null
  department?: string | null
  position?: string | null
  role?: Role
}

/** PATCH /api/employees/{id} — status가 없다. 퇴사는 전용 엔드포인트로만 처리한다. */
export interface EmployeeAdminUpdate {
  name?: string
  date_of_birth?: string
  phone?: string | null
  address?: string | null
  department?: string | null
  position?: string | null
  role?: Role
}

/**
 * POST /api/employees 응답. EmployeeDetail에 초기 비밀번호가 더해진다.
 * 조회·수정 응답에는 이 필드가 없다. 발급 직후에만 사실인 값이기 때문이다.
 */
export interface EmployeeCreated extends EmployeeDetail {
  initial_password: string
}

export interface BackgroundCheckListItem {
  id: number
  status: CheckStatus
  requested_at: string
  completed_at: string | null
}

export interface BackgroundCheckDetail {
  id: number
  employee_id: number
  status: CheckStatus
  /** 외부 API가 발급한 CHK-... 값. URL에 쓰는 내부 PK(id)와 다르다. */
  check_id: string
  sent_first_name: string
  sent_last_name: string
  // null과 false는 다른 의미다. null은 "아직 확인 중"이다.
  criminal_record: boolean | null
  education_verified: boolean | null
  employment_verified: boolean | null
  credit_score: CreditScore | null
  requested_at: string
  completed_at: string | null
  created_by: number
}

/** 복성 확정이 필요할 때 409와 함께 오는 구조화된 본문. */
export interface AmbiguousSurnameDetail {
  code: 'AMBIGUOUS_SURNAME'
  message: string
  name: string
  candidates: string[]
}
