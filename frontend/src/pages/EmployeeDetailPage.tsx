import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { ApiError, fieldErrors } from '../api/client'
import * as employeesApi from '../api/employees'
import type { EmployeeAdminUpdate, EmployeeDetail, Role } from '../api/types'
import { EmployeeStatusBadge, RoleBadge } from '../components/Badge'
import { BackgroundCheckSection } from '../components/BackgroundCheckSection'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorMessage, InfoMessage } from '../components/ErrorMessage'
import { ReadOnlyField, SelectField, TextField } from '../components/Field'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'

// 관리자가 자기 자신을 초기화하면 자기 세션도 끊긴다.
// 안내를 읽을 시간을 준 뒤 로그인 화면으로 보낸다.
const SELF_RESET_REDIRECT_MS = 2500

interface FormState {
  name: string
  date_of_birth: string
  phone: string
  address: string
  department: string
  position: string
  role: Role
}

function toForm(e: EmployeeDetail): FormState {
  return {
    name: e.name,
    date_of_birth: e.date_of_birth,
    phone: e.phone ?? '',
    address: e.address ?? '',
    department: e.department ?? '',
    position: e.position ?? '',
    role: e.role,
  }
}

export function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, clearSession } = useAuth()

  const id = Number(employeeId)
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [saving, setSaving] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const [resigning, setResigning] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [selfResetNotice, setSelfResetNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await employeesApi.getEmployee(id)
      setEmployee(data)
      setForm(toForm(data))
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.displayMessage
          : '직원 정보를 불러오지 못했습니다',
      )
    }
  }, [id])

  useEffect(() => {
    if (Number.isNaN(id)) return
    void load()
  }, [id, load])

  useEffect(() => {
    if (selfResetNotice === null) return
    const timer = window.setTimeout(() => {
      // 내 세션이 이미 서버에서 지워졌다. 인증 상태를 비우지 않으면
      // 로그인 화면이 "이미 로그인됨"으로 보고 되돌려 보낸다.
      clearSession(selfResetNotice)
      navigate('/login', { replace: true })
    }, SELF_RESET_REDIRECT_MS)
    return () => window.clearTimeout(timer)
  }, [selfResetNotice, navigate, clearSession])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev === null ? prev : { ...prev, [key]: value }))
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (form === null) return
    setSaveError(null)
    setNotice(null)
    setErrors({})
    setSaving(true)
    try {
      // status는 이 폼에 없다. 퇴사는 전용 엔드포인트로만 처리한다.
      const payload: EmployeeAdminUpdate = {
        name: form.name,
        date_of_birth: form.date_of_birth,
        phone: form.phone || null,
        address: form.address || null,
        department: form.department || null,
        position: form.position || null,
        role: form.role,
      }
      const updated = await employeesApi.updateEmployee(id, payload)
      setEmployee(updated)
      setForm(toForm(updated))
      setNotice('저장되었습니다.')
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(err.displayMessage)
        setErrors(fieldErrors(err))
      } else {
        setSaveError('저장하지 못했습니다')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleResign() {
    setResigning(true)
    setSaveError(null)
    try {
      const updated = await employeesApi.resignEmployee(id)
      setEmployee(updated)
      setForm(toForm(updated))
      setNotice('퇴사 처리되었습니다. 해당 직원의 세션은 즉시 무효화됩니다.')
      setConfirmResign(false)
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.displayMessage : '퇴사 처리하지 못했습니다',
      )
      setConfirmResign(false)
    } finally {
      setResigning(false)
    }
  }

  async function handleResetPassword() {
    setResetting(true)
    setSaveError(null)
    try {
      const res = await employeesApi.resetPassword(id)
      setConfirmReset(false)
      setNotice(res.message)
      // 대상이 나 자신이면 방금 내 세션도 사라졌다. 이 화면에 머물면
      // 다음 동작이 전부 401이 되므로 안내 후 로그인 화면으로 보낸다.
      if (user?.id === id) setSelfResetNotice(res.message)
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.displayMessage : '초기화하지 못했습니다',
      )
      setConfirmReset(false)
    } finally {
      setResetting(false)
    }
  }

  // 잘못된 주소는 상태로 들고 있을 필요가 없다. 렌더 시점에 판정한다.
  const message = Number.isNaN(id) ? '잘못된 주소입니다' : loadError

  if (message) {
    return (
      <div className="space-y-4">
        <Link to="/admin/employees" className="text-sm text-slate-500 hover:underline">
          ← 직원 목록
        </Link>
        <ErrorMessage message={message} />
      </div>
    )
  }

  if (employee === null || form === null) return <Spinner />

  const isSelf = user?.id === employee.id
  const alreadyResigned = employee.status === 'RESIGNED'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/admin/employees" className="text-sm text-slate-500 hover:underline">
          직원 목록
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-lg font-semibold text-slate-900">{employee.name}</h1>
        <EmployeeStatusBadge status={employee.status} />
        <RoleBadge role={employee.role} />
      </div>

      <InfoMessage message={notice} />

      <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">기본 정보</h2>
          <div className="flex flex-wrap gap-2">
            {/* 초기화는 퇴사자와 본인에게도 허용된다. 조건 없이 보여준다. */}
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              비밀번호 초기화
            </button>
            {/* 본인이면 백엔드가 400을 반환하므로 버튼 자체를 숨긴다.
                이미 퇴사한 직원도 마찬가지로 숨긴다. */}
            {!isSelf && !alreadyResigned && (
              <button
                type="button"
                onClick={() => setConfirmResign(true)}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-50"
              >
                퇴사 처리
              </button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <ReadOnlyField label="사번" value={employee.employee_no} />
          <ReadOnlyField label="아이디" value={employee.login_id} />
          <ReadOnlyField
            label="재직 상태"
            value={<EmployeeStatusBadge status={employee.status} />}
          />
        </dl>

        <form onSubmit={(e) => void handleSave(e)} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="이름"
              name="name"
              value={form.name}
              onChange={(v) => set('name', v)}
              required
              error={errors.name}
              disabled={saving}
            />
            <TextField
              label="생년월일"
              name="date_of_birth"
              type="date"
              value={form.date_of_birth}
              onChange={(v) => set('date_of_birth', v)}
              error={errors.date_of_birth}
              disabled={saving}
            />
            <TextField
              label="연락처"
              name="phone"
              value={form.phone}
              onChange={(v) => set('phone', v)}
              error={errors.phone}
              disabled={saving}
            />
            <TextField
              label="주소"
              name="address"
              value={form.address}
              onChange={(v) => set('address', v)}
              error={errors.address}
              disabled={saving}
            />
            <TextField
              label="부서"
              name="department"
              value={form.department}
              onChange={(v) => set('department', v)}
              error={errors.department}
              disabled={saving}
            />
            <TextField
              label="직급"
              name="position"
              value={form.position}
              onChange={(v) => set('position', v)}
              error={errors.position}
              disabled={saving}
            />
            <SelectField<Role>
              label="역할"
              name="role"
              value={form.role}
              onChange={(v) => set('role', v)}
              options={[
                { value: 'EMPLOYEE', label: '직원' },
                { value: 'ADMIN', label: '관리자' },
              ]}
              disabled={saving || isSelf}
            />
          </div>

          {isSelf && (
            <p className="text-xs text-slate-500">
              본인 계정입니다. 권한 변경과 퇴사 처리는 할 수 없습니다.
            </p>
          )}

          <ErrorMessage message={saveError} />

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      </section>

      <BackgroundCheckSection employee={employee} />

      <ConfirmDialog
        open={confirmReset}
        title="비밀번호를 초기화하시겠습니까?"
        destructive
        busy={resetting}
        confirmLabel="초기화"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void handleResetPassword()}
      >
        <p>
          <strong>{employee.name}</strong> 님의 비밀번호를 초기값으로 되돌리고,
          로그인된 모든 세션을 종료합니다.
        </p>
        <p className="mt-2">되돌릴 수 없습니다.</p>
        {isSelf && (
          <p className="mt-2 font-medium text-rose-700">
            본인 계정입니다. 초기화하면 지금 이 세션도 종료되어 다시 로그인해야
            합니다.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmResign}
        title="퇴사 처리하시겠습니까?"
        destructive
        busy={resigning}
        confirmLabel="퇴사 처리"
        onCancel={() => setConfirmResign(false)}
        onConfirm={() => void handleResign()}
      >
        <p>
          <strong>{employee.name}</strong> 님을 퇴사 처리합니다. 계정이 즉시
          차단되고 로그인 중이던 세션도 모두 무효화됩니다.
        </p>
        <p className="mt-2">
          직원 정보는 삭제되지 않으며 관리자는 계속 조회할 수 있습니다.
        </p>
      </ConfirmDialog>
    </div>
  )
}
