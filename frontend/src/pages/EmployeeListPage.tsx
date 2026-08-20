import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as employeesApi from '../api/employees'
import type { EmployeeListItem, EmployeeStatus } from '../api/types'
import { EmployeeStatusBadge } from '../components/Badge'
import { EmptyState, ErrorMessage } from '../components/ErrorMessage'
import { Spinner } from '../components/Spinner'

type StatusFilter = EmployeeStatus | ''

const FILTERS: { value: StatusFilter; label: string }[] = [
  // 기본값이 전체다. 관리자는 퇴사자도 조회할 수 있어야 하므로 숨기지 않는다.
  { value: '', label: '전체' },
  { value: 'ACTIVE', label: '재직' },
  { value: 'RESIGNED', label: '퇴사' },
]

export function EmployeeListPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusFilter>('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<EmployeeListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (s: StatusFilter, q: string) => {
    setError(null)
    try {
      setItems(await employeesApi.listEmployees({ status: s, q }))
    } catch (err) {
      setItems([])
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '목록을 불러오지 못했습니다',
      )
    }
  }, [])

  useEffect(() => {
    void load(status, query)
    // query는 제출 시점에만 반영한다. 입력할 때마다 호출하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">직원 목록</h1>
        <Link
          to="/admin/employees/new"
          className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
        >
          직원 등록
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                status === f.value
                  ? 'bg-slate-800 font-medium text-white'
                  : 'text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void load(status, query)
          }}
        >
          <input
            aria-label="이름 또는 사번 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 사번 검색"
            className="min-w-40 flex-1 rounded-md border-0 bg-white px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-slate-600"
          />
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
          >
            검색
          </button>
        </form>
      </div>

      <ErrorMessage message={error} />

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState message="조건에 맞는 직원이 없습니다." />
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">사번</th>
                <th className="px-4 py-2 font-medium">이름</th>
                <th className="px-4 py-2 font-medium">부서</th>
                <th className="px-4 py-2 font-medium">직급</th>
                <th className="px-4 py-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => navigate(`/admin/employees/${e.id}`)}
                  className={`cursor-pointer hover:bg-slate-50 ${
                    e.status === 'RESIGNED' ? 'text-slate-400' : ''
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {e.employee_no}
                  </td>
                  <td className="px-4 py-2">{e.name}</td>
                  <td className="px-4 py-2">{e.department ?? '—'}</td>
                  <td className="px-4 py-2">{e.position ?? '—'}</td>
                  <td className="px-4 py-2">
                    <EmployeeStatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        총 {items?.length ?? 0}명 · 200명 규모라 페이지네이션 없이 전체를
        표시합니다.
      </p>
    </div>
  )
}
