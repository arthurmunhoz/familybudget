// Modo Casa from the phone (migration 105): pair a home device (the code its
// screen shows — or its QR, which opens oneroof://casa?code=…), see and unpair
// the family's devices, set the Money PIN. The device itself is the web app.
import { supabase } from '@/lib/supabase'
import { sha256Hex } from '@/lib/sha256'
import { loadHomeLocation } from '@/lib/weather'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''
export const CASA_URL = 'one-roof-app.vercel.app'

export interface HomeDevice {
  id: string
  name: string
  paired_by: string
  created_at: string
  last_seen_at: string | null
}

export interface HomePlan {
  plus: boolean
  trial_ends: string | null
  full: boolean
}

/** The family's paired devices (unpaired ones hidden). [] on a server without 105. */
export async function fetchHomeDevices(): Promise<HomeDevice[]> {
  const { data, error } = await supabase
    .from('home_devices')
    .select('id, name, paired_by, created_at, last_seen_at')
    .is('revoked_at', null)
    .order('created_at')
  if (error) return []
  return (data ?? []) as HomeDevice[]
}

export async function fetchHomePlan(): Promise<HomePlan | null> {
  const { data, error } = await supabase.rpc('home_plan')
  if (error || !data) return null
  return data as HomePlan
}

/** Is a Money PIN set for the active family? */
export async function hasCasaPin(): Promise<boolean> {
  const { data } = await supabase.from('home_settings').select('pin_hash').maybeSingle()
  return !!(data as { pin_hash?: string | null } | null)?.pin_hash
}

export type ClaimError = 'invalid_code' | 'already_claimed' | 'plus_required' | 'device_limit' | 'no_household' | 'generic'

/** Pair the device showing `code`, named `name` ("Cozinha"). */
export async function claimHomeDevice(code: string, name: string): Promise<{ ok: true } | { ok: false; error: ClaimError }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token || !API_BASE) return { ok: false, error: 'generic' }
  try {
    const res = await fetch(`${API_BASE}/api/widget?action=casa-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: normalizeCode(code), name: name.trim(), home_loc: await loadHomeLocation().catch(() => null) }),
    })
    if (res.ok) return { ok: true }
    const j = (await res.json().catch(() => null)) as { error?: string } | null
    const e = j?.error as ClaimError | undefined
    return { ok: false, error: e && ['invalid_code', 'already_claimed', 'plus_required', 'device_limit', 'no_household'].includes(e) ? e : 'generic' }
  } catch {
    return { ok: false, error: 'generic' }
  }
}

/** Unpair: the device notices and signs itself out. */
export async function revokeHomeDevice(id: string): Promise<boolean> {
  const { error } = await supabase.from('home_devices').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  return !error
}

/** Store the Money PIN as sha256("<household>:<pin>") — the device compares the same. */
export async function setCasaPin(household: string, pin: string): Promise<boolean> {
  const { error } = await supabase
    .from('home_settings')
    .upsert({ household_id: household, pin_hash: sha256Hex(`${household}:${pin}`), updated_at: new Date().toISOString() })
  return !error
}

/** "k7p 4qx" / "K7P·4QX" → "K7P4QX". */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

/** Whole days left in the trial (0 = ends today), or null when not in one. */
export function trialDaysLeft(plan: HomePlan | null, now = new Date()): number | null {
  if (!plan || plan.plus || !plan.trial_ends) return null
  const ms = new Date(plan.trial_ends).getTime() - now.getTime()
  return ms > 0 ? Math.ceil(ms / 86400000) : null
}
