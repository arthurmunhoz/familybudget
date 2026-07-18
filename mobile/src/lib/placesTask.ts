// Native geofence monitoring for saved places (Whereabouts Phase 2).
//
// Each member's device monitors the household's places; crossing one is recorded
// by THAT device (RLS only allows recording your own crossings). Uses OS-level
// region monitoring, which is far cheaper on battery than polling — the OS wakes
// us only on a boundary crossing.
//
// Like locationTask.ts, the task MUST be defined at module scope so the OS can
// wake it headlessly. Requires Always-authorization (the same permission sharing
// asks for) and a native build. iOS monitors at most 20 regions per app.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'

import { fetchMyLocation, isSharingEnabled } from './location'
import { fetchPlaces, recordPlaceEvent } from './places'

export const GEOFENCE_TASK = 'oneroof-place-geofences'

/** iOS caps monitored regions at 20 per app — stay at/under it. */
const MAX_REGIONS = 20

/** Which region set we last handed to the OS (see syncGeofences). */
const SIGNATURE_KEY = 'oneroof-geofence-signature'

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return
  const { eventType, region } = (data ?? {}) as {
    eventType?: Location.GeofencingEventType
    region?: { identifier?: string }
  }
  const placeId = region?.identifier
  if (!placeId) return
  try {
    // Respect sharing: if I've turned location off or paused it, my crossings
    // are nobody's business.
    const mine = await fetchMyLocation()
    if (!isSharingEnabled(mine)) return
    if (eventType === Location.GeofencingEventType.Enter) {
      await recordPlaceEvent(placeId, 'arrive')
    } else if (eventType === Location.GeofencingEventType.Exit) {
      await recordPlaceEvent(placeId, 'leave')
    }
  } catch {
    // best-effort — a missed crossing must never crash the task
  }
})

/** Importing this module registers the task; call from _layout so the import
 *  isn't tree-shaken and the task exists on every launch. */
export function registerGeofenceTask(): void {
  // no-op: the module-scope defineTask above is the real work
}

/** Fingerprint of the monitored set, so we can tell "nothing changed" from a
 *  real edit. Sorted, because place order is not stable. */
function regionSignature(regions: { identifier: string; latitude: number; longitude: number; radius: number }[]): string {
  return regions
    .map((r) => `${r.identifier}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}:${Math.round(r.radius)}`)
    .sort()
    .join('|')
}

/** (Re)start monitoring the household's places. Call on launch and whenever
 *  places or sharing change. Stops monitoring when sharing is off or there's
 *  nothing to watch. `startGeofencingAsync` replaces the whole monitored set.
 *
 *  RESTARTING IS NOT FREE, which is why the signature check below exists:
 *  expo-location holds each region's state in MEMORY, re-seeds it to Unknown on
 *  every start, and then calls requestStateForRegion — so restarting re-announces
 *  Enter for every place you're currently standing in (and Exit for the rest).
 *  This used to run on each visit to Whereabouts, which is what produced a fresh
 *  "arrived at Home" every time the app was opened. Migration 071 stops those
 *  reaching anyone; not re-registering stops them being generated at all. */
export async function syncGeofences(): Promise<void> {
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)

  const mine = await fetchMyLocation()
  if (!isSharingEnabled(mine)) {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
    await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => {})
    return
  }

  const places = await fetchPlaces().catch(() => [] as Awaited<ReturnType<typeof fetchPlaces>>)
  // Monitor EVERY place: my device records the crossing regardless of who's
  // watching, and the push fan-out (place_watchers) decides who — if anyone —
  // actually hears about it.
  const regions = places.slice(0, MAX_REGIONS).map((p) => ({
    identifier: p.id,
    latitude: p.lat,
    longitude: p.lng,
    radius: p.radius_m,
    notifyOnEnter: true,
    notifyOnExit: true,
  }))

  if (!regions.length) {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
    await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => {})
    return
  }

  // Already monitoring exactly this set? Leave it alone — see the note above.
  // Only skip while it's actually RUNNING, so a set that somehow stopped still
  // gets re-registered rather than being trusted from the stored signature.
  const signature = regionSignature(regions)
  if (running) {
    const previous = await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null)
    if (previous === signature) return
  }

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions).catch(() => {})
  await AsyncStorage.setItem(SIGNATURE_KEY, signature).catch(() => {})
}

export async function stopGeofences(): Promise<void> {
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)
  if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
  await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => {})
}
