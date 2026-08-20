import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { RoleBadge } from './Badge'

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm ${
      isActive
        ? 'bg-slate-200 font-medium text-slate-900'
        : 'text-slate-600 hover:bg-slate-100'
    }`

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="text-sm font-semibold text-slate-900">
            사내 직원 포털
          </Link>

          <nav className="flex items-center gap-1">
            <NavLink to="/me" className={linkClass}>
              내 정보
            </NavLink>
            {/* 관리자도 employees의 한 행이므로 내 정보에 접근할 수 있다. */}
            {user?.role === 'ADMIN' && (
              <NavLink to="/admin/employees" className={linkClass}>
                직원 관리
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            {user && (
              <>
                <span className="text-slate-600">{user.name}</span>
                <RoleBadge role={user.role} />
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="rounded-md px-3 py-1.5 text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                >
                  로그아웃
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
