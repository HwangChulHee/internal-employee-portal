import { useState, type FormEvent } from 'react'

import * as authApi from '../api/auth'
import { ApiError } from '../api/client'
import { EmployeeStatusBadge, RoleBadge } from '../components/Badge'
import { ErrorMessage, InfoMessage } from '../components/ErrorMessage'
import { ReadOnlyField, TextField } from '../components/Field'
import { useAuth } from '../hooks/useAuth'

export function MePage() {
  const { user, setUser } = useAuth()
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [address, setAddress] = useState(user?.address ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!user) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      // PATCH /api/me는 phone과 address만 받는다.
      // 다른 필드는 보내도 무시되므로 입력란 자체를 만들지 않았다.
      const updated = await authApi.updateMe({
        phone: phone.trim() === '' ? null : phone.trim(),
        address: address.trim() === '' ? null : address.trim(),
      })
      setUser(updated)
      setNotice('저장되었습니다.')
    } catch (err) {
      setError(
        err instanceof ApiError ? err.displayMessage : '저장하지 못했습니다',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">내 정보</h1>

      <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">기본 정보</h2>
        <p className="mt-1 text-xs text-slate-500">
          아래 항목은 조회만 가능합니다. 변경이 필요하면 관리자에게 문의하세요.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="사번" value={user.employee_no} />
          <ReadOnlyField label="아이디" value={user.login_id} />
          <ReadOnlyField label="이름" value={user.name} />
          <ReadOnlyField label="생년월일" value={user.date_of_birth} />
          <ReadOnlyField label="부서" value={user.department} />
          <ReadOnlyField label="직급" value={user.position} />
          <ReadOnlyField label="역할" value={<RoleBadge role={user.role} />} />
          <ReadOnlyField
            label="재직 상태"
            value={<EmployeeStatusBadge status={user.status} />}
          />
        </dl>
      </section>

      <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">연락처 수정</h2>
        <p className="mt-1 text-xs text-slate-500">
          연락처와 주소만 직접 변경할 수 있습니다.
        </p>
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mt-4 space-y-4 sm:max-w-md"
        >
          <TextField
            label="연락처"
            name="phone"
            value={phone}
            onChange={setPhone}
            placeholder="010-0000-0000"
            disabled={saving}
          />
          <TextField
            label="주소"
            name="address"
            value={address}
            onChange={setAddress}
            disabled={saving}
          />
          <ErrorMessage message={error} />
          <InfoMessage message={notice} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      </section>
    </div>
  )
}
