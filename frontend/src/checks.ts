import type { BackgroundCheckDetail, BackgroundCheckListItem, CheckStatus } from './api/types'

/**
 * 완결된 조회인가. status가 pending이 아니고 completed_at까지 채워져야 완결이다.
 *
 * POST가 즉시 flagged/clear를 반환해도 그 시점엔 세부 결과와 완료시각이 없다
 * (외부 API의 생성 응답이 요약뿐이다). 동기화가 끝나기 전까지 그 레코드는
 * "판정은 들었지만 결과는 없는" 어중간한 상태다.
 */
export function isFinal(
  check: Pick<BackgroundCheckDetail, 'status' | 'completed_at'> | null | undefined,
): boolean {
  return (
    check !== null &&
    check !== undefined &&
    check.status !== 'pending' &&
    check.completed_at !== null
  )
}

/**
 * 화면에 표시할 상태. 완결 전에는 실제 status가 무엇이든 "조회 중"으로 보여준다.
 *
 * 완료시각도 세부도 없는데 "추가 검토 필요"부터 뜨면 관리자는 결과가 나온 것으로
 * 읽는다. 판정 배지는 결과(세부 4필드 + 완료시각)와 함께 한 번에 나타나야 한다.
 * 목록 배지와 결과 패널이 같은 규칙을 쓰므로 서로 어긋나지 않는다.
 */
export function displayStatus(
  check: Pick<BackgroundCheckDetail | BackgroundCheckListItem, 'status' | 'completed_at'>,
): CheckStatus {
  return isFinal(check) ? check.status : 'pending'
}
