import type { BackgroundCheckDetail, CreditScore } from '../api/types'
import { formatDateTime } from '../format'
import { CheckStatusBadge } from './Badge'

/**
 * 세부 결과는 true / false / null 세 상태다.
 * null은 "아직 확인 중"이며 false("없음")와 의미가 다르다.
 * value ? 'A' : 'B' 로 쓰면 pending일 때 사실과 다른 값이 표시된다.
 */
function triState(
  value: boolean | null,
  whenTrue: string,
  whenFalse: string,
): { label: string; tone: string } {
  if (value === null) return { label: '확인 중', tone: 'text-slate-400' }
  return value
    ? { label: whenTrue, tone: 'text-slate-800' }
    : { label: whenFalse, tone: 'text-slate-800' }
}

const CREDIT_LABEL: Record<CreditScore, string> = {
  excellent: '매우 좋음',
  good: '좋음',
  fair: '보통',
  poor: '낮음',
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm ${tone}`}>{value}</span>
    </div>
  )
}

export function CheckResult({ check }: { check: BackgroundCheckDetail }) {
  const criminal = triState(check.criminal_record, '있음', '없음')
  const education = triState(check.education_verified, '검증됨', '미검증')
  const employment = triState(check.employment_verified, '검증됨', '미검증')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckStatusBadge status={check.status} />
        <span className="font-mono text-xs text-slate-400">
          {check.check_id}
        </span>
      </div>

      <div className="rounded-md bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">외부로 전송한 이름</p>
        <p className="mt-1 text-sm text-slate-800">
          성 <strong>{check.sent_last_name}</strong> · 이름{' '}
          <strong>{check.sent_first_name}</strong>
        </p>
      </div>

      <div>
        <Row label="범죄이력" value={criminal.label} tone={criminal.tone} />
        <Row label="학력 검증" value={education.label} tone={education.tone} />
        <Row label="경력 검증" value={employment.label} tone={employment.tone} />
        <Row
          label="신용등급"
          value={
            check.credit_score === null
              ? '확인 중'
              : CREDIT_LABEL[check.credit_score]
          }
          tone={check.credit_score === null ? 'text-slate-400' : 'text-slate-800'}
        />
        <Row
          label="요청 시각"
          value={formatDateTime(check.requested_at)}
          tone="text-slate-800"
        />
        <Row
          label="완료 시각"
          // 완료 상태인데 completed_at이 비어 있으면 아직 세부 동기화 전이다.
          // "—"(해당 없음)로 두면 조회가 끝났다는 배지와 모순돼 보인다.
          value={
            check.completed_at === null && check.status !== 'pending'
              ? '확인 중'
              : formatDateTime(check.completed_at)
          }
          tone={
            check.completed_at === null && check.status !== 'pending'
              ? 'text-slate-400'
              : 'text-slate-800'
          }
        />
      </div>

      {check.status === 'flagged' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          「추가 검토 필요」는 불합격을 뜻하지 않습니다. 세부 항목을 함께
          확인하세요.
        </p>
      )}
    </div>
  )
}
