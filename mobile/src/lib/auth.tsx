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
import { AppState, Platform } from 'react-native'
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

/** How long the launch screen will wait for the stored session before giving
 *  up and rendering. Long enough that a healthy-but-slow Keychain read still
 *  wins the race (so nobody sees Login flash), short enough that a wedged one
 *  doesn't look like a crash. See the effect in AuthProvider. */
const SESSION_READ_DEADLINE_MS = 8000

/** Backoff for the profile lookup. Retrying rather than resolving to "no
 *  household" matters because the latter would send a signed-in member to
 *  Onboarding and invite them to create a SECOND one.
 *
 *  The last value REPEATS FOREVER. Giving up after a few tries left
 *  `profileLoaded` false, and the root route renders BrandSplash for as long as
 *  that is false — so abandoning the retry stranded the user on the launch
 *  spinner with no way out but force-quitting. That is the "stuck at login,
 *  sometimes" report: it needed only a few seconds of bad connectivity right
 *  after sign-in, which is exactly when this runs. */
const PROFILE_RETRY_MS = [700, 2000, 5000, 10_000]

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
    const done = () => {
      if (active) setLoading(false)
    }
    // `loading` gates the whole app behind BrandSplash, so this promise must
    // ALWAYS resolve it — it previously had neither a catch nor a deadline, and
    // one stuck session read left the app spinning on its launch screen until it
    // was force-quit (reported on Android, first launch after installing).
    // Bailing out early is safe: `onAuthStateChange` below fires INITIAL_SESSION
    // with whatever the read eventually finds, so a slow-but-alive read still
    // lands the user in the Hub instead of on Login.
    const bail = setTimeout(done, SESSION_READ_DEADLINE_MS)
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
      })
      .catch(() => {
        /* treated as "no session" — the user can sign in again */
      })
      .finally(() => {
        clearTimeout(bail)
        done()
      })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      done()
    })
    return () => {
      active = false
      clearTimeout(bail)
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
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Retried, not caught-and-cleared: this query is what decides Hub vs
    // Onboarding, and a network blip resolving to `null` would tell a member
    // with a household that they haven't got one. Only a real answer from the
    // server — row or no row — is allowed to set `profileLoaded`.
    const attempt = async (n: number) => {
      if (!active || settled) return
      try {
        const { data, error } = await supabase
          .from('allowed_users')
          .select('email, display_name, household_id, is_admin, role')
          .eq('email', email)
          .maybeSingle()
        if (!active) return
        if (error) throw error
        settled = true
        setProfile((data as Profile) ?? null)
        setProfileLoaded(true)
      } catch {
        if (!active) return
        // Never runs off the end of the list — the last delay repeats, so this
        // keeps trying and heals itself when the connection comes back.
        const wait = PROFILE_RETRY_MS[Math.min(n, PROFILE_RETRY_MS.length - 1)]
        timer = setTimeout(() => void attempt(n + 1), wait)
      }
    }
    void attempt(0)

    // Reopening the app is what people do when a screen looks stuck, so make it
    // work instead of making them wait out the backoff.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || settled) return
      if (timer) clearTimeout(timer)
      void attempt(0)
    })

    return () => {
      active = false
      if (timer) clearTimeout(timer)
      sub.remove()
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
    // scope:'local' — supabase-js defaults to 'global', which revokes EVERY
    // session this user has on EVERY device. That silently half-breaks the
    // other phones: the JWT still passes PostgREST (signature + exp are checked
    // locally, so writes keep working) but every server-side call that
    // validates against /auth/v1/user starts returning 401. Nudges saved and
    // never pushed. Signing out here must only sign out THIS device.
    await supabase.auth.signOut({ scope: 'local' })
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
