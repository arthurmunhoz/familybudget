// Safety Radius / "event mode" (migration 068) — a One Roof Plus feature.
//
// Drop a circle around yourself at a park or fair, pick which members to watch,
// and get alerted the moment one crosses the edge. Detection runs on the
// WATCHER's device against the live member_locations feed (see Whereabouts) —
// no server job — so the config here just persists the circle and survives a
// restart. Household-readable on purpose: being inside someone's safety radius
// isn't a secret.
import * as Notifications from 'expo-notifications'

import { supabase } from './supabase'
import { haversineMeters, type LatLng } from './location'
import type { SafetyWatch } from './types'

export const RADIUS_PRESETS = [100, 150, 250, 500, 1000]
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

/** Start (or replace) my watch. */
export async function startWatch(input: {
  center: LatLng
  radius_m: number
  watched: string[]
}): Promise<void> {
  const me = await myEmail()
  if (!me) return
  const { error } = await supabase.from('safety_watches').upsert(
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
  if (error) throw error
}

export async function stopWatch(): Promise<void> {
  const me = await myEmail()
  if (!me) return
  await supabase.from('safety_watches').delete().eq('owner_email', me)
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
