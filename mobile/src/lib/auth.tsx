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
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'
import { completeOAuthRedirect } from './oauthRedirect'
import { disablePush } from './notifications'
import { clearWidgetData } from './widget'
import { clearCache } from '@/hooks/useCachedQuery'
import type { Profile } from './types'

/** Where signInWithApple parks the name Apple gives us exactly once, for
 *  Onboarding to prefill. See the comment in signInWithApple. */
const PENDING_NAME_KEY = 'pending-display-name'

/** Read-and-clear the name captured during Apple sign-in ('' if none). */
export async function takePendingDisplayName(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(PENDING_NAME_KEY)
    if (v) await AsyncStorage.removeItem(PENDING_NAME_KEY)
    return v ?? ''
  } catch {
    return ''
  }
}

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
  // from the Onboarding gate into the Hub without a full reload, and after a
  // rename (set_display_name). It refreshes the MEMBERS list too: that list is
  // otherwise only loaded when household_id changes, so renaming yourself would
  // leave every screen reading `profiles` (Family, Nudges) showing the old name.
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
    const next = (data as Profile) ?? null
    setProfile(next)
    setProfileLoaded(true)
    if (next?.household_id) {
      const { data: members } = await supabase
        .from('allowed_users')
        .select('email, display_name, household_id, is_admin, role')
        .eq('household_id', next.household_id)
      setProfiles((members as Profile[]) ?? [])
    }
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

    // Apple hands over the user's name ONLY on the very first authorization for
    // this app — never again, and never inside the identity token. So grab it
    // here or lose it: the JWT has no `name` claim, which is why
    // jwt_display_name() (migration 051) falls back to the email local-part and
    // "Hide My Email" users end up named e.g. "z5khzgh5ff". Stash it for
    // Onboarding to prefill; see PENDING_NAME_KEY.
    const parts = [credential.fullName?.givenName, credential.fullName?.familyName]
    const appleName = parts.filter(Boolean).join(' ').trim()
    if (appleName) {
      try {
        await AsyncStorage.setItem(PENDING_NAME_KEY, appleName)
      } catch {
        /* best effort — onboarding just starts blank */
      }
    }

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
    // PKCE hands back `?code=`, which completeOAuthRedirect exchanges for the
    // session (it still understands the legacy fragment tokens too).
    await completeOAuthRedirect(result.url)
  }, [])

  const devSignIn = useCallback(async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    })
    return { error: error?.message ?? null }
  }, [])

  // Signing out has to strip this DEVICE of everything that still authorizes it
  // for the household, not just end the session. Left behind, each of these
  // keeps working for whoever holds the phone next:
  //   • the widget token — a non-expiring bearer credential the home-screen
  //     widgets use to send nudges and read the agenda/pets/budgets;
  //   • the App Group mirror — member names, presets, budgets, today's agenda;
  //   • the Expo push registration — nudge text and digests keep arriving.
  // All three are best-effort and run BEFORE signOut(), while the JWT still
  // authorizes the server-side deletes. A failure must never block sign-out.
  const signOut = useCallback(async () => {
    try {
      await supabase.rpc('revoke_widget_token')
    } catch {
      /* best effort — the local token is cleared below regardless */
    }
    try {
      await disablePush()
    } catch {
      /* best effort */
    }
    clearWidgetData()
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
