// Places & geofences (migration 067) — data layer for Whereabouts Phase 2.
//
// Places are shared household furniture: any member can add/edit/remove them.
// Crossing one is recorded by the CROSSING member's own device (RLS only lets
// you record your own crossings), which drives the activity feed live via
// Realtime and pushes "Emma arrived at School" to the rest of the household via
// api/send-ping (?action=place-event).
import { supabase } from './supabase'
import type { Place, PlaceEvent } from './types'

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
  notify_arrivals: boolean
  notify_departures: boolean
}

/** The household's saved places (RLS scopes to our household). */
export async function fetchPlaces(): Promise<Place[]> {
  const { data, error } = await supabase.from('places').select('*').order('created_at')
  if (error) throw error
  return (data ?? []) as Place[]
}

export async function createPlace(input: PlaceInput): Promise<void> {
  const { error } = await supabase.from('places').insert(input)
  if (error) throw error
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

/** Geofences "bounce" at the boundary (repeated enter/exit as GPS jitters), so
 *  ignore an identical crossing recorded in the last few minutes. */
const DEDUP_MS = 5 * 60 * 1000

/** Record MY crossing of a place, then best-effort push it to the household. */
export async function recordPlaceEvent(placeId: string, type: 'arrive' | 'leave'): Promise<void> {
  const me = await myEmail()
  if (!me) return

  const since = new Date(Date.now() - DEDUP_MS).toISOString()
  const { data: recent } = await supabase
    .from('place_events')
    .select('id')
    .eq('place_id', placeId)
    .eq('user_email', me)
    .eq('type', type)
    .gt('at', since)
    .limit(1)
  if (recent && recent.length) return // bounce — already recorded

  const { data, error } = await supabase
    .from('place_events')
    .insert({ place_id: placeId, type })
    .select('id')
    .single()
  if (error || !data) return

  try {
    const token = await authToken()
    if (token && API_BASE) {
      await fetch(`${API_BASE}/api/send-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'place-event', place_event_id: data.id }),
      })
    }
  } catch {
    // best-effort push — the event is saved and still shows live via Realtime
  }
}
