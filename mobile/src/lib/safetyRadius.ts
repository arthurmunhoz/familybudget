// Safety Radius / "event mode" (migration 068) — a One Roof Plus feature.
//
// Drop a circle around yourself at a park or fair, pick which members to watch,
// and get alerted the moment one crosses the edge. Detection runs on the
// WATCHER's device against the live member_locations feed (see Whereabouts) —
// no server job — so the config here just persists the circle and survives a
// restart. Household-readable on purpose: being inside someone's safety radius
// isn't a secret.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'

import { supabase } from './supabase'
import { haversineMeters, type LatLng } from './location'
import type { SafetyWatch } from './types'

/** How long a watch runs before it auto-expires (matches the DB default). */
export const WATCH_HOURS = 4

async function myEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

/** My active (unexpired) watch, or null. */
export async function fetchMyWatch(): Promise<SafetyWatch | null> {
  const me = await myEmail()
  if (!me) return null
  const { data } = await supabase
    .from('safety_watches')
    .select('*')
    .eq('owner_email', me)
    .maybeSingle()
  const row = (data as SafetyWatch) ?? null
  if (!row) return null
  return new Date(row.expires_at).getTime() > Date.now() ? row : null
}

/** Thrown when a free user has already had their watch in the last 24h. The
 *  caller shows the paywall — see migration 072. */
export const WATCH_LIMIT_ERROR = 'free_plan_watch_limit'

/** Minutes a free watch runs before the server ends it (mirrors the DB's
 *  free_watch_minutes(); the DB is the one that actually enforces it). */
export const FREE_WATCH_MINUTES = 30

/** When I last STARTED a watch, so the sheet can tell a free user their daily
 *  one is spent BEFORE they configure a radius and get bounced. Null when
 *  they've never started one. */
export async function fetchLastWatchStart(): Promise<string | null> {
  const me = await myEmail()
  if (!me) return null
  const { data } = await supabase
    .from('safety_watch_starts')
    .select('at')
    .eq('owner_email', me)
    .order('at', { ascending: false })
    .limit(1)
  return (data?.[0]?.at as string) ?? null
}

/** True when a free user's 24h allowance hasn't reset yet. */
export function watchAllowanceSpent(lastStart: string | null): boolean {
  if (!lastStart) return false
  return Date.now() - new Date(lastStart).getTime() < 24 * 3600 * 1000
}

/** Key for the ONE pending "your watch ended" notification. Persisted so it can
 *  still be cancelled after the app has been restarted. */
const ENDED_NOTICE_KEY = 'oneroof-watch-ended-notice'

/** Tell them, at the moment it happens, that nothing is being watched any more.
 *  Scheduled with the OS rather than fired from a timer in the app: a watch
 *  ends while the phone is in a pocket at the very event it was set up for, so
 *  it has to arrive whether or not the app is running. Copy comes from the
 *  caller — i18n is a hook, and this module isn't a component. */
export async function scheduleWatchEndedNotice(
  expiresAt: string,
  title: string,
  body: string,
): Promise<void> {
  await cancelWatchEndedNotice()
  const at = new Date(expiresAt).getTime()
  if (!isFinite(at) || at <= Date.now()) return
  try {
    const perm = await Notifications.getPermissionsAsync()
    if (!perm.granted) {
      const req = await Notifications.requestPermissionsAsync()
      if (!req.granted) return
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    })
    await AsyncStorage.setItem(ENDED_NOTICE_KEY, id)
  } catch {
    // best-effort: the watch still expires server-side either way
  }
}

/** Stopping early must take the notice with it — otherwise it fires later
 *  announcing the end of something they already ended themselves. */
export async function cancelWatchEndedNotice(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(ENDED_NOTICE_KEY)
    if (!id) return
    await Notifications.cancelScheduledNotificationAsync(id)
    await AsyncStorage.removeItem(ENDED_NOTICE_KEY)
  } catch {
    // nothing to recover — a stray notice is better than a crash
  }
}

/** Start (or replace) my watch.
 *
 *  Returns the row the SERVER wrote, because on a free plan the server decides
 *  when it ends: the trigger clamps `expires_at` to 30 minutes regardless of
 *  what we ask for here. Reading the result back is what lets us schedule the
 *  "your watch has ended" notification for the right moment instead of a time
 *  we merely hoped for. */
export async function startWatch(input: {
  center: LatLng
  radius_m: number
  watched: string[]
}): Promise<SafetyWatch | null> {
  const me = await myEmail()
  if (!me) return null
  const { data, error } = await supabase
    .from('safety_watches')
    .upsert(
      {
        owner_email: me,
        center_lat: input.center.lat,
        center_lng: input.center.lng,
        radius_m: input.radius_m,
        watched: input.watched,
        expires_at: new Date(Date.now() + WATCH_HOURS * 3600 * 1000).toISOString(),
      },
      { onConflict: 'owner_email' },
    )
    .select('*')
    .single()
  if (error) throw error
  return (data as SafetyWatch) ?? null
}

export async function stopWatch(): Promise<void> {
  const me = await myEmail()
  if (!me) return
  await supabase.from('safety_watches').delete().eq('owner_email', me)
  await cancelWatchEndedNotice()
}

/** True when `point` is outside the watch circle. */
export function isOutside(watch: SafetyWatch, point: LatLng): boolean {
  return (
    haversineMeters({ lat: watch.center_lat, lng: watch.center_lng }, point) > watch.radius_m
  )
}

/** A GeoJSON polygon approximating the circle, for drawing it on the map
 *  (Mapbox CircleLayer radii are in pixels, not meters, so we need a real
 *  polygon to stay geographically accurate at any zoom). */
export function circlePolygon(
  center: LatLng,
  radiusM: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = []
  const latRad = (center.lat * Math.PI) / 180
  // Degrees per meter, corrected for longitude convergence at this latitude.
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos(latRad)))
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI
    coords.push([center.lng + dLng * Math.cos(theta), center.lat + dLat * Math.sin(theta)])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

/** Fire a local alert on THIS device (the watcher's) — no server push needed
 *  since the breach is detected here. Best-effort: a denied notification
 *  permission still leaves the in-app toast + map highlight. */
export async function alertBreach(name: string, distanceLabel: string): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync()
    if (!perm.granted) {
      const req = await Notifications.requestPermissionsAsync()
      if (!req.granted) return
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ ${name}`,
        body: `${distanceLabel}`,
        sound: 'default',
      },
      trigger: null, // immediately
    })
  } catch {
    // best-effort — the in-app alert still shows
  }
}
