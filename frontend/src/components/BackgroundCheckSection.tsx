import { useCallback, useEffect, useReducer, useRef } from 'react'

import * as checksApi from '../api/backgroundChecks'
import { ApiError, isAmbiguousSurname } from '../api/client'
import type {
  AmbiguousSurnameDetail,
  BackgroundCheckDetail,
  BackgroundCheckListItem,
  EmployeeDetail,
  Page,
} from '../api/types'
import { CheckStatusBadge } from './Badge'
import { formatDateTime } from '../format'
import { CheckResult } from './CheckResult'
import { EmptyState, ErrorMessage, InfoMessage } from './ErrorMessage'
import { Pager } from './Pager'
import { Spinner } from './Spinner'
import { useCheckPolling } from '../hooks/useCheckPolling'

/**
 * 상태 구조에 대하여.
 *
 * 조회 데이터의 진실의 원천은 details 맵 하나다. 어떤 경로(이력 클릭, 폴링,
 * 다시 확인, 새 요청)로 상세 응답이 오든 DETAIL_LOADED로 이 맵에 병합되고,
 * 선택은 selectedId라는 id 하나만 들고 있는다. 결과 패널과 목록 배지는 둘 다
 * 이 맵에서 파생되므로 서로 어긋날 수 없다.
 *
 * 상태 전이를 reducer 한 곳에 모은 이유: 상세 GET은 빠르다는 보장이 없다.
 * 미완결 건의 GET은 백엔드가 외부 API 동기화를 겸하는데, 외부가 503과
 * retryAfter 30초를 주면 재시도까지 1분 넘게 걸릴 수 있다. 그 사이에
 * 사용자는 다른 항목을 클릭하고, 폴링 응답이 도착하고, 새 요청이 생긴다.
 * 흩어진 setState 조합으로는 이 동시 진행을 추적하기 어렵다.
 *
 * 그래서 선택과 로딩을 분리한다. SELECT는 즉시 반영되고(클릭이 씹히지
 * 않는다), 응답은 나중에 DETAIL_LOADED로 도착한다. loadingId가 "지금
 * 기다리는 응답"을 가리키므로 뒤늦게 도착한 응답이 로딩 표시를 잘못 끄거나
 * 다른 선택을 덮어쓸 수 없다.
 */
// 이력도 페이지 단위다. 시드·실사용 모두에서 이력이 늘어나면 한 화면에 다 못 싣는다.
const HISTORY_PAGE_SIZE = 5

interface CheckState {
  history: Page<BackgroundCheckListItem> | null
  details: ReadonlyMap<number, BackgroundCheckDetail>
  selectedId: number | null
  /** 상세 응답을 기다리는 id. 선택(selectedId)과 별개다. */
  loadingId: number | null
  requesting: boolean
  error: string | null
  ambiguous: AmbiguousSurnameDetail | null
}

type CheckAction =
  | { type: 'HISTORY_LOADED'; result: Page<BackgroundCheckListItem> }
  | { type: 'HISTORY_FAILED'; message: string }
  | { type: 'SELECT'; id: number }
  | { type: 'SELECT_CACHED'; id: number }
  | { type: 'DETAIL_LOADED'; detail: BackgroundCheckDetail }
  | { type: 'DETAIL_FAILED'; id: number; message: string }
  | { type: 'REQUEST_START' }
  | { type: 'REQUEST_CREATED'; detail: BackgroundCheckDetail }
  | { type: 'REQUEST_FAILED'; message: string }
  | { type: 'REQUEST_DONE' }
  | { type: 'AMBIGUOUS'; detail: AmbiguousSurnameDetail }
  | { type: 'DIALOG_CANCELLED' }
  | { type: 'CLEAR_ERROR' }

const INITIAL: CheckState = {
  history: null,
  details: new Map(),
  selectedId: null,
  loadingId: null,
  requesting: false,
  error: null,
  ambiguous: null,
}

/**
 * 완결된 조회인가. status가 pending이 아니고 세부까지 동기화됐다면
 * (completed_at 채워짐) 백엔드는 이 레코드를 다시는 수정하지 않는다.
 * 다시 받아와도 같은 값이므로 재조회하지 않는다. 재조회를 걸면
 * 완료된 결과 밑에 스피너가 클릭마다 깜빡이고, 동기화가 덜 된 외부 API
 * 상황에서는 불필요한 외부 호출까지 늘어난다.
 */
function isFinal(check: BackgroundCheckDetail | undefined): boolean {
  return check !== undefined && check.status !== 'pending' && check.completed_at !== null
}

function merge(
  details: ReadonlyMap<number, BackgroundCheckDetail>,
  detail: BackgroundCheckDetail,
): ReadonlyMap<number, BackgroundCheckDetail> {
  return new Map(details).set(detail.id, detail)
}

function reducer(state: CheckState, action: CheckAction): CheckState {
  switch (action.type) {
    case 'HISTORY_LOADED':
      return { ...state, history: action.result }
    case 'HISTORY_FAILED':
      return {
        ...state,
        history: state.history ?? { items: [], total: 0, page: 1, page_size: HISTORY_PAGE_SIZE },
        error: action.message,
      }
    case 'SELECT':
      // 선택은 즉시 바뀐다. 응답을 기다렸다가 바꾸면 느린 GET 동안 클릭이 죽는다.
      return { ...state, selectedId: action.id, loadingId: action.id, error: null }
    case 'SELECT_CACHED':
      // 재조회 없는 선택. 완결된 캐시를 그대로 보여주므로 로딩을 걸지 않는다.
      return { ...state, selectedId: action.id, loadingId: null, error: null }
    case 'DETAIL_LOADED':
      return {
        ...state,
        details: merge(state.details, action.detail),
        // 다른 항목을 이미 클릭했다면(loadingId가 바뀌었다면) 로딩 표시를 건드리지 않는다.
        loadingId: state.loadingId === action.detail.id ? null : state.loadingId,
      }
    case 'DETAIL_FAILED': {
      // 이미 다른 선택으로 넘어갔으면 뒤늦은 실패는 무시한다.
      if (state.loadingId !== action.id) return state
      return {
        ...state,
        loadingId: null,
        error: action.message,
        // 보여줄 캐시조차 없으면 선택을 되돌려 빈 패널 대신 안내 문구를 남긴다.
        selectedId: state.details.has(action.id) ? state.selectedId : null,
      }
    }
    case 'REQUEST_START':
      return { ...state, requesting: true, error: null }
    case 'REQUEST_CREATED':
      // 요약본이라도 즉시 병합·선택한다. 이후 동기화가 느려도 화면은 반응한다.
      return {
        ...state,
        details: merge(state.details, action.detail),
        selectedId: action.detail.id,
        loadingId: null,
        ambiguous: null,
      }
    case 'REQUEST_FAILED':
      return { ...state, error: action.message, ambiguous: null }
    case 'REQUEST_DONE':
      return { ...state, requesting: false }
    case 'AMBIGUOUS':
      return { ...state, ambiguous: action.detail }
    case 'DIALOG_CANCELLED':
      return { ...state, ambiguous: null }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
  }
}

export function BackgroundCheckSection({
  employee,
}: {
  employee: EmployeeDetail
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const { history, details, selectedId, loadingId, requesting, error, ambiguous } =
    state

  const selected = selectedId === null ? null : (details.get(selectedId) ?? null)

  const onUpdate = useCallback((detail: BackgroundCheckDetail) => {
    dispatch({ type: 'DETAIL_LOADED', detail })
  }, [])

  const { polling, exhausted, rechecking, error: pollError, recheck } =
    useCheckPolling(selected, onUpdate)

  // reducer 상태를 이벤트 핸들러에서 읽기 위한 최신값 미러.
  // openDetail의 의존성에 details를 넣으면 병합 때마다 함수가 새로 만들어져
  // loadHistory → useEffect가 연쇄 재실행된다.
  const detailsRef = useRef(details)
  useEffect(() => {
    detailsRef.current = details
  }, [details])

  // 선택을 즉시 바꾸고 상세는 백그라운드로 받는다. await하지 않는다.
  const openDetail = useCallback((id: number) => {
    // 완결된 캐시는 다시 받지 않는다. 값이 변할 수 없는 레코드다.
    if (isFinal(detailsRef.current.get(id))) {
      dispatch({ type: 'SELECT_CACHED', id })
      return
    }
    dispatch({ type: 'SELECT', id })
    checksApi.getCheck(id).then(
      (detail) => dispatch({ type: 'DETAIL_LOADED', detail }),
      (err: unknown) =>
        dispatch({
          type: 'DETAIL_FAILED',
          id,
          message:
            err instanceof ApiError
              ? err.displayMessage
              : '결과를 불러오지 못했습니다',
        }),
    )
  }, [])

  // 화면에 처음 들어왔을 때 가장 최근 이력을 자동으로 연다.
  // 없으면 pending인 조회를 두고 나갔다가 돌아와도 화면이 비어 있어,
  // 관리자가 이력을 클릭하기 전까지 상태가 갱신되지 않는다.
  const autoOpened = useRef(false)

  const loadHistory = useCallback(
    async (page = 1) => {
      try {
        const result = await checksApi.listChecks(
          employee.id,
          page,
          HISTORY_PAGE_SIZE,
        )
        dispatch({ type: 'HISTORY_LOADED', result })

        if (!autoOpened.current && result.items.length > 0) {
          autoOpened.current = true
          // 백엔드가 requested_at 내림차순으로 준다. 1페이지 첫 항목이 최신이다.
          openDetail(result.items[0].id)
        }
      } catch (err) {
        dispatch({
          type: 'HISTORY_FAILED',
          message:
            err instanceof ApiError
              ? err.displayMessage
              : '이력을 불러오지 못했습니다',
        })
      }
    },
    [employee.id, openDetail],
  )

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // "새로고침"은 목록만이 아니라 선택된 결과도 갱신한다.
  // 목록 배지만 바뀌고 결과 패널이 그대로면 어느 쪽이 맞는지 알 수 없다.
  async function refresh() {
    dispatch({ type: 'CLEAR_ERROR' })
    // 보고 있던 페이지를 유지한 채 다시 받는다.
    await loadHistory(history?.page ?? 1)
    if (selectedId !== null) {
      try {
        dispatch({
          type: 'DETAIL_LOADED',
          detail: await checksApi.getCheck(selectedId),
        })
      } catch {
        // 목록은 이미 갱신됐다. 상세 실패를 화면 전체의 실패로 만들지 않는다.
      }
    }
  }

  async function submitRequest(surname?: string) {
    dispatch({ type: 'REQUEST_START' })
    try {
      const created = await checksApi.requestCheck(employee.id, surname)
      dispatch({ type: 'REQUEST_CREATED', detail: created })
      // 방금 만든 것을 이미 열었다. loadHistory가 같은 항목을 또 조회하지 않도록 막는다.
      autoOpened.current = true
      // 목록부터 갱신한다. DB 조회라 빠르고, 새 항목이 즉시 왼쪽에 나타난다.
      // 새 항목은 항상 최신이므로 1페이지로 돌아간다.
      await loadHistory(1)
      // POST 응답에는 세부 결과 4필드와 completed_at이 담기지 않는다(외부 API의
      // 생성 응답이 요약뿐이다). 즉시 완료된 조회는 GET 한 번으로 백엔드가
      // 동기화한 완전한 레코드를 받는다. pending이면 폴링의 첫 GET이 곧바로
      // 나가므로 건너뛴다.
      //
      // 이 GET을 기다리지 않는다. 백엔드 동기화가 외부 재시도(503 → 30초 대기)를
      // 타면 1분 가까이 걸리는데, 그동안 await로 잡아두면 목록도 안 갱신되고
      // 버튼도 "요청 중..."으로 잠긴 채 화면이 굳는다. 실제로 그렇게 보였다.
      // openDetail이 로딩 표시를 걸고 백그라운드로 받아온다.
      if (created.status !== 'pending') {
        openDetail(created.id)
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        isAmbiguousSurname(err.detail)
      ) {
        // 409 중에서 이것만 detail이 객체다. 나머지는 문자열이다.
        dispatch({ type: 'AMBIGUOUS', detail: err.detail })
      } else {
        dispatch({
          type: 'REQUEST_FAILED',
          message:
            err instanceof ApiError
              ? err.displayMessage
              : '조회를 요청하지 못했습니다',
        })
      }
    } finally {
      dispatch({ type: 'REQUEST_DONE' })
    }
  }

  // 목록 배지는 서버 목록 위에 상세 맵을 덮어 그린다. 선택 여부와 무관하게
  // 모든 항목에 적용되므로, 선택을 옮겨도 배지가 과거 값으로 돌아가지 않는다.
  const displayHistory =
    history === null
      ? null
      : history.items.map((h) => {
          const d = details.get(h.id)
          return d ? { ...h, status: d.status, completed_at: d.completed_at } : h
        })

  const resigned = employee.status === 'RESIGNED'
  // 진행 중인 조회가 있으면 요청 버튼을 비활성화한다. 백엔드도 409로 막지만,
  // 애초에 못 누르게 하는 것이 설계의 1차 방어선이다(docs/04 중복 방지).
  // 캐시(details)도 함께 본다. pending은 항상 1페이지 맨 위에 오지만,
  // 다른 페이지를 보는 동안에도 폴링이 캐시를 최신으로 유지하고 있다.
  const hasPending =
    (displayHistory?.some((h) => h.status === 'pending') ?? false) ||
    [...details.values()].some((d) => d.status === 'pending')

  // 스피너는 상태 조합에서 파생시킨다.
  // detailLoading: 선택한 항목의 상세 응답을 기다리는 중 (느린 동기화 포함)
  // showPolling: pending이고 폴링이 도는 중. polling 플래그 단독으로 쓰지 않는
  //   이유는, 폴링 밖 경로(새로고침 등)로 완료가 확인되면 플래그가 해제되기 전에
  //   상태가 먼저 바뀔 수 있기 때문이다. 완료된 결과 위에 스피너를 남기지 않는다.
  const detailLoading = selectedId !== null && loadingId === selectedId
  const showPolling = polling && selected?.status === 'pending'

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
                      onClick={() => openDetail(h.id)}
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
            {history !== null && (
              <div className="mt-2">
                <Pager
                  page={history.page}
                  total={history.total}
                  pageSize={HISTORY_PAGE_SIZE}
                  onChange={(p) => void loadHistory(p)}
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium text-slate-500">조회 결과</h3>
          <div className="mt-2 rounded-md ring-1 ring-slate-200">
            {selectedId === null ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">
                이력을 선택하거나 새 조회를 요청하세요.
              </div>
            ) : selected === null ? (
              // 선택은 됐지만 상세가 아직 없다. 미완결 건은 백엔드가 외부 동기화를
              // 겸해서 이 구간이 수십 초일 수 있다. 반드시 표시가 있어야 한다.
              //
              // 스피너만 있으면 조회 자체가 진행 중인 것으로 읽혀 목록의 완료
              // 배지와 모순돼 보인다. 이미 아는 상태(목록의 배지)를 함께 보여
              // "조회는 끝났고 세부를 받아오는 중"임이 드러나게 한다.
              <div className="space-y-3 px-3 py-8">
                {(() => {
                  const summary = displayHistory?.find(
                    (h) => h.id === selectedId,
                  )
                  return summary ? (
                    <div className="flex justify-center">
                      <CheckStatusBadge status={summary.status} />
                    </div>
                  ) : null
                })()}
                <Spinner label="세부 결과를 불러오는 중..." />
              </div>
            ) : (
              <div className="space-y-3 p-3">
                <CheckResult check={selected} />
                {detailLoading && !showPolling && (
                  <Spinner label="결과를 불러오는 중..." />
                )}
                {showPolling && <Spinner label="결과를 기다리는 중..." />}
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
        onCancel={() => dispatch({ type: 'DIALOG_CANCELLED' })}
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
