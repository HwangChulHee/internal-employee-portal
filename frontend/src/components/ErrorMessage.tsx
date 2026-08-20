export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="whitespace-pre-line rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200"
    >
      {message}
    </p>
  )
}

export function InfoMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="whitespace-pre-line rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-inset ring-sky-200">
      {message}
    </p>
  )
}

/** 목록이 비었을 때. 빈 화면만 나오면 고장으로 오해한다. */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </p>
  )
}
