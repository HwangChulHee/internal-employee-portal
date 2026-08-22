import { useCallback, useEffect, useRef, useState } from 'react'

import * as checksApi from '../api/backgroundChecks'
import { ApiError, isAmbiguousSurname } from '../api/client'
import type {
  AmbiguousSurnameDetail,
  BackgroundCheckDetail,
  BackgroundCheckListItem,
  EmployeeDetail,
} from '../api/types'
import { CheckStatusBadge } from './Badge'
import { formatDateTime } from '../format'
import { CheckResult } from './CheckResult'
import { EmptyState, ErrorMessage, InfoMessage } from './ErrorMessage'
import { Spinner } from './Spinner'
import { useCheckPolling } from '../hooks/useCheckPolling'

/**
 * 상태 구조에 대하여.
 *
 * 조회 데이터의 진실의 원천은 details 맵 하나다. 어떤 경로(이력 클릭, 폴링,
 * 다시 확인, 새 요청)로 상세 응답이 오든 이 맵에 병합되고, 선택은 selectedId
 * 라는 id 하나만 들고 있는다. 결과 패널과 목록 배지는 둘 다 이 맵에서
 * 파생되므로 서로 어긋날 수 없다.
 *
 * 예전에는 같은 조회가 세 곳(history의 요약, selected 스냅샷, 폴링 훅의
 * 자체 복사본)에 있었고, 목록 배지는 "현재 선택된 항목"에만 최신 값을
 * 덮어썼다. 다른 항목을 클릭하는 순간 직전 항목이 history의 오래된 값으로
 * 되돌아가는 것이 그 구조의 필연이었다.
 */
export function BackgroundCheckSection({
  employee,
}: {
  employee: EmployeeDetail
}) {
  const [history, setHistory] = useState<BackgroundCheckListItem[] | null>(null)
  const [details, setDetails] = useState<Map<number, BackgroundCheckDetail>>(
    () => new Map(),
  )
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ambiguous, setAmbiguous] = useState<AmbiguousSurnameDetail | null>(null)

  // 상세 응답이 오는 모든 경로가 이 함수를 거친다.
  const mergeDetail = useCallback((d: BackgroundCheckDetail) => {
    setDetails((prev) => new Map(prev).set(d.id, d))
  }, [])

  const selected = selectedId === null ? null : (details.get(selectedId) ?? null)

  const { polling, exhausted, rechecking, error: pollError, recheck } =
    useCheckPolling(selected, mergeDetail)

  // 화면에 처음 들어왔을 때 가장 최근 이력을 자동으로 연다.
  // 없으면 pending인 조회를 두고 나갔다가 돌아와도 화면이 비어 있어,
  // 관리자가 이력을 클릭하기 전까지 상태가 갱신되지 않는다.
  const autoOpened = useRef(false)

  const loadHistory = useCallback(async () => {
    try {
      const items = await checksApi.listChecks(employee.id)
      setHistory(items)

      if (!autoOpened.current && items.length > 0) {
        autoOpened.current = true
        // 백엔드가 requested_at 내림차순으로 준다. 첫 항목이 최신이다.
        mergeDetail(await checksApi.getCheck(items[0].id))
        setSelectedId(items[0].id)
      }
    } catch (err) {
      setHistory([])
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '이력을 불러오지 못했습니다',
      )
    }
  }, [employee.id, mergeDetail])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // "새로고침"은 목록만이 아니라 선택된 결과도 갱신한다.
  // 목록 배지만 바뀌고 결과 패널이 그대로면 어느 쪽이 맞는지 알 수 없다.
  async function refresh() {
    setError(null)
    await loadHistory()
    if (selectedId !== null) {
      try {
        mergeDetail(await checksApi.getCheck(selectedId))
      } catch {
        // 목록은 이미 갱신됐다. 상세 실패를 화면 전체의 실패로 만들지 않는다.
      }
    }
  }

  async function submitRequest(surname?: string) {
    setError(null)
    setRequesting(true)
    try {
      let created = await checksApi.requestCheck(employee.id, surname)
      // POST 응답에는 세부 결과 4필드와 completed_at이 담기지 않는다(외부 API의
      // 생성 응답이 요약뿐이다). 즉시 완료된 조회를 그대로 보여주면 "이상 없음"
      // 배지 밑에 모든 항목이 "확인 중"으로 남는 자기모순 화면이 된다.
      // GET 한 번으로 백엔드가 외부와 동기화한 완전한 레코드를 받는다.
      // pending이면 어차피 폴링의 첫 GET이 곧바로 나가므로 여기서는 건너뛴다.
      if (created.status !== 'pending') {
        try {
          created = await checksApi.getCheck(created.id)
        } catch {
          // 동기화 실패면 요약본이라도 보여준다. 다음 클릭·새로고침에서 채워진다.
        }
      }
      setAmbiguous(null)
      mergeDetail(created)
      setSelectedId(created.id)
      // 방금 만든 것을 이미 열었다. 아래 loadHistory가 같은 항목을 또 조회하지 않도록 막는다.
      autoOpened.current = true
      await loadHistory()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 409 중에서 이것만 detail이 객체다. 나머지는 문자열이다.
        if (isAmbiguousSurname(err.detail)) {
          setAmbiguous(err.detail)
        } else {
          setError(err.displayMessage)
        }
      } else {
        setError(
          err instanceof ApiError
            ? err.displayMessage
            : '조회를 요청하지 못했습니다',
        )
      }
    } finally {
      setRequesting(false)
    }
  }

  async function openDetail(id: number) {
    setError(null)
    try {
      // 맵에 있어도 새로 받는다. 미완결 건은 이 GET이 백엔드 동기화를 겸한다.
      mergeDetail(await checksApi.getCheck(id))
      setSelectedId(id)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '결과를 불러오지 못했습니다',
      )
    }
  }

  // 목록 배지는 서버 목록 위에 상세 맵을 덮어 그린다. 선택 여부와 무관하게
  // 모든 항목에 적용되므로, 선택을 옮겨도 배지가 과거 값으로 돌아가지 않는다.
  const displayHistory =
    history === null
      ? null
      : history.map((h) => {
          const d = details.get(h.id)
          return d ? { ...h, status: d.status, completed_at: d.completed_at } : h
        })

  const resigned = employee.status === 'RESIGNED'
  // 진행 중인 조회가 있으면 요청 버튼을 비활성화한다. 백엔드도 409로 막지만,
  // 애초에 못 누르게 하는 것이 설계의 1차 방어선이다(docs/04 중복 방지).
  const hasPending = displayHistory?.some((h) => h.status === 'pending') ?? false

  return (
    <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">신원조회</h2>
          <p className="mt-1 text-xs text-slate-500">
            민감정보이므로 관리자만 열람할 수 있습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
          >
            새로고침
          </button>
          <button
            type="button"
            // 더블클릭(requesting)과 진행 중 재요청(hasPending)을 모두 막는다.
            disabled={requesting || resigned || hasPending}
            onClick={() => void submitRequest()}
            title={
              resigned
                ? '퇴사한 직원은 신원조회를 요청할 수 없습니다'
                : hasPending
                  ? '진행 중인 조회가 끝나면 요청할 수 있습니다'
                  : ''
            }
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {requesting ? '요청 중...' : '신원조회 요청'}
          </button>
        </div>
      </div>

      {resigned && (
        <p className="mt-3 text-xs text-slate-500">
          퇴사한 직원은 신규 조회를 요청할 수 없습니다. 과거 이력은 그대로
          조회됩니다.
        </p>
      )}
      {!resigned && hasPending && (
        <p className="mt-3 text-xs text-slate-500">
          진행 중인 조회가 있어 새 조회를 요청할 수 없습니다.
        </p>
      )}

      <div className="mt-4">
        <ErrorMessage message={error} />
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-medium text-slate-500">조회 이력</h3>
          <div className="mt-2">
            {displayHistory === null ? (
              <Spinner />
            ) : displayHistory.length === 0 ? (
              <EmptyState message="아직 신원조회 이력이 없습니다." />
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
                {displayHistory.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => void openDetail(h.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 ${
                        selectedId === h.id ? 'bg-slate-50' : ''
                      }`}
                    >
                      <span className="text-xs text-slate-600">
                        {formatDateTime(h.requested_at)}
                      </span>
                      <CheckStatusBadge status={h.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500">조회 결과</h3>
          <div className="mt-2 rounded-md ring-1 ring-slate-200">
            {selected === null ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">
                이력을 선택하거나 새 조회를 요청하세요.
              </div>
            ) : (
              <div className="space-y-3 p-3">
                <CheckResult check={selected} />
                {polling && <Spinner label="결과를 기다리는 중..." />}
                <ErrorMessage message={pollError} />
                {/* 소진 안내는 아직 pending일 때만 보인다. "다시 확인"으로
                    완료가 확인되면 결과만 남기고 안내는 치운다. */}
                {exhausted && selected.status === 'pending' && (
                  <div className="space-y-2">
                    {/* 실패가 아니다. 실패로 적으면 재요청을 시도했다가 409를 만난다. */}
                    <InfoMessage message="조회가 진행 중입니다. 잠시 후 다시 확인해 주세요." />
                    <button
                      type="button"
                      onClick={recheck}
                      disabled={rechecking}
                      className="rounded-md px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {rechecking ? '확인 중...' : '다시 확인'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <SurnameDialog
        detail={ambiguous}
        busy={requesting}
        onCancel={() => setAmbiguous(null)}
        onSelect={(surname) => void submitRequest(surname)}
      />
    </section>
  )
}

function SurnameDialog({
  detail,
  busy,
  onSelect,
  onCancel,
}: {
  detail: AmbiguousSurnameDetail | null
  busy: boolean
  onSelect: (surname: string) => void
  onCancel: () => void
}) {
  // ESC로 닫힌다. 요청이 나가는 중에는 상태가 꼬이지 않도록 막는다.
  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, busy, onCancel])

  if (!detail) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="성 확인"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">
          {detail.name} 님의 성을 확인해 주세요
        </h2>
        {/* 맥락 없이 질문을 받으면 관리자가 당황한다. 왜 묻는지 설명한다. */}
        <p className="mt-2 text-sm text-slate-600">
          외부 신원조회 서비스는 성과 이름을 나누어 요구합니다. 이 이름은
          자동으로 판별할 수 없어 확인이 필요합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {detail.candidates.map((c) => (
            <button
              key={c}
              type="button"
              disabled={busy}
              onClick={() => onSelect(c)}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              성이 「{c}」입니다
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
