// Background location task for Whereabouts. Delivers fixes to `member_locations`
// even when the app is backgrounded/closed — the whole point of the feature, and
// the reason it only works in the native app (a PWA can't do this).
//
// Requires: expo-location + expo-task-manager, iOS `UIBackgroundModes:
// ["location"]` and Always-authorization strings, Android background-location
// permission + a foreground service — all wired in app.config.js. None of it
// takes effect until a native rebuild (`npx expo prebuild` / an EAS dev build),
// and background delivery on iOS is best-effort (the OS batches and may pause
// updates) — verify on a real device.
//
// Like backgroundNotifications.ts, the task MUST be defined at module scope so
// the OS can wake it headlessly; importing this module is what registers it.
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import * as Battery from 'expo-battery'

import { ensureForegroundPermission, fetchMyLocation, upsertMyFix } from './location'

export const LOCATION_TASK = 'oneroof-location-updates'

async function readBattery(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync()
    if (level == null || level < 0) return null
    return Math.round(level * 100)
  } catch {
    return null
  }
}

// Module-scope definition — Expo re-runs this on every JS load (foreground or a
// headless background wake) before any start call.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations
  const loc = locations?.[locations.length - 1]
  if (!loc) return
  try {
    // Honor a pause/stop that happened while we were backgrounded: if sharing is
    // off or paused, tear the task down instead of writing a fix.
    const mine = await fetchMyLocation()
    const pausedFuture =
      mine?.paused_until != null && new Date(mine.paused_until).getTime() > Date.now()
    if (mine && (!mine.sharing || pausedFuture)) {
      await stopBackgroundUpdates()
      return
    }
    await upsertMyFix({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? null,
      speed: loc.coords.speed ?? null,
      battery: await readBattery(),
    })
  } catch {
    // best-effort — a dropped background fix is caught up by the next one
  }
})

/** Importing this module registers the task; call this from _layout so the
 *  import isn't tree-shaken and the task is defined on every launch. */
export function registerLocationTask(): void {
  // no-op: the module-scope defineTask above is the real work
}

/** Ask for Always-authorization (needed for background). Requests foreground
 *  first (iOS requires the two-step escalation). Returns whether it's granted. */
export async function ensureBackgroundPermission(): Promise<boolean> {
  if (!(await ensureForegroundPermission())) return false
  const current = await Location.getBackgroundPermissionsAsync()
  if (current.granted) return true
  if (!current.canAskAgain) return false
  const req = await Location.requestBackgroundPermissionsAsync()
  return req.granted
}

/** Start delivering background fixes. `labels` feed the Android foreground-service
 *  notification (localized by the caller — this module has no i18n). Safe to call
 *  when already running. */
export async function startBackgroundUpdates(labels: {
  title: string
  body: string
}): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) return
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 60, // meters between updates
    deferredUpdatesInterval: 60_000, // ms — batch to save battery
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: labels.title,
      notificationBody: labels.body,
      notificationColor: '#c2603f',
    },
  })
}

/** Stop background delivery (called when the user turns sharing off/pauses). */
export async function stopBackgroundUpdates(): Promise<void> {
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}
