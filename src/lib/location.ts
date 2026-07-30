// Whereabouts (family location) — web data + logic layer.
//
// Ported from `mobile/src/lib/location.ts` + `mobile/src/lib/places.ts`. Same
// tables (migrations 065–074), same RLS, same math, so the two clients agree.
// Mapbox GL rendering lives in the screen; keep this file map-free.
//
// WHAT THE WEB CAN AND CANNOT DO — read before extending this:
//   • Reading the family's positions, places and activity feed: FULL parity.
//     Those are plain Supabase reads over Realtime-enabled tables.
//   • Sharing MY OWN position: FOREGROUND ONLY. `navigator.geolocation` stops
//     the moment the tab is backgrounded or the phone locks; there is no
//     background-location API for a PWA on any browser. So the web can keep your
//     pin fresh while you're looking at the app and no longer.
//   • Geofence crossings (place_events) and Safety-Radius breach alerts: NOT
//     possible here. Both need the OS to wake the app when you cross a boundary.
//     `place_events` rows therefore come from household members on iOS; the web
//     only READS them. Never write place_events from this client — migration 071
//     routes every insert through record_place_event() for state-transition
//     dedupe, and a browser can't observe the crossing in the first place.
// The UI must SAY this rather than imply Find-My-style always-on tracking.
import { supabase } from './supabase'
import type { MemberLocation, Place, PlaceEvent } from './types'

export interface LatLng {
  lat: number
  lng: number
}

/** A single position sample we persist for the current user. */
export interface Fix {
  lat: number
  lng: number
  accuracy: number | null
  speed: number | null
  battery: number | null
}

/** Partial write to member_locations — everything but the key is optional, so a
 *  sharing toggle and a fix can share one upsert path. */
type LocUpsert = {
  user_email: string
  sharing?: boolean
  paused_until?: string | null
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  speed?: number | null
  battery?: number | null
}

/** Current user's email from the CACHED session (never getUser — see CLAUDE.md). */
async function myEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Every household member's location row (RLS returns only our household). */
export async function fetchMemberLocations(): Promise<MemberLocation[]> {
  const { data, error } = await supabase.from('member_locations').select('*')
  if (error) throw error
  return (data ?? []) as MemberLocation[]
}

/** True when this row should be plotted: sharing on, not paused, has coords.
 *  A row can exist purely to carry `sharing: false`, so guard on this. */
export function isSharingLive(
  loc: MemberLocation | undefined | null,
): loc is MemberLocation & { lat: number; lng: number } {
  if (!loc || loc.lat == null || loc.lng == null || !loc.sharing) return false
  if (loc.paused_until && new Date(loc.paused_until).getTime() > Date.now()) return false
  return true
}

/** True when this member has sharing on but is temporarily paused. */
export function isPaused(loc: MemberLocation | undefined | null): boolean {
  return !!(loc?.sharing && loc.paused_until && new Date(loc.paused_until).getTime() > Date.now())
}

/** True when sharing is switched on and not currently paused (coords aside).
 *  Use this to decide whether to keep capturing my own fixes — opening the map
 *  must NOT start sharing on its own (off by default, opt-in). */
export function isSharingEnabled(loc: MemberLocation | undefined | null): boolean {
  return !!loc?.sharing && !isPaused(loc)
}

// ── Writes (own row only — RLS enforces it too) ──────────────────────────────

/** Persist a fresh fix. Omits `sharing` on purpose so a location update never
 *  flips the sharing flag — that's controlled explicitly below. */
export async function upsertMyFix(fix: Fix): Promise<void> {
  const email = await myEmail()
  if (!email) return
  await supabase.from('member_locations').upsert(
    {
      user_email: email,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speed: fix.speed,
      battery: fix.battery,
    },
    { onConflict: 'user_email' },
  )
}

/** Turn sharing on or off. Turning OFF nulls the coordinates so no stale
 *  location lingers for the household to read. */
export async function setSharing(on: boolean): Promise<void> {
  const email = await myEmail()
  if (!email) return
  const row: LocUpsert = on
    ? { user_email: email, sharing: true, paused_until: null }
    : {
        user_email: email,
        sharing: false,
        paused_until: null,
        lat: null,
        lng: null,
        accuracy: null,
        speed: null,
      }
  await supabase.from('member_locations').upsert(row, { onConflict: 'user_email' })
}

/** Pause sharing until `until` (keeps `sharing` true so the family sees a
 *  visible "paused", not a silent gap). Nulls coordinates for the pause. */
export async function pauseSharing(until: Date): Promise<void> {
  const email = await myEmail()
  if (!email) return
  await supabase.from('member_locations').upsert(
    {
      user_email: email,
      sharing: true,
      paused_until: until.toISOString(),
      lat: null,
      lng: null,
      accuracy: null,
      speed: null,
    },
    { onConflict: 'user_email' },
  )
}

/** Clear any pause and resume live sharing. */
export async function resumeSharing(): Promise<void> {
  const email = await myEmail()
  if (!email) return
  await supabase
    .from('member_locations')
    .upsert({ user_email: email, sharing: true, paused_until: null }, { onConflict: 'user_email' })
}

// ── Browser geolocation (foreground only) ───────────────────────────────────

export function geolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

/** Battery level 0–100 via the Battery Status API. Chrome/Android only (Safari
 *  and Firefox removed it), so this is strictly best-effort — null just means
 *  the roster shows no battery chip for this member. */
async function readBattery(): Promise<number | null> {
  type BatteryNav = Navigator & { getBattery?: () => Promise<{ level: number }> }
  const nav = navigator as BatteryNav
  if (typeof nav.getBattery !== 'function') return null
  try {
    const b = await nav.getBattery()
    return Math.round(b.level * 100)
  } catch {
    return null
  }
}

/** One position sample. Rejects rather than resolving null so the caller can
 *  tell "denied" from "no fix yet" and show the right message. */
export function getCurrentFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!geolocationSupported()) {
      reject(new Error('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          speed: pos.coords.speed ?? null,
          battery: await readBattery(),
        })
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    )
  })
}

/**
 * Watch my position and upload each fix while sharing is on.
 *
 * Returns a stop function. THIS ONLY RUNS WHILE THE PAGE IS OPEN — the browser
 * suspends timers and geolocation for a backgrounded tab, and there is no
 * background alternative on the web. Uploads are throttled so a jittery GPS
 * can't hammer Supabase.
 */
export function watchAndUpload(onFix?: (fix: Fix) => void, minIntervalMs = 15_000): () => void {
  if (!geolocationSupported()) return () => {}
  let last = 0
  let stopped = false
  const id = navigator.geolocation.watchPosition(
    async (pos) => {
      if (stopped) return
      const now = Date.now()
      if (now - last < minIntervalMs) return
      last = now
      const fix: Fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        speed: pos.coords.speed ?? null,
        battery: await readBattery(),
      }
      onFix?.(fix)
      await upsertMyFix(fix)
    },
    () => {
      /* a transient position error shouldn't tear the watch down */
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
  )
  return () => {
    stopped = true
    navigator.geolocation.clearWatch(id)
  }
}

// ── Distance / formatting (identical to the iOS implementation) ──────────────

/** Straight-line distance in meters (haversine) — free, no API call. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Miles vs km, from the browser's locale. iOS asks the OS; same idea. */
const useImperial = (() => {
  const loc = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  return /^en-(US|LR)|^my/i.test(loc)
})()

export function formatDistance(meters: number): string {
  if (useImperial) {
    const miles = meters / 1609.34
    if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
  }
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

export function formatEta(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** Round, familiar radius choices in the user's OWN units — see the iOS note:
 *  running metres through formatDistance gives nonsense like "328 ft". */
export function radiusPresets(min = 0): { meters: number; label: string }[] {
  const imperial = [
    { meters: 76, label: '250 ft' },
    { meters: 152, label: '500 ft' },
    { meters: 305, label: '1000 ft' },
    { meters: 402, label: '¼ mi' },
    { meters: 805, label: '½ mi' },
    { meters: 1609, label: '1 mi' },
  ]
  const metric = [
    { meters: 50, label: '50 m' },
    { meters: 100, label: '100 m' },
    { meters: 250, label: '250 m' },
    { meters: 500, label: '500 m' },
    { meters: 1000, label: '1 km' },
    { meters: 2000, label: '2 km' },
  ]
  return (useImperial ? imperial : metric).filter((p) => p.meters >= min)
}

export interface DriveEta {
  minutes: number
  meters: number
}

export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? ''

/** Real driving ETA via the Mapbox Directions API. Null when the token is unset
 *  or the request fails — the caller falls back to straight-line distance. */
export async function driveEta(from: LatLng, to: LatLng): Promise<DriveEta | null> {
  if (!MAPBOX_TOKEN) return null
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&access_token=${MAPBOX_TOKEN}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { routes?: { duration: number; distance: number }[] }
    const route = json.routes?.[0]
    if (!route) return null
    return { minutes: Math.max(1, Math.round(route.duration / 60)), meters: route.distance }
  } catch {
    return null
  }
}

// ── Navigation hand-off ─────────────────────────────────────────────────────

export type NavApp = 'apple' | 'google' | 'waze'

/** Universal HTTPS links — each opens the native app if installed, else the web
 *  version, so these work from a browser too. */
export function navUrl(app: NavApp, to: LatLng, label?: string): string {
  const dest = `${to.lat},${to.lng}`
  switch (app) {
    case 'apple':
      return `https://maps.apple.com/?daddr=${dest}${label ? `&q=${encodeURIComponent(label)}` : ''}`
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`
    case 'waze':
      return `https://waze.com/ul?ll=${dest}&navigate=yes`
  }
}

// ── Places + activity feed (read/write; crossings are read-only here) ────────

/** The place a member is inside; smallest radius wins when they overlap. */
export function placeAt(places: Place[], point: LatLng): Place | null {
  let best: Place | null = null
  for (const p of places) {
    if (haversineMeters(point, { lat: p.lat, lng: p.lng }) <= p.radius_m) {
      if (!best || p.radius_m < best.radius_m) best = p
    }
  }
  return best
}

export async function fetchPlaces(): Promise<Place[]> {
  const { data } = await supabase.from('places').select('*').order('name')
  return (data ?? []) as Place[]
}

/** Free households are capped at one place by a trigger (migration 072); the
 *  caller surfaces this rather than showing a raw Postgres error. */
export const PLACE_LIMIT_ERROR = 'free_plan_place_limit'

export async function createPlace(input: {
  name: string
  icon: string
  lat: number
  lng: number
  radius_m: number
}): Promise<string | null> {
  const { error } = await supabase.from('places').insert(input)
  return error?.message ?? null
}

export async function deletePlace(id: string): Promise<void> {
  await supabase.from('places').delete().eq('id', id)
}

/** The household's recent crossings, newest first. Written by members' phones. */
export async function fetchPlaceEvents(limit = 40): Promise<PlaceEvent[]> {
  const { data } = await supabase
    .from('place_events')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit)
  return (data ?? []) as PlaceEvent[]
}

/** "3 min ago" / "2 h ago" / "5 d ago" — the roster's freshness stamp. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return `${Math.round(hrs / 24)} d ago`
}
