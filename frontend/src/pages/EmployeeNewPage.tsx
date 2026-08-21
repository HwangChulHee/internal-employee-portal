import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError, fieldErrors } from '../api/client'
import * as employeesApi from '../api/employees'
import type { EmployeeCreate, Role } from '../api/types'
import { ErrorMessage } from '../components/ErrorMessage'
import { SelectField, TextField } from '../components/Field'
import { usePasswordPolicy } from '../hooks/usePasswordPolicy'

const EMPTY: EmployeeCreate = {
  employee_no: '',
  login_id: '',
  name: '',
  date_of_birth: '',
  phone: '',
  address: '',
  department: '',
  position: '',
  role: 'EMPLOYEE',
}

export function EmployeeNewPage() {
  const navigate = useNavigate()
  // 초기 비밀번호를 화면에 적어두지 않는다. 백엔드가 실제로 설정하는 값을 받아 쓴다.
  const policy = usePasswordPolicy()
  const [form, setForm] = useState<EmployeeCreate>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  function set<K extends keyof EmployeeCreate>(key: K, value: EmployeeCreate[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setErrors({})
    setSubmitting(true)
    try {
      const created = await employeesApi.createEmployee({
        ...form,
        phone: form.phone || null,
        address: form.address || null,
        department: form.department || null,
        position: form.position || null,
      })
      navigate(`/admin/employees/${created.id}`, {
        state: {
          // 응답에 담겨 온 값을 그대로 쓴다. 서버가 실제로 설정한 비밀번호다.
          notice:
            `계정이 생성되었습니다. 아이디는 ${created.login_id}, ` +
            `초기 비밀번호는 ${created.initial_password} 입니다.`,
        },
      })
    } catch (err) {
      if (err instanceof ApiError) {
        // 409는 사번/아이디 중복이며 백엔드가 어느 쪽인지 구분해 알려준다.
        setError(err.displayMessage)
        setErrors(fieldErrors(err))
      } else {
        setError('등록하지 못했습니다')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin/employees" className="text-sm text-slate-500 hover:underline">
          직원 목록
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-lg font-semibold text-slate-900">직원 등록</h1>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-5 rounded-lg bg-white p-5 ring-1 ring-slate-200"
      >
        <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-200">
          비밀번호는 입력하지 않습니다. 초기 비밀번호는{' '}
          {policy === null ? (
            '자동으로 설정됩니다'
          ) : (
            <strong className="font-semibold">{policy.initial_password}</strong>
          )}
          {policy === null ? '.' : ' 입니다.'} 직원이 로그인 후 직접 변경할 수 있습니다.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="사번"
            name="employee_no"
            value={form.employee_no}
            onChange={(v) => set('employee_no', v)}
            placeholder="EMP-2024-010"
            required
            error={errors.employee_no}
            disabled={submitting}
          />
          <TextField
            label="로그인 아이디"
            name="login_id"
            value={form.login_id}
            onChange={(v) => set('login_id', v)}
            required
            error={errors.login_id}
            disabled={submitting}
          />
          <TextField
            label="이름"
            name="name"
            value={form.name}
            onChange={(v) => set('name', v)}
            required
            error={errors.name}
            disabled={submitting}
          />
          <TextField
            label="생년월일"
            name="date_of_birth"
            type="date"
            value={form.date_of_birth}
            onChange={(v) => set('date_of_birth', v)}
            required
            error={errors.date_of_birth}
            disabled={submitting}
          />
          <TextField
            label="연락처"
            name="phone"
            value={form.phone ?? ''}
            onChange={(v) => set('phone', v)}
            error={errors.phone}
            disabled={submitting}
          />
          <TextField
            label="주소"
            name="address"
            value={form.address ?? ''}
            onChange={(v) => set('address', v)}
            error={errors.address}
            disabled={submitting}
          />
          <TextField
            label="부서"
            name="department"
            value={form.department ?? ''}
            onChange={(v) => set('department', v)}
            error={errors.department}
            disabled={submitting}
          />
          <TextField
            label="직급"
            name="position"
            value={form.position ?? ''}
            onChange={(v) => set('position', v)}
            error={errors.position}
            disabled={submitting}
          />
          <SelectField<Role>
            label="역할"
            name="role"
            value={form.role ?? 'EMPLOYEE'}
            onChange={(v) => set('role', v)}
            options={[
              { value: 'EMPLOYEE', label: '직원' },
              { value: 'ADMIN', label: '관리자' },
            ]}
            disabled={submitting}
          />
        </div>

        <ErrorMessage message={error} />

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {submitting ? '등록 중...' : '등록'}
          </button>
          <Link
            to="/admin/employees"
            className="rounded-md px-4 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  )
}
