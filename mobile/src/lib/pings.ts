// Household pings: one-tap pings shown live on every member's Hub and pushed
// to their phones. Insert goes through RLS (household + sender stamped by column
// defaults); the push is a best-effort call to api/send-ping.
import { supabase } from './supabase'
import type { Ping, PingAck } from './types'

// Preset pings. `emoji` is stored on the row; the human text is localized at
// send time (i18n key `pings.preset.<kind>`) so the banner/push read nicely.
export const PING_PRESETS = [
  { kind: 'help', emoji: '🆘' },
  { kind: 'omw', emoji: '🚗' },
  { kind: 'late', emoji: '⏰' },
  { kind: 'dinner', emoji: '🍽️' },
  { kind: 'grab', emoji: '🛒' },
  { kind: 'love', emoji: '👋' },
] as const

export type PingPreset = (typeof PING_PRESETS)[number]
export type ActivePing = Ping & { acks: PingAck[] }

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

/** Insert a ping (RLS stamps household + sender) then fire the household push.
 *  `recipients` null = whole household; otherwise only those member emails.
 *  Push failures are swallowed — the ping is already saved and shows up live
 *  via Realtime regardless. */
export async function sendPing(
  kind: string,
  emoji: string,
  message: string,
  recipients: string[] | null = null,
): Promise<void> {
  const { data, error } = await supabase
    .from('pings')
    .insert({ kind, emoji, message, recipients })
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Could not send ping')
  try {
    const token = await authToken()
    await fetch('/api/send-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ping_id: data.id }),
    })
  } catch {
    // best-effort push only
  }
}

/** AI: map free text → {kind, emoji, message} in the user's language, then send
 *  to `recipients` (null = whole household). Returns what was sent so the UI can
 *  show a brief confirmation. */
export async function sendCustomPing(
  text: string,
  recipients: string[] | null = null,
): Promise<{ emoji: string; message: string }> {
  const token = await authToken()
  const res = await fetch('/api/suggest-ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error ?? 'AI mapping failed')
  const emoji = (result.emoji || '📣').trim()
  const message = (result.message || text).trim()
  const kind = result.kind || 'custom'
  await sendPing(kind, emoji, message, recipients)
  return { emoji, message }
}

/** Phone numbers of household members, keyed by email, for the in-app "Call"
 *  button. Members without a saved phone are omitted. */
export async function fetchMemberPhones(): Promise<Record<string, string>> {
  const { data } = await supabase.from('member_profiles').select('email, phone')
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; phone: string | null }[]) {
    if (r.phone) out[r.email] = r.phone
  }
  return out
}

/** Record that the current user saw/acknowledged a ping. */
export async function ackPing(pingId: string): Promise<void> {
  await supabase.from('ping_acks').insert({ ping_id: pingId })
}

/** Active (non-expired) pings for the household, newest first, each with its
 *  acks attached for the "seen by" count. */
export async function fetchActivePings(): Promise<ActivePing[]> {
  const nowISO = new Date().toISOString()
  const { data: sigs } = await supabase
    .from('pings')
    .select('*')
    .gt('expires_at', nowISO)
    .order('created_at', { ascending: false })
  const pings = (sigs ?? []) as Ping[]
  if (!pings.length) return []
  const { data: acks } = await supabase
    .from('ping_acks')
    .select('*')
    .in(
      'ping_id',
      pings.map((s) => s.id),
    )
  const ackList = (acks ?? []) as PingAck[]
  return pings.map((s) => ({
    ...s,
    acks: ackList.filter((a) => a.ping_id === s.id),
  }))
}
