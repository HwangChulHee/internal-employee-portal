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

/** POST /api/employees — 비밀번호 필드가 없다. 초기 비밀번호는 login_id와 동일하다. */
export interface EmployeeCreate {
  employee_no: string
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
