// Household pings: one-tap pings shown live on every member's Hub and pushed
// to their phones. Insert goes through RLS (household + sender stamped by column
// defaults); the push is a best-effort call to api/send-ping.
import { supabase } from './supabase'
import type { TKey } from './i18n'
import type { Ping, PingAck, PingPreset } from './types'

// Built-in default presets (kind + emoji). Now seeded into the editable
// per-household `ping_presets` table (migration 050) via seed_ping_presets();
// kept here as the reference set. Text is localized (pings.preset.<kind>).
export const PING_PRESETS = [
  { kind: 'help', emoji: '🆘' },
  { kind: 'omw', emoji: '🚗' },
  { kind: 'late', emoji: '⏰' },
  { kind: 'dinner', emoji: '🍽️' },
  { kind: 'grab', emoji: '🛒' },
  { kind: 'love', emoji: '👋' },
] as const

export type ActivePing = Ping & { acks: PingAck[] }

/** Seed the household's default presets if empty, then fetch them (ordered). */
export async function fetchPingPresets(): Promise<PingPreset[]> {
  await supabase.rpc('seed_ping_presets')
  const { data } = await supabase
    .from('ping_presets')
    .select('id, emoji, label, preset_key, high_priority, sort_order')
    .order('sort_order')
  return (data ?? []) as PingPreset[]
}

/** Display text for a preset: the custom label, else the localized default. */
export function presetText(p: PingPreset, t: (key: TKey) => string): string {
  if (p.label && p.label.trim()) return p.label.trim()
  return p.preset_key ? t(`pings.preset.${p.preset_key}` as TKey) : ''
}

export async function createPingPreset(fields: {
  emoji: string
  label: string
  high_priority: boolean
}): Promise<void> {
  const { data } = await supabase
    .from('ping_presets')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextOrder = ((data?.[0]?.sort_order as number | undefined) ?? -1) + 1
  const { error } = await supabase.from('ping_presets').insert({
    emoji: fields.emoji.trim() || '📣',
    label: fields.label.trim(),
    high_priority: fields.high_priority,
    sort_order: nextOrder,
  })
  if (error) throw error
}

export async function updatePingPreset(
  id: string,
  fields: { emoji: string; label: string; high_priority: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('ping_presets')
    .update({
      emoji: fields.emoji.trim() || '📣',
      // Editing sets a custom label, replacing any localized default.
      label: fields.label.trim(),
      preset_key: null,
      high_priority: fields.high_priority,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deletePingPreset(id: string): Promise<void> {
  const { error } = await supabase.from('ping_presets').delete().eq('id', id)
  if (error) throw error
}

/** Persist a new preset order: rewrite sort_order to each id's position. Reindexes
 *  the whole list (0..n-1) so gaps from earlier deletes don't matter. RLS scopes
 *  the writes to the household. */
export async function reorderPingPresets(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, i) => supabase.from('ping_presets').update({ sort_order: i }).eq('id', id)),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

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

/** Record that the current user saw/acknowledged a ping, then best-effort
 *  notify the sender (silent push → their Nudges widget shows "seen by you").
 *  Notify failures are swallowed — the ack itself already landed. */
export async function ackPing(pingId: string): Promise<void> {
  await supabase.from('ping_acks').insert({ ping_id: pingId })
  try {
    const token = await authToken()
    await fetch(`${API_BASE}/api/ack-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ping_id: pingId }),
    })
  } catch {
    // best-effort only
  }
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
