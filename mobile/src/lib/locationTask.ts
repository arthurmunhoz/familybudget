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
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  ensureForegroundPermission,
  fetchMyLocation,
  isSharingEnabled,
  runLiveBurst,
  upsertMyFix,
} from './location'
import { fetchMyLiveWindowMs } from './liveLocation'

export const LOCATION_TASK = 'oneroof-location-updates'

// --- Live (ramped) mode -----------------------------------------------------
// While someone is watching me in Whereabouts, the ALREADY-RUNNING background
// task is reconfigured to stream (high accuracy, 10 m, no deferral, no
// auto-pause) instead of the battery-saver cadence. Re-calling
// startLocationUpdatesAsync with new options reconfigures the task in place.
// The crucial property: once ramped, the stream sustains itself through the
// location background mode — it no longer depends on silent-push delivery, so
// ONE delivered wake is enough for the whole watching session. State lives in
// AsyncStorage (a background wake is a fresh JS process; module state is gone).
const LIVE_UNTIL_KEY = 'oneroof-live-until'
const BG_LABELS_KEY = 'oneroof-bg-location-labels'
const LIVE_RECHECK_LEEWAY_MS = 10_000 // re-check the DB this close to expiry
const LIVE_TICK_MS = 15_000 // ramped keep-alive check (JS timers run: ramped updates keep the process alive)
const LIVE_BURST_MS = 20_000 // how much of the ~30s wake window the burst uses

type FgLabels = { title: string; body: string }

async function storedLabels(): Promise<FgLabels | null> {
  try {
    const raw = await AsyncStorage.getItem(BG_LABELS_KEY)
    return raw ? (JSON.parse(raw) as FgLabels) : null
  } catch {
    return null
  }
}

/** Task options for the two cadences. Android's foreground-service labels are
 *  persisted at start time (localized by the caller) so a background restart
 *  can reuse them; omitted if somehow missing (iOS never uses them). */
function taskOptions(mode: 'saver' | 'live', labels: FgLabels | null): Location.LocationTaskOptions {
  const base: Location.LocationTaskOptions =
    mode === 'live'
      ? {
          accuracy: Location.Accuracy.High,
          distanceInterval: 10,
          deferredUpdatesInterval: 0,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Other,
          showsBackgroundLocationIndicator: false,
        }
      : {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 60, // meters between updates
          deferredUpdatesInterval: 60_000, // ms — batch to save battery
          pausesUpdatesAutomatically: true,
          activityType: Location.ActivityType.Other,
          showsBackgroundLocationIndicator: false,
        }
  return labels
    ? {
        ...base,
        foregroundService: {
          notificationTitle: labels.title,
          notificationBody: labels.body,
          notificationColor: '#c2603f',
        },
      }
    : base
}

let liveTick: ReturnType<typeof setInterval> | null = null

function startLiveTick(): void {
  if (liveTick) return
  liveTick = setInterval(() => void manageLiveRamp(), LIVE_TICK_MS)
}

function stopLiveTick(): void {
  if (liveTick) {
    clearInterval(liveTick)
    liveTick = null
  }
}

/** Ramp up for `untilMs`. No-op when background updates aren't running (e.g.
 *  Always permission denied) — the wake burst still covers that case. */
async function rampBackgroundUpdates(untilMs: number): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (!running) return
  await AsyncStorage.setItem(LIVE_UNTIL_KEY, String(untilMs))
  await Location.startLocationUpdatesAsync(LOCATION_TASK, taskOptions('live', await storedLabels()))
  startLiveTick()
}

/** Step back down to the battery-saver cadence. */
async function relaxBackgroundUpdates(): Promise<void> {
  stopLiveTick()
  await AsyncStorage.removeItem(LIVE_UNTIL_KEY).catch(() => {})
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (!running) return
  await Location.startLocationUpdatesAsync(LOCATION_TASK, taskOptions('saver', await storedLabels()))
}

/** Extend ramped mode from the DB while a watcher's heartbeat keeps the
 *  request row alive; relax once it lapses. Called on a timer while ramped AND
 *  on every delivered fix (which also resurrects the timer after the OS
 *  relaunched the process — module state doesn't survive that). */
async function manageLiveRamp(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LIVE_UNTIL_KEY)
    if (!raw) {
      stopLiveTick()
      return
    }
    startLiveTick()
    const until = Number(raw)
    if (Date.now() < until - LIVE_RECHECK_LEEWAY_MS) return
    const dbUntil = await fetchMyLiveWindowMs()
    if (dbUntil > Date.now()) await AsyncStorage.setItem(LIVE_UNTIL_KEY, String(dbUntil))
    else await relaxBackgroundUpdates()
  } catch {
    // best-effort — the next fix or tick retries
  }
}

/** The BACKGROUND live-wake path (silent push, app asleep — see
 *  backgroundNotifications.ts): ramp the background task for the live window,
 *  then spend the wake's ~30s runtime streaming a high-accuracy burst so the
 *  watcher's map moves immediately. No-op if not sharing or nobody is actually
 *  watching (a stale/duplicate push). */
export async function respondToLiveWake(): Promise<void> {
  try {
    const mine = await fetchMyLocation()
    if (!isSharingEnabled(mine)) return
    const until = await fetchMyLiveWindowMs()
    if (until <= Date.now()) return
    await rampBackgroundUpdates(until)
    await runLiveBurst(Math.min(LIVE_BURST_MS, until - Date.now()))
  } catch {
    // best-effort — the watcher's next stale-check heartbeat re-fires the wake
  }
}

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
    await manageLiveRamp()
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
export async function startBackgroundUpdates(labels: FgLabels): Promise<void> {
  // Persist the (localized) labels so a background ramp/relax restart can
  // rebuild the Android foreground-service notification without a caller.
  await AsyncStorage.setItem(BG_LABELS_KEY, JSON.stringify(labels)).catch(() => {})
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) return
  await Location.startLocationUpdatesAsync(LOCATION_TASK, taskOptions('saver', labels))
}

/** Stop background delivery (called when the user turns sharing off/pauses). */
export async function stopBackgroundUpdates(): Promise<void> {
  stopLiveTick()
  await AsyncStorage.removeItem(LIVE_UNTIL_KEY).catch(() => {})
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}
