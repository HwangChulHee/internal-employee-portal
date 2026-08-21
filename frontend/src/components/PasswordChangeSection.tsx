import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import * as authApi from '../api/auth'
import { ApiError } from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { usePasswordPolicy } from '../hooks/usePasswordPolicy'
import { ErrorMessage, InfoMessage } from './ErrorMessage'
import { TextField } from './Field'

// 성공 메시지를 읽을 시간을 준 뒤 로그인 화면으로 보낸다.
// 곧바로 이동하면 무엇이 성공했는지 보지 못한 채 로그인 폼만 마주한다.
const REDIRECT_DELAY_MS = 2500

/**
 * 비밀번호 변경. 성공하면 서버가 이 세션까지 지우므로 반드시 재로그인해야 한다.
 *
 * 연락처 수정 폼과 한 폼에 섞지 않는다. 저장 버튼 하나가
 * "연락처를 고친다"와 "로그아웃된다"를 동시에 뜻하면 누르기 전에 예측할 수 없다.
 */
export function PasswordChangeSection() {
  const navigate = useNavigate()
  const { clearSession } = useAuth()
  const policy = usePasswordPolicy()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (done === null) return
    const timer = window.setTimeout(() => {
      // 세션이 이미 없으므로 인증 상태를 비운다.
      // 비우지 않으면 로그인 화면이 "이미 로그인됨"으로 보고 되돌려 보낸다.
      // 안내 문구는 clearSession에 넘긴다. 라우터 state로 보내면
      // RequireAuth의 리다이렉트와 경합해 사라질 수 있다.
      clearSession(done)
      navigate('/login', { replace: true })
    }, REDIRECT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [done, navigate, clearSession])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (policy === null) return
    setError(null)

    // 서버도 같은 검사를 한다. 여기서 먼저 걸러 왕복 한 번을 줄이는 것뿐이다.
    if (next.length < policy.min_length) {
      setError(`새 비밀번호는 ${policy.min_length}자 이상이어야 합니다`)
      return
    }
    if (next !== confirm) {
      setError('새 비밀번호가 확인란과 일치하지 않습니다')
      return
    }

    setSubmitting(true)
    try {
      const res = await authApi.changePassword({
        current_password: current,
        new_password: next,
      })
      setDone(res.message)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.displayMessage : '변경하지 못했습니다',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">비밀번호 변경</h2>
      <p className="mt-1 text-xs text-slate-500">
        변경하면 로그인 중인 모든 기기의 세션이 종료됩니다. 다시 로그인해야 합니다.
      </p>

      {done !== null ? (
        <div className="mt-4">
          <InfoMessage message={done} />
          <p className="mt-2 text-xs text-slate-500">
            잠시 후 로그인 화면으로 이동합니다.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="mt-4 space-y-4 sm:max-w-md"
        >
          <TextField
            label="현재 비밀번호"
            name="current_password"
            type="password"
            value={current}
            onChange={setCurrent}
            required
            disabled={submitting}
            autoComplete="current-password"
          />
          <TextField
            label="새 비밀번호"
            name="new_password"
            type="password"
            value={next}
            onChange={setNext}
            required
            disabled={submitting}
            autoComplete="new-password"
            placeholder={
              policy === null ? undefined : `${policy.min_length}자 이상`
            }
          />
          <TextField
            label="새 비밀번호 확인"
            name="new_password_confirm"
            type="password"
            value={confirm}
            onChange={setConfirm}
            required
            disabled={submitting}
            autoComplete="new-password"
          />
          <ErrorMessage message={error} />
          <button
            type="submit"
            // 정책을 못 받았으면 최소 길이를 알 수 없어 클라이언트 검증이 불가능하다.
            disabled={submitting || policy === null}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {submitting ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>
      )}
    </section>
  )
}
