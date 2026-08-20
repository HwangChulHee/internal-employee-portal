import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthProvider'
import { Layout } from './components/Layout'
import { RequireAdmin, RequireAuth } from './components/Guards'
import { useAuth } from './hooks/useAuth'
import { EmployeeDetailPage } from './pages/EmployeeDetailPage'
import { EmployeeListPage } from './pages/EmployeeListPage'
import { EmployeeNewPage } from './pages/EmployeeNewPage'
import { LoginPage } from './pages/LoginPage'
import { MePage } from './pages/MePage'
import { FullPageSpinner } from './components/Spinner'
import { landingPathFor } from './routes'

/** 루트는 역할에 따라 갈린다. */
function LandingRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={landingPathFor(user.role)} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<LandingRedirect />} />
            <Route path="/me" element={<MePage />} />
            <Route
              path="/admin/employees"
              element={
                <RequireAdmin>
                  <EmployeeListPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/employees/new"
              element={
                <RequireAdmin>
                  <EmployeeNewPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/employees/:employeeId"
              element={
                <RequireAdmin>
                  <EmployeeDetailPage />
                </RequireAdmin>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
