import type { EmployeeStatus, Role } from '../api/types'
import type { CheckDisplayStatus } from '../checks'

const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset'

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const styles =
    status === 'ACTIVE'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : 'bg-slate-100 text-slate-600 ring-slate-300'
  return (
    <span className={`${BASE} ${styles}`}>
      {status === 'ACTIVE' ? '재직' : '퇴사'}
    </span>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  const styles =
    role === 'ADMIN'
      ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
      : 'bg-slate-100 text-slate-600 ring-slate-300'
  return (
    <span className={`${BASE} ${styles}`}>
      {role === 'ADMIN' ? '관리자' : '직원'}
    </span>
  )
}

/**
 * flagged를 "불합격"으로 쓰지 않는다. 스펙상 "추가 검토 필요"다.
 * 자의적으로 재해석하면 사람에 대한 잘못된 판단으로 이어진다.
 */
const CHECK_LABEL: Record<CheckDisplayStatus, string> = {
  pending: '조회 중',
  clear: '이상 없음',
  flagged: '추가 검토 필요',
  // 파생 상태. "실패"라고 적지 않는다 — 외부에 실패 상태가 없어 알 수 없고,
  // 뒤늦게 완료되면 판정으로 바뀐다. src/checks.ts의 displayStatus 참조.
  stalled: '응답 없음',
}

const CHECK_STYLE: Record<CheckDisplayStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  clear: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  flagged: 'bg-rose-50 text-rose-700 ring-rose-200',
  stalled: 'bg-slate-100 text-slate-500 ring-slate-300',
}

export function CheckStatusBadge({ status }: { status: CheckDisplayStatus }) {
  return (
    <span className={`${BASE} ${CHECK_STYLE[status]}`}>
      {CHECK_LABEL[status]}
    </span>
  )
}
