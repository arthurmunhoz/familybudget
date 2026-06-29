/**
 * Client side of Google Calendar sync. The flow:
 *  1. connectGoogleCalendar() re-runs Google OAuth asking for the calendar
 *     scope (access_type=offline + prompt=consent so we get a refresh token),
 *     redirecting back to /calendar.
 *  2. On return, useAuth catches the SIGNED_IN event and calls
 *     handleConnectRedirect(session), which ships the captured tokens to the
 *     server (the client itself can't persist them — RLS denies it) and kicks
 *     off a first sync.
 *  3. syncGoogleCalendar() / disconnectGoogleCalendar() drive the rest.
 */
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const CONNECTING_FLAG = 'gcal-connecting'

export interface GoogleConnection {
  user_email: string
  google_email: string | null
  calendar_id: string
  connected_at: string
  last_synced_at: string | null
  last_error: string | null
}

export function isConnecting(): boolean {
  return localStorage.getItem(CONNECTING_FLAG) === '1'
}

/** Re-consent with the calendar scope. Full-page redirect back to /calendar. */
export async function connectGoogleCalendar(): Promise<void> {
  localStorage.setItem(CONNECTING_FLAG, '1')
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_CALENDAR_SCOPE,
      redirectTo: `${window.location.origin}/calendar`,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
}

async function authedPost(path: string, body?: unknown): Promise<any> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json
}

/** Run once on the post-consent redirect: persist tokens server-side + sync.
 *  No-op unless we're mid-connect and the session carries provider tokens. */
export async function handleConnectRedirect(session: Session): Promise<boolean> {
  if (!isConnecting()) return false
  localStorage.removeItem(CONNECTING_FLAG)
  const access_token = session.provider_token
  const refresh_token = session.provider_refresh_token
  if (!access_token || !refresh_token) {
    window.dispatchEvent(new CustomEvent('gcal-error', { detail: 'no-refresh-token' }))
    return false
  }
  try {
    await authedPost('/api/google-calendar-connect', {
      access_token,
      refresh_token,
      google_email: session.user?.email,
    })
    await syncGoogleCalendar().catch(() => {})
    window.dispatchEvent(new Event('gcal-changed'))
    return true
  } catch (e) {
    window.dispatchEvent(new CustomEvent('gcal-error', { detail: String(e) }))
    return false
  }
}

export async function syncGoogleCalendar(): Promise<any> {
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
  window.dispatchEvent(new Event('gcal-changed'))
}
