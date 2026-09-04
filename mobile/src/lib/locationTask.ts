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
          // ANDROID-ONLY, and it was missing here for the same reason the saver
          // branch below documents: with distanceInterval alone the fused
          // provider picks its own cadence, so someone being WATCHED could
          // still report only every minute or two — they vanish off the edge of
          // the frame between fixes. iOS ignores it and uses the distance.
          timeInterval: 5_000,
          deferredUpdatesInterval: 0,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.Other,
          showsBackgroundLocationIndicator: false,
        }
      : {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 60, // meters between updates
          // ANDROID-ONLY, and it was missing: with distanceInterval alone the
          // fused provider decides its own cadence, so a phone that moves
          // steadily can go a long time between reports. iOS ignores it.
          timeInterval: 60_000,
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

/** Whether Always-authorization is already granted — i.e. whether calling
 *  `ensureBackgroundPermission()` would put an OS prompt on screen. Callers use
 *  this to decide if the prominent disclosure has to be shown first. */
export async function hasBackgroundPermission(): Promise<boolean> {
  const current = await Location.getBackgroundPermissionsAsync().catch(() => null)
  return !!current?.granted
}

/** Can the OS still be asked for background location, or is the only way in
 *  through Settings?
 *
 *  Android stops prompting once the user has said no (and on 11+ the "Allow all
 *  the time" choice is only offered in Settings at all). When that happens
 *  `ensureBackgroundPermission()` returns false having shown NOTHING — so a
 *  caller that puts the prominent disclosure up first leaves the user tapping
 *  Continue forever with no dialog and no explanation. Ask this first and send
 *  them to Settings instead. */
export async function canAskBackgroundPermission(): Promise<boolean> {
  try {
    // `denied` AND `!canAskAgain` together — never `canAskAgain` alone, which is
    // also false for a permission that has simply never been asked for. Getting
    // that wrong here would send a brand-new install to "Open Settings" instead
    // of the prompt it should have seen.
    const fg = await Location.getForegroundPermissionsAsync()
    if (fg.status === 'denied' && !fg.canAskAgain) return false
    const bg = await Location.getBackgroundPermissionsAsync()
    if (bg.granted) return true
    return !(bg.status === 'denied' && !bg.canAskAgain)
  } catch {
    // Unknown is not "impossible" — let the normal path try and fail visibly.
    return true
  }
}

/** Ask for Always-authorization (needed for background). Requests foreground
 *  first (iOS requires the two-step escalation). Returns whether it's granted.
 *
 *  COMPLIANCE: Google Play requires a prominent in-app disclosure BEFORE this
 *  prompt (mobile/PLAY-STORE-RELEASE.md §3.1). The disclosure lives in
 *  apps/location/LocationDisclosure.tsx and is gated by SharingControls — this
 *  module has no i18n/UI, so it can't show it itself. Any NEW caller of this
 *  function must show that screen first (check `hasBackgroundPermission()` and
 *  skip it only when permission is already granted). */
export async function ensureBackgroundPermission(): Promise<boolean> {
  if (!(await ensureForegroundPermission())) return false
  const current = await Location.getBackgroundPermissionsAsync()
  if (current.granted) return true
  // See ensureForegroundPermission: `canAskAgain` is not a reliable "will not
  // prompt" signal, and skipping the request on it silently blocked a fresh
  // install from ever seeing the dialog.
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

/** Restart background delivery if this device SHOULD be sharing but isn't.
 *
 *  Android does not bring a terminated app back for location events — Expo 56's
 *  docs put it plainly: "A terminated app will not automatically restart when a
 *  location or geofencing event occurs due to platform limitations", where iOS
 *  "will restart the terminated app". So on Android a force-stop, a reboot, or
 *  an OEM battery optimiser killing the foreground service leaves sharing dead
 *  until the user thinks to toggle it off and on. Nothing restarted it: the only
 *  callers of startBackgroundUpdates are the switch and Resume.
 *
 *  Symptom this fixes: your own pin frozen on the family map while everyone
 *  else's moves, no place crossings recorded, and therefore no arrival or
 *  departure alerts about you — with the app looking perfectly healthy, because
 *  `sharing` is still true in the database.
 *
 *  Returns true if it actually had to restart, so the caller can prime a fresh
 *  fix and put the stale pin right immediately. */
export async function resumeBackgroundUpdatesIfSharing(labels: FgLabels): Promise<boolean> {
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) return false
  const mine = await fetchMyLocation().catch(() => null)
  if (!isSharingEnabled(mine)) return false
  await startBackgroundUpdates(labels)
  return true
}

/** Stop background delivery (called when the user turns sharing off/pauses). */
export async function stopBackgroundUpdates(): Promise<void> {
  stopLiveTick()
  await AsyncStorage.removeItem(LIVE_UNTIL_KEY).catch(() => {})
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}
