// Native client for Google Calendar two-way sync — the RN port of the PWA's
// src/lib/googleCalendar.ts. It reuses the already-deployed Vercel endpoints
// (/api/google-calendar-connect, /api/google-calendar-sync). The connect step
// runs Google OAuth in an in-app browser (mirroring the native Google sign-in)
// asking for the calendar scope with access_type=offline + prompt=consent, so
// Google returns a refresh token; the server persists it (RLS hides it from the
// client). Requires the Google OAuth consent screen to allow the calendar scope
// and the `oneroof://auth-callback` redirect in Supabase (already configured).
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'

import { supabase } from './supabase'

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export interface GoogleConnection {
  user_email: string
  google_email: string | null
  calendar_id: string
  connected_at: string
  last_synced_at: string | null
  last_error: string | null
}

async function authedPost(path: string, body?: unknown): Promise<unknown> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json
}

/** Run the calendar-scope OAuth in an in-app browser, capture Google's refresh
 *  token from the redirect, persist it server-side, then run a first sync.
 *  Returns false if the user cancelled the browser; throws on failure (notably
 *  'no-refresh-token' if Google didn't return one). */
export async function connectGoogleCalendar(): Promise<boolean> {
  const redirectTo = makeRedirectUri({ scheme: 'oneroof', path: 'auth-callback' })
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_CALENDAR_SCOPE,
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error) throw error
  if (!data.url) throw new Error('No OAuth URL returned')

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (result.type !== 'success') return false

  const frag = result.url.includes('#') ? result.url.split('#')[1] : result.url.split('?')[1]
  const params = new URLSearchParams(frag ?? '')
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  const provider_token = params.get('provider_token')
  const provider_refresh_token = params.get('provider_refresh_token')

  // Restore the Supabase session (the re-consent flow rotates it).
  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token })
  }
  if (!provider_token || !provider_refresh_token) {
    // Google only hands back a refresh token on first consent / prompt=consent.
    throw new Error('no-refresh-token')
  }

  const { data: userData } = await supabase.auth.getUser()
  await authedPost('/api/google-calendar-connect', {
    access_token: provider_token,
    refresh_token: provider_refresh_token,
    google_email: userData.user?.email,
  })
  await syncGoogleCalendar().catch(() => {})
  return true
}

export async function syncGoogleCalendar(): Promise<unknown> {
  return authedPost('/api/google-calendar-sync')
}

export async function getGoogleConnection(): Promise<GoogleConnection | null> {
  const { data } = await supabase
    .from('google_calendar_connections')
    .select('user_email, google_email, calendar_id, connected_at, last_synced_at, last_error')
    .maybeSingle()
  return (data as GoogleConnection) ?? null
}

export async function disconnectGoogleCalendar(): Promise<void> {
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email
  if (!email) return
  // Drop this member's imported Google events, then the connection itself.
  await supabase.from('calendar_events').delete().eq('source', 'google').eq('owner_email', email)
  await supabase.from('google_calendar_connections').delete().eq('user_email', email)
}
