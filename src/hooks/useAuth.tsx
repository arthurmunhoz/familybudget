import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { handleConnectRedirect } from '../lib/googleCalendar'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  /** The signed-in user's profile, null if signed in but not in allowed_users */
  profile: Profile | null
  /** Both household members, for name lookups and person filters */
  profiles: Profile[]
  loading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfiles([])
        setLoading(false)
      } else {
        // Returning from a "Connect Google Calendar" consent? This session
        // carries the one-time provider refresh token — capture it now.
        void handleConnectRedirect(s)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    supabase
      .from('allowed_users')
      .select('email, display_name, household_id, is_admin')
      .then(({ data }) => {
        if (cancelled) return
        setProfiles(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const self =
    profiles.find((p) => p.email === session?.user.email) ?? null
  // Admins can read every household's users (for the Admin page), but person
  // filters and name lookups should only ever show the user's own household.
  const householdProfiles = self
    ? profiles.filter((p) => p.household_id === self.household_id)
    : []

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile: self,
        profiles: householdProfiles,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
