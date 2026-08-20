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

export function BackgroundCheckSection({
  employee,
}: {
  employee: EmployeeDetail
}) {
  const [history, setHistory] = useState<BackgroundCheckListItem[] | null>(null)
  const [selected, setSelected] = useState<BackgroundCheckDetail | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ambiguous, setAmbiguous] = useState<AmbiguousSurnameDetail | null>(null)

  const { check, polling, exhausted, rechecking, error: pollError, recheck } =
    useCheckPolling(selected)

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
        setSelected(await checksApi.getCheck(items[0].id))
      }
    } catch (err) {
      setHistory([])
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '이력을 불러오지 못했습니다',
      )
    }
  }, [employee.id])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  async function submitRequest(surname?: string) {
    setError(null)
    setRequesting(true)
    try {
      const created = await checksApi.requestCheck(employee.id, surname)
      setAmbiguous(null)
      setSelected(created)
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
      setSelected(await checksApi.getCheck(id))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '결과를 불러오지 못했습니다',
      )
    }
  }

  // 폴링으로 상태가 바뀌면 목록 배지도 따라가야 한다.
  // 별도 state로 복사하지 않고 렌더 시점에 파생시킨다.
  const displayHistory =
    history === null || check === null
      ? history
      : history.map((h) =>
          h.id === check.id
            ? { ...h, status: check.status, completed_at: check.completed_at }
            : h,
        )

  const resigned = employee.status === 'RESIGNED'

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
            onClick={() => void loadHistory()}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
          >
            새로고침
          </button>
          <button
            type="button"
            // 요청 중에는 비활성화한다. 가장 흔한 중복 요청 원인이 더블클릭이다.
            disabled={requesting || resigned}
            onClick={() => void submitRequest()}
            title={resigned ? '퇴사한 직원은 신원조회를 요청할 수 없습니다' : ''}
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
                        selected?.id === h.id ? 'bg-slate-50' : ''
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
            {check === null ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">
                이력을 선택하거나 새 조회를 요청하세요.
              </div>
            ) : (
              <div className="space-y-3 p-3">
                <CheckResult check={check} />
                {polling && <Spinner label="결과를 기다리는 중..." />}
                <ErrorMessage message={pollError} />
                {exhausted && (
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
