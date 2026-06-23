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
 *  Push failures are swallowed — the signal is already saved and shows up live
 *  via Realtime regardless. */
export async function sendSignal(
  kind: string,
  emoji: string,
  message: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('signals')
    .insert({ kind, emoji, message })
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

/** AI: map free text → {kind, emoji, message} in the user's language, then send.
 *  Returns what was sent so the UI can show a brief confirmation. */
export async function sendCustomSignal(
  text: string,
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
  await sendSignal(kind, emoji, message)
  return { emoji, message }
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
