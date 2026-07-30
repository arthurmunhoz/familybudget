import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { handleConnectRedirect } from '../lib/googleCalendar'
import type { Profile } from '../lib/types'

/** Columns every profile lookup needs. `role` is the household-scoped
 *  owner/member role from migration 051 — distinct from the global `is_admin`. */
const PROFILE_COLS = 'email, display_name, household_id, is_admin, role'

interface AuthState {
  session: Session | null
  /** The signed-in user's profile, null if signed in but not in allowed_users */
  profile: Profile | null
  /** Both household members, for name lookups and person filters */
  profiles: Profile[]
  loading: boolean
  /** True once the profile lookup has resolved for the CURRENT session. A
   *  signed-in user with `profileLoaded && !profile` has no household yet →
   *  show onboarding. Without this flag the previous session's (empty) profile
   *  list would briefly read as "no household" right after sign-in. */
  profileLoaded: boolean
  /** Re-read the profiles. Call after create/join household onboarding, or after
   *  a rename (set_display_name) — the members list carries display names that
   *  Family and Nudges read, so it has to be refreshed too. */
  refreshProfile: () => Promise<void>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  // The email the loaded `profiles` belong to. `profileLoaded` is DERIVED from
  // it rather than being its own flag reset inside the effect: on sign-in the
  // session changes before the new lookup resolves, and a stale "loaded" would
  // read as "signed in with no household" and flash the onboarding screen.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

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

  const email = session?.user.email ?? null

  const refreshProfile = useCallback(async () => {
    if (!email) {
      setProfiles([])
      return
    }
    const { data } = await supabase.from('allowed_users').select(PROFILE_COLS)
    setProfiles((data as Profile[] | null) ?? [])
    setLoadedFor(email)
    setLoading(false)
  }, [email])

  useEffect(() => {
    if (!email) return
    let cancelled = false
    supabase
      .from('allowed_users')
      .select(PROFILE_COLS)
      .then(({ data }) => {
        if (cancelled) return
        setProfiles((data as Profile[] | null) ?? [])
        setLoadedFor(email)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [email])

  // Signed out counts as resolved; signed in only once the lookup for THIS
  // email has landed.
  const profileLoaded = email === null || loadedFor === email
  const self = profiles.find((p) => p.email === email) ?? null
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
        profileLoaded,
        refreshProfile,
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
