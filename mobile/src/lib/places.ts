// Places & geofences (migration 067) — data layer for Whereabouts Phase 2.
//
// Places are shared household furniture: any member can add/edit/remove them.
// Crossing one is recorded by the CROSSING member's own device (RLS only lets
// you record your own crossings), which drives the activity feed live via
// Realtime and pushes "Emma arrived at School" to the rest of the household via
// api/send-ping (?action=place-event).
import { supabase } from './supabase'
import { haversineMeters, type LatLng } from './location'
import type { Place, PlaceEvent, PlaceWatch } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

async function authToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ''
}

async function myEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

export interface PlaceInput {
  name: string
  icon: string
  lat: number
  lng: number
  radius_m: number
}

/** Raised by the DB when a free household already has its one place
 *  (migration 072) — the caller shows the paywall. */
export const PLACE_LIMIT_ERROR = 'free_plan_place_limit'

/** The saved place a point sits inside, if any. Smallest radius wins when they
 *  overlap, so "Home" inside a wider "Neighborhood" still reads as Home. */
export function placeAt(places: Place[], point: LatLng): Place | null {
  let best: Place | null = null
  for (const p of places) {
    if (haversineMeters({ lat: p.lat, lng: p.lng }, point) <= p.radius_m) {
      if (!best || p.radius_m < best.radius_m) best = p
    }
  }
  return best
}

/** The household's saved places (RLS scopes to our household). */
export async function fetchPlaces(): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select('*').order('created_at')
  if (error) throw error
  return (data ?? []) as Place[]
}

/** Returns the new place's id so the caller can attach their own watch to it. */
export async function createPlace(input: PlaceInput): Promise<string | null> {
  const { data, error } = await supabase.from('places').insert(input).select('id').single()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}

export async function updatePlace(id: string, input: Partial<PlaceInput>): Promise<void> {
  const { error } = await supabase.from('places').update(input).eq('id', id)
  if (error) throw error
}

export async function deletePlace(id: string): Promise<void> {
  const { error } = await supabase.from('places').delete().eq('id', id)
  if (error) throw error
}

/** Recent household arrivals/departures, newest first (the Activity feed). */
export async function fetchPlaceEvents(limit = 40): Promise<PlaceEvent[]> {
  const { data } = await supabase
    .from('place_events')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  return (data ?? []) as PlaceEvent[]
}

// ── Per-user watching (migration 070) ───────────────────────────────────────
// Creating or sharing a place subscribes NOBODY. Each member opts in per place
// and picks whose crossings they want to hear about.

/** My watch rows keyed by place_id (RLS returns only mine). */
export async function fetchMyPlaceWatches(): Promise<Record<string, PlaceWatch>> {
  const { data } = await supabase.from('place_watchers').select('*')
  const out: Record<string, PlaceWatch> = {}
  for (const w of (data ?? []) as PlaceWatch[]) out[w.place_id] = w
  return out
}

/** Start (or update) watching a place. `watched` empty = everyone. */
export async function upsertPlaceWatch(
  placeId: string,
  opts: { watched: string[]; notify_arrivals: boolean; notify_departures: boolean },
): Promise<void> {
  const me = await myEmail()
  if (!me) return
  const { error } = await supabase
    .from('place_watchers')
    .upsert({ place_id: placeId, user_email: me, ...opts }, { onConflict: 'place_id,user_email' })
  if (error) throw error
}

/** Stop watching a place — no more alerts for me (others are unaffected). */
export async function removePlaceWatch(placeId: string): Promise<void> {
  const me = await myEmail()
  if (!me) return
  await supabase.from('place_watchers').delete().eq('place_id', placeId).eq('user_email', me)
}

/** Record MY crossing of a place, then best-effort push it to the household.
 *
 *  The decision of whether this IS a crossing belongs to the database, not here
 *  (migration 071): `record_place_event` compares against the last event for
 *  this person+place and returns null unless the state actually changed. That
 *  matters because the OS re-announces every region you're standing in each time
 *  geofencing restarts — the client can't tell those apart from a real arrival,
 *  and a client-side time window let one through every few minutes forever.
 *
 *  No id back = nothing was recorded = nothing to announce, which is exactly
 *  what stops the repeat pushes. */
export async function recordPlaceEvent(placeId: string, type: 'arrive' | 'leave'): Promise<void> {
  const { data: eventId, error } = await supabase.rpc('record_place_event', {
    p_place_id: placeId,
    p_type: type,
  })
  if (error || !eventId) return

  try {
    const token = await authToken()
    if (token && API_BASE) {
      await fetch(`${API_BASE}/api/send-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'place-event', place_event_id: eventId }),
      })
    }
  } catch {
    // best-effort push — the event is saved and still shows live via Realtime
  }
}
