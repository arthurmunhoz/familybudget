import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { isConfigured } from './lib/supabase'
import Login from './pages/Login'
import Months from './pages/Months'
import MonthDetail from './pages/MonthDetail'

export default function App() {
  const { session, profile, loading, signOut } = useAuth()

  if (!isConfigured) {
    return (
      <Centered>
        <h1 className="text-xl font-bold text-stone-100">Almost there</h1>
        <p className="mt-2 text-stone-400">
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
        <p className="animate-pulse text-stone-400">Loading…</p>
      </Centered>
    )
  }

  if (!session) return <Login />

  if (!profile) {
    return (
      <Centered>
        <h1 className="text-xl font-bold text-stone-100">Not authorized</h1>
        <p className="mt-2 text-stone-400">
          {session.user.email} is not in the allowed users list. Add it to the{' '}
          <code>allowed_users</code> table in Supabase.
        </p>
        <button
          onClick={signOut}
          className="mt-6 rounded-xl bg-stone-800 px-5 py-3 font-medium text-stone-200"
        >
          Sign out
        </button>
      </Centered>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Months />} />
      <Route path="/month/:id" element={<MonthDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  )
}
