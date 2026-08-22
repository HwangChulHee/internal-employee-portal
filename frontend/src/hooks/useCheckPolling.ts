import { useCallback, useEffect, useState } from 'react'

import * as checksApi from '../api/backgroundChecks'
import type { BackgroundCheckDetail } from '../api/types'
import { isFinal } from '../checks'

const POLL_INTERVAL_MS = 3000
const MAX_ATTEMPTS = 10

export interface PollingState {
  polling: boolean
  /** 10회를 소진했다. 실패가 아니라 "아직 확인 중"이다. */
  exhausted: boolean
  rechecking: boolean
  error: string | null
  /** 폴링 재시작이 아니라 GET 1회. */
  recheck: () => void
}

/**
 * pending인 동안 상세를 폴링한다.
 *
 * 이 훅은 조회 데이터를 소유하지 않는다. 응답을 받으면 onUpdate로 올려보내고,
 * 데이터는 호출한 쪽(BackgroundCheckSection의 details 맵) 한 곳에만 있다.
 * 훅이 자체 복사본을 들고 있던 시절에는 같은 조회가 세 곳(history, selected,
 * check)에 존재해 이력 배지가 선택을 바꿀 때마다 과거 값으로 되돌아갔다.
 *
 * 반드시 응답을 받은 뒤 다음 호출을 재예약한다(setInterval을 쓰지 않는다).
 * 외부 API의 retryAfter가 30초로 오는 경우가 있어 요청 하나가 60초 넘게
 * 걸릴 수 있다. 고정 간격이면 응답 전에 다음 요청이 나가 계속 쌓인다.
 */
export function useCheckPolling(
  target: BackgroundCheckDetail | null,
  onUpdate: (check: BackgroundCheckDetail) => void,
): PollingState {
  const [polling, setPolling] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetId = target?.id ?? null
  // 완결(status 확정 + completed_at 존재) 전까지 폴링한다.
  // pending만 조건으로 삼으면, POST가 즉시 flagged를 반환했지만 동기화가
  // 실패한 반동기화 레코드가 수동 재시도 없이는 영원히 비어 있다.
  // 화면은 완결 전 상태를 전부 "조회 중"으로 표시하므로 폴링 조건과 표시가
  // 일치한다. 외부가 completedAt을 끝내 주지 않아도 MAX_ATTEMPTS에서 멈춘다.
  const shouldPoll = target !== null && !isFinal(target)

  // 선택된 항목이 바뀌면 표시 상태를 초기화한다.
  // effect 대신 렌더 중에 처리한다(React가 권장하는 prop 변화 대응 방식).
  const [syncedId, setSyncedId] = useState(targetId)
  if (targetId !== syncedId) {
    setSyncedId(targetId)
    setExhausted(false)
    setError(null)
  }

  useEffect(() => {
    if (targetId === null || !shouldPoll) return
    // 중첩 async 함수 안에서는 위 early return의 좁히기가 유지되지 않는다.
    const id = targetId

    // cancelled는 타이머 재예약을 막고, controller는 진행 중인 요청을 끊는다.
    // 둘 다 필요하다. 하나만으로는 화면을 떠난 뒤에도 무언가가 계속 살아있다.
    let cancelled = false
    const controller = new AbortController()
    let timer: number | undefined
    let attempts = 0

    async function poll() {
      if (cancelled) return
      try {
        const data = await checksApi.getCheck(id, controller.signal)
        if (cancelled) return
        onUpdate(data)
        attempts += 1

        if (isFinal(data)) {
          setPolling(false)
          return
        }
        if (attempts < MAX_ATTEMPTS) {
          // 응답을 받은 뒤에 재예약한다. 요청이 겹치지 않는다.
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
        } else {
          // 실패가 아니다. check_id는 유효하고 다음 방문에서 재확인된다.
          setExhausted(true)
          setPolling(false)
        }
      } catch {
        // 중단되었거나 실패했다. 여기서 다시 시도하지 않는다.
        if (!cancelled) setPolling(false)
      }
    }

    setPolling(true)
    setExhausted(false)
    void poll()

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
      // 폴링 밖 경로(새로고침 등)로 완료가 확인되어 effect가 정리될 때,
      // 진행 중이던 요청은 abort되어 catch의 setPolling(false)에 닿지 못한다.
      // 여기서 내리지 않으면 polling이 true로 남는다.
      setPolling(false)
    }
  }, [targetId, shouldPoll, onUpdate])

  // "다시 확인"은 폴링 재시작이 아니라 GET 한 번이다.
  // 여전히 pending이면 exhausted가 유지되어 이 버튼이 계속 남는다. 의도된 동작이다.
  // 10회를 소진한 뒤의 주도권은 자동 루프가 아니라 관리자에게 있다.
  const recheck = useCallback(() => {
    if (targetId === null) return
    setError(null)
    setRechecking(true)
    void (async () => {
      try {
        onUpdate(await checksApi.getCheck(targetId))
      } catch {
        setError('상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      } finally {
        setRechecking(false)
      }
    })()
  }, [targetId, onUpdate])

  return { polling, exhausted, rechecking, error, recheck }
}
