import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'

import * as authApi from '../api/auth'
import { ApiError } from '../api/client'
import { ErrorMessage, InfoMessage } from '../components/ErrorMessage'
import { FullPageSpinner } from '../components/Spinner'
import { TextField } from '../components/Field'
import { useAuth } from '../hooks/useAuth'
import { landingPathFor } from '../routes'

export function LoginPage() {
  // 비밀번호 변경처럼 세션이 끊긴 이유가 있으면 컨텍스트에 담겨 온다.
  const { user, loading, refresh, sessionNotice } = useAuth()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <FullPageSpinner />
  // 이미 로그인 상태면 역할에 맞는 화면으로 보낸다.
  if (user) return <Navigate to={landingPathFor(user.role)} replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await authApi.login(loginId, password)
      // 로그인 성공 후 /api/me로 사용자 정보를 확보한다.
      await refresh()
    } catch (err) {
      // 백엔드가 준 메시지를 그대로 보여준다.
      // 자격증명 오류와 퇴사자 안내가 서로 다른 문구다.
      setError(
        err instanceof ApiError
          ? err.displayMessage
          : '로그인 중 문제가 발생했습니다',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-lg font-semibold text-slate-900">
          사내 직원 포털
        </h1>
        {sessionNotice && (
          <div className="mt-4">
            <InfoMessage message={sessionNotice} />
          </div>
        )}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mt-6 space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200"
        >
          <TextField
            label="아이디"
            name="login_id"
            value={loginId}
            onChange={setLoginId}
            required
            disabled={submitting}
            autoComplete="username"
          />
          <TextField
            label="비밀번호"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            disabled={submitting}
            autoComplete="current-password"
          />
          <ErrorMessage message={error} />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
