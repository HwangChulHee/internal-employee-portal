/**
 * 공용 페이저. 페이지 수가 1 이하이면 아무것도 그리지 않는다 —
 * 넘길 곳이 없는데 컨트롤만 있으면 고장으로 오해한다.
 */
export function Pager({
  page,
  total,
  pageSize,
  onChange,
  disabled = false,
}: {
  page: number
  total: number
  pageSize: number
  onChange: (page: number) => void
  disabled?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-md px-3 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        이전
      </button>
      <span className="text-xs text-slate-500">
        {page} / {pages} 페이지
      </span>
      <button
        type="button"
        disabled={disabled || page >= pages}
        onClick={() => onChange(page + 1)}
        className="rounded-md px-3 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        다음
      </button>
    </div>
  )
}
