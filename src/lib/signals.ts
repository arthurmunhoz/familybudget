// Household signals: one-tap pings shown live on every member's Hub and pushed
// to their phones. Insert goes through RLS (household + sender stamped by column
// defaults); the push is a best-effort call to api/send-signal.
import { supabase } from './supabase'
import type { Signal, SignalAck } from './types'

// Preset signals. `emoji` is stored on the row; the human text is localized at
// send time (i18n key `signals.preset.<kind>`) so the banner/push read nicely.
export const SIGNAL_PRESETS = [
  { kind: 'help', emoji: '🆘' },
  { kind: 'omw', emoji: '🚗' },
  { kind: 'late', emoji: '⏰' },
  { kind: 'dinner', emoji: '🍽️' },
  { kind: 'grab', emoji: '🛒' },
  { kind: 'love', emoji: '👋' },
] as const

export type SignalPreset = (typeof SIGNAL_PRESETS)[number]
export type ActiveSignal = Signal & { acks: SignalAck[] }

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

/** Insert a signal (RLS stamps household + sender) then fire the household push.
 *  `recipients` null = whole household; otherwise only those member emails.
 *  Push failures are swallowed — the signal is already saved and shows up live
 *  via Realtime regardless. */
export async function sendSignal(
  kind: string,
  emoji: string,
  message: string,
  recipients: string[] | null = null,
): Promise<void> {
  const { data, error } = await supabase
    .from('signals')
    .insert({ kind, emoji, message, recipients })
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Could not send signal')
  try {
    const token = await authToken()
    await fetch('/api/send-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signal_id: data.id }),
    })
  } catch {
    // best-effort push only
  }
}

/** AI: map free text → {kind, emoji, message} in the user's language, then send
 *  to `recipients` (null = whole household). Returns what was sent so the UI can
 *  show a brief confirmation. */
export async function sendCustomSignal(
  text: string,
  recipients: string[] | null = null,
): Promise<{ emoji: string; message: string }> {
  const token = await authToken()
  const res = await fetch('/api/suggest-signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error ?? 'AI mapping failed')
  const emoji = (result.emoji || '📣').trim()
  const message = (result.message || text).trim()
  const kind = result.kind || 'custom'
  await sendSignal(kind, emoji, message, recipients)
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

/** Record that the current user saw/acknowledged a signal. */
export async function ackSignal(signalId: string): Promise<void> {
  await supabase.from('signal_acks').insert({ signal_id: signalId })
}

/** Active (non-expired) signals for the household, newest first, each with its
 *  acks attached for the "seen by" count. */
export async function fetchActiveSignals(): Promise<ActiveSignal[]> {
  const nowISO = new Date().toISOString()
  const { data: sigs } = await supabase
    .from('signals')
    .select('*')
    .gt('expires_at', nowISO)
    .order('created_at', { ascending: false })
  const signals = (sigs ?? []) as Signal[]
  if (!signals.length) return []
  const { data: acks } = await supabase
    .from('signal_acks')
    .select('*')
    .in(
      'signal_id',
      signals.map((s) => s.id),
    )
  const ackList = (acks ?? []) as SignalAck[]
  return signals.map((s) => ({
    ...s,
    acks: ackList.filter((a) => a.signal_id === s.id),
  }))
}
