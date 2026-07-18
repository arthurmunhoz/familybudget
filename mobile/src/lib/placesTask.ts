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
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'

import { fetchMyLocation, isSharingEnabled } from './location'
import { fetchPlaces, recordPlaceEvent } from './places'

export const GEOFENCE_TASK = 'oneroof-place-geofences'

/** iOS caps monitored regions at 20 per app — stay at/under it. */
const MAX_REGIONS = 20

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

/** (Re)start monitoring the household's places. Call on launch and whenever
 *  places or sharing change. Stops monitoring when sharing is off or there's
 *  nothing to watch. `startGeofencingAsync` replaces the whole monitored set. */
export async function syncGeofences(): Promise<void> {
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)

  const mine = await fetchMyLocation()
  if (!isSharingEnabled(mine)) {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
    return
  }

  const places = await fetchPlaces().catch(() => [] as Awaited<ReturnType<typeof fetchPlaces>>)
  const regions = places
    .filter((p) => p.notify_arrivals || p.notify_departures)
    .slice(0, MAX_REGIONS)
    .map((p) => ({
      identifier: p.id,
      latitude: p.lat,
      longitude: p.lng,
      radius: p.radius_m,
      notifyOnEnter: p.notify_arrivals,
      notifyOnExit: p.notify_departures,
    }))

  if (!regions.length) {
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
    return
  }
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions).catch(() => {})
}

export async function stopGeofences(): Promise<void> {
  const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)
  if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {})
}
