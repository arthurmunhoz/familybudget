// Auth + profile context — the RN equivalent of the PWA's useAuth. Exposes the
// Supabase session, the signed-in user's profile (household, admin), and the
// sign-in methods: Sign in with Apple (Apple-required), Google OAuth, and a
// dev email/password login (DEV builds only).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'
import { clearCache } from '@/hooks/useCachedQuery'
import type { Profile } from './types'

WebBrowser.maybeCompleteAuthSession()

const DEV_EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL ?? ''
const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? ''

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** All members of the signed-in user's household (RLS-scoped). */
  profiles: Profile[]
  loading: boolean
  /** True once the profile lookup has resolved for the current session. A signed-in
   *  user with `profileLoaded && !profile` has no household yet → show onboarding. */
  profileLoaded: boolean
  /** Re-fetch the caller's profile (call after create/join household onboarding). */
  refreshProfile: () => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  devSignIn: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Load the profile (household, admin, role) whenever the signed-in email changes.
  const email = session?.user.email ?? null

  // Manual re-fetch — called after create/join onboarding so the app re-renders
  // from the Onboarding gate into the Hub without a full reload.
  const refreshProfile = useCallback(async () => {
    if (!email) {
      setProfile(null)
      setProfileLoaded(true)
      return
    }
    const { data } = await supabase
      .from('allowed_users')
      .select('email, display_name, household_id, is_admin, role')
      .eq('email', email)
      .maybeSingle()
    setProfile((data as Profile) ?? null)
    setProfileLoaded(true)
  }, [email])

  useEffect(() => {
    setProfileLoaded(false)
    if (!email) {
      setProfile(null)
      setProfileLoaded(true)
      return
    }
    let active = true
    supabase
      .from('allowed_users')
      .select('email, display_name, household_id, is_admin, role')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setProfile((data as Profile) ?? null)
          setProfileLoaded(true)
        }
      })
    return () => {
      active = false
    }
  }, [email])

  // Load all household members once we know the household.
  const householdId = profile?.household_id ?? null
  useEffect(() => {
    if (!householdId) {
      setProfiles([])
      return
    }
    let active = true
    supabase
      .from('allowed_users')
      .select('email, display_name, household_id, is_admin, role')
      .eq('household_id', householdId)
      .then(({ data }) => {
        if (active) setProfiles((data as Profile[]) ?? [])
      })
    return () => {
      active = false
    }
  }, [householdId])

  const signInWithApple = useCallback(async () => {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
    if (!credential.identityToken) throw new Error('Apple sign-in returned no identity token')
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    })
    if (error) throw error
    // Send the one-time authorization code to the server so it can capture the
    // Apple refresh token (needed to revoke it on account deletion). Best-effort:
    // never blocks sign-in, and is a no-op until the Apple env vars are set.
    const code = credential.authorizationCode
    const apiBase = process.env.EXPO_PUBLIC_API_BASE
    if (code && apiBase) {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const accessToken = sess.session?.access_token
        if (accessToken) {
          await fetch(`${apiBase}/api/apple-connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ code }),
          })
        }
      } catch {
        /* best-effort */
      }
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = makeRedirectUri({ scheme: 'oneroof', path: 'auth-callback' })
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error('No OAuth URL returned')
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
    if (result.type !== 'success') return
    // Supabase returns tokens in the URL fragment (#) or query (?).
    const frag = result.url.includes('#') ? result.url.split('#')[1] : result.url.split('?')[1]
    const params = new URLSearchParams(frag ?? '')
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token })
    }
  }, [])

  const devSignIn = useCallback(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    clearCache()
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, profile, profiles, loading, profileLoaded, refreshProfile, signInWithApple, signInWithGoogle, devSignIn, signOut }}
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

/** Sign in with Apple is iOS-only and requires a real device/simulator with an
 *  Apple ID. Use to gate the Apple button on other platforms. */
export const appleAuthSupported = Platform.OS === 'ios'
