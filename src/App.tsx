import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AnalyticsTracker from './components/AnalyticsTracker'
import ErrorBoundary from './components/ErrorBoundary'
import VaultGate from './components/VaultGate'
import { useAuth } from './hooks/useAuth'
import { isConfigured } from './lib/supabase'
import Login from './pages/Login'
import Hub from './pages/Hub'

// Hub apps are lazy-loaded so the bundle stays light as the family adds more.
const Budgets = lazy(() => import('./apps/budget/Budgets'))
const Months = lazy(() => import('./apps/budget/Months'))
const MonthDetail = lazy(() => import('./apps/budget/MonthDetail'))
const ShoppingList = lazy(() => import('./apps/shopping/ShoppingList'))
const Pings = lazy(() => import('./apps/pings/Pings'))
const PetCare = lazy(() => import('./apps/pets/PetCare'))
const PetProfile = lazy(() => import('./apps/pets/PetProfile'))
const DocumentVault = lazy(() => import('./apps/docs/DocumentVault'))
const ImportantDates = lazy(() => import('./apps/dates/ImportantDates'))
const Family = lazy(() => import('./apps/family/Family'))
const Calculator = lazy(() => import('./apps/calc/Calculator'))
const Admin = lazy(() => import('./pages/Admin'))
const AdminHousehold = lazy(() => import('./pages/AdminHousehold'))

export default function App() {
  const { session, profile, loading, signOut } = useAuth()

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

  if (loading) {
    return (
      <Centered>
        <p className="animate-pulse text-(--text-muted)">Loading…</p>
      </Centered>
    )
  }

  if (!session) return <Login />

  if (!profile) {
    return (
      <Centered>
        <h1 className="text-xl font-bold text-(--text)">Not authorized</h1>
        <p className="mt-2 text-(--text-muted)">
          {session.user.email} is not in the allowed users list. Add it to the{' '}
          <code>allowed_users</code> table in Supabase.
        </p>
        <button
          onClick={signOut}
          className="mt-6 rounded-xl bg-(--surface) px-5 py-3 font-medium text-(--text)"
        >
          Sign out
        </button>
      </Centered>
    )
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <Centered>
            <p className="animate-pulse text-(--text-muted)">Loading…</p>
          </Centered>
        }
      >
        <AnalyticsTracker />
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/budget" element={<Budgets />} />
          <Route path="/budget/:budgetId" element={<Months />} />
          <Route path="/month/:id" element={<MonthDetail />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/pings" element={<Pings />} />
          <Route path="/pets" element={<PetCare />} />
          <Route path="/pets/:petId" element={<PetProfile />} />
          <Route
            path="/docs"
            element={
              <VaultGate>
                <DocumentVault />
              </VaultGate>
            }
          />
          <Route path="/dates" element={<ImportantDates />} />
          <Route path="/family" element={<Family />} />
          <Route path="/calc" element={<Calculator />} />
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
