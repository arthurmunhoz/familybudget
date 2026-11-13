import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AnalyticsTracker from './components/AnalyticsTracker'
import ErrorBoundary from './components/ErrorBoundary'
import { useAuth } from './hooks/useAuth'
import { isConfigured } from './lib/supabase'
import Login from './pages/Login'

// The web app is ONLY Modo Casa now (owner, 2026-11 — see src/casa/). The old
// screens' files stay in the repo but are unreachable; /admin keeps working for
// the global admin (Google sign-in, as before).
const ModoCasa = lazy(() => import('./casa/ModoCasa'))
const Admin = lazy(() => import('./pages/Admin'))
const AdminHousehold = lazy(() => import('./pages/AdminHousehold'))

export default function App() {
  const { session, profile, loading, profileLoaded } = useAuth()
  const location = useLocation()

  if (!isConfigured) {
    return (
      <Centered>
        <h1 className="text-xl font-bold text-(--text)">Almost there</h1>
        <p className="mt-2 text-(--text-muted)">
          Missing Supabase config. Copy <code>.env.example</code> to{' '}
          <code>.env.local</code> and fill in your project URL and anon key,
          then restart the dev server.
        </p>
      </Centered>
    )
  }

  const isAdminPath = location.pathname.startsWith('/admin')
  const fallback = (
    <Centered>
      <p className="animate-pulse text-(--text-muted)">Loading…</p>
    </Centered>
  )

  if (!isAdminPath) {
    return (
      <ErrorBoundary>
        <Suspense fallback={null}>
          <ModoCasa />
        </Suspense>
      </ErrorBoundary>
    )
  }

  if (loading) return fallback
  if (!session) return <Login />
  if (!profileLoaded) return fallback
  if (!profile?.is_admin) return <Navigate to="/" replace />

  return (
    <ErrorBoundary>
      <Suspense fallback={fallback}>
        <AnalyticsTracker />
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/household/:id" element={<AdminHousehold />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  )
}
