// Family location ("Whereabouts") — data + logic layer, Phase 1.
//
// One row per member in `member_locations` (migration 065). Reads/writes go
// through RLS (household stamped by column default; a user may only write their
// OWN row). This file is pure logic + Supabase + expo-location foreground fixes
// + the Mapbox Directions call for drive-time ETA + navigation deep-links. The
// background location TASK lives in `@/lib/locationTask` (it must be defined at
// module scope so the OS can wake it), and Mapbox map rendering lives in the
// screens — keep this file free of react-native-maps imports.
import { Linking } from 'react-native'
import * as Location from 'expo-location'
import * as Battery from 'expo-battery'

import { supabase } from './supabase'
import type { MemberLocation } from './types'

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
 *  sharing toggle and a fix can share one upsert path without a union-type snag. */
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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every household member's location row (RLS returns only our household). */
export async function fetchMemberLocations(): Promise<MemberLocation[]> {
  const { data, error } = await supabase.from('member_locations').select('*')
  if (error) throw error
  return (data ?? []) as MemberLocation[]
}

/** The current user's own row, or null if they've never shared. */
export async function fetchMyLocation(): Promise<MemberLocation | null> {
  const email = await myEmail()
  if (!email) return null
  const { data } = await supabase
    .from('member_locations')
    .select('*')
    .eq('user_email', email)
    .maybeSingle()
  return (data as MemberLocation) ?? null
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
  return !!(
    loc?.sharing &&
    loc.paused_until &&
    new Date(loc.paused_until).getTime() > Date.now()
  )
}

/** True when sharing is switched on and not currently paused (coords aside).
 *  Use this to decide whether to keep capturing my own fixes — opening the map
 *  must NOT start sharing on its own (off by default, opt-in). */
export function isSharingEnabled(loc: MemberLocation | undefined | null): boolean {
  return !!loc?.sharing && !isPaused(loc)
}

// ---------------------------------------------------------------------------
// Writes (current user's own row only — RLS enforces it too)
// ---------------------------------------------------------------------------

/** Persist a fresh fix. Omits `sharing` on purpose so a location update never
 *  flips the sharing flag — that's controlled explicitly below. */
export async function upsertMyFix(fix: Fix): Promise<void> {
  const email = await myEmail()
  if (!email) return
  await supabase
    .from('member_locations')
    .upsert(
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
    : { user_email: email, sharing: false, paused_until: null, lat: null, lng: null, accuracy: null, speed: null }
  await supabase.from('member_locations').upsert(row, { onConflict: 'user_email' })
}

/** Pause sharing until `until` (keeps `sharing` true so the family sees a
 *  visible "paused", not a silent gap). Nulls coordinates for the pause. */
export async function pauseSharing(until: Date): Promise<void> {
  const email = await myEmail()
  if (!email) return
  await supabase
    .from('member_locations')
    .upsert(
      { user_email: email, sharing: true, paused_until: until.toISOString(), lat: null, lng: null, accuracy: null, speed: null },
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

// ---------------------------------------------------------------------------
// Foreground capture
// ---------------------------------------------------------------------------

async function readBattery(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync()
    if (level == null || level < 0) return null
    return Math.round(level * 100)
  } catch {
    return null
  }
}

/** Ask for while-in-use permission (idempotent). Returns whether it's granted. */
export async function ensureForegroundPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync()
  if (current.granted) return true
  if (!current.canAskAgain) return false
  const req = await Location.requestForegroundPermissionsAsync()
  return req.granted
}

/** Grab a single fix now (foreground) and persist it, so my dot is fresh the
 *  moment I open the map. Returns the fix, or null if permission was denied. */
export async function captureAndUpload(): Promise<Fix | null> {
  if (!(await ensureForegroundPermission())) return null
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  const fix: Fix = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    speed: pos.coords.speed ?? null,
    battery: await readBattery(),
  }
  await upsertMyFix(fix)
  return fix
}

// ---------------------------------------------------------------------------
// Distance, ETA, formatting
// ---------------------------------------------------------------------------

/** Straight-line distance in meters (haversine) — free, no API call. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface DriveEta {
  minutes: number
  meters: number
}

/** Real driving ETA via the Mapbox Directions API. Returns null if the token is
 *  unset or the request fails (caller falls back to straight-line distance). */
export async function driveEta(from: LatLng, to: LatLng): Promise<DriveEta | null> {
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN
  if (!token) return null
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&access_token=${token}`
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

/** Whether to show distances in miles (US/UK measurement systems) vs km. */
let useImperial = false
export function setUseImperial(v: boolean): void {
  useImperial = v
}

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

// ---------------------------------------------------------------------------
// Navigation hand-off (open the user's map app to drive there)
// ---------------------------------------------------------------------------

export type NavApp = 'apple' | 'google' | 'waze'

/** Universal HTTPS links — each opens the native app if installed, else the web
 *  version. Avoids needing LSApplicationQueriesSchemes / canOpenURL. */
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

export async function openNavigation(app: NavApp, to: LatLng, label?: string): Promise<void> {
  try {
    await Linking.openURL(navUrl(app, to, label))
  } catch {
    // no map app / user cancelled — nothing to recover
  }
}
