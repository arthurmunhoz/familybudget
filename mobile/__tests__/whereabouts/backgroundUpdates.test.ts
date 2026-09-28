/**
 * SPEC §C — how background updates are started on Android, and that a cold
 * launch brings them back (C4 is the recovery path after expo-task-manager
 * unregistered the task — see headless.test.ts).
 */
import { Platform } from 'react-native'
import { goForeground, resetWorld, seedSharing, world } from './helpers/world'

const LABELS = { title: 'One Roof is sharing your location', body: 'Your family can see where you are.' }
const ACCURACY = { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 }

function load() {
  jest.resetModules()
  return require('@/lib/locationTask') as typeof import('@/lib/locationTask')
}

beforeEach(() => {
  resetWorld()
})

it('runs on the Android platform preset', () => {
  expect(Platform.OS).toBe('android')
})

describe('C1/C2 — startBackgroundUpdates on Android', () => {
  async function started() {
    seedSharing(true)
    const t = load()
    await t.startBackgroundUpdates(LABELS)
    const u = world().locationUpdates
    expect(u).not.toBeNull()
    expect(u!.name).toBe(t.LOCATION_TASK)
    return u!.options
  }

  it('C1 uses a foreground service with a title and body (else Android throttles to a few fixes/hour)', async () => {
    const o = await started()
    expect(o.foregroundService).toEqual(
      expect.objectContaining({ notificationTitle: expect.any(String), notificationBody: expect.any(String) }),
    )
    expect(o.foregroundService.notificationTitle.length).toBeGreaterThan(0)
  })

  it('C1 swiping the app away does not kill the service', async () => {
    const o = await started()
    expect(o.foregroundService.killServiceOnDestroy).not.toBe(true)
  })

  it('C2 accuracy is at least Balanced', async () => {
    const o = await started()
    expect(o.accuracy ?? ACCURACY.Balanced).toBeGreaterThanOrEqual(ACCURACY.Balanced)
  })

  it('C2 Android gets a timeInterval of at most 5 minutes', async () => {
    const o = await started()
    expect(typeof o.timeInterval).toBe('number')
    expect(o.timeInterval).toBeLessThanOrEqual(5 * 60_000)
  })

  it('C2 distanceInterval is at most 100 m', async () => {
    const o = await started()
    expect(o.distanceInterval ?? 0).toBeLessThanOrEqual(100)
  })

  it('C2 deferred delivery does not hold fixes back more than 5 minutes', async () => {
    const o = await started()
    expect(o.deferredUpdatesInterval ?? 0).toBeLessThanOrEqual(5 * 60_000)
  })
})

describe('C3–C5 — cold launch', () => {
  it('C3 Android: already registered (e.g. service lost after a process kill) → options re-applied from the foreground', async () => {
    seedSharing(true)
    const t = load()
    // Registered, but the OS-restarted process could not bring the foreground
    // service back — the only cure is setting the options again from the foreground.
    world().locationUpdates = { name: t.LOCATION_TASK, options: { accuracy: ACCURACY.Balanced } }
    world().registered.add(t.LOCATION_TASK)
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    expect(world().calls).toContain('location.startLocationUpdatesAsync')
    expect(world().locationUpdates?.options.foregroundService).toEqual(
      expect.objectContaining({ notificationTitle: LABELS.title, notificationBody: LABELS.body }),
    )
  })

  it('C3 Android: re-applying keeps the live cadence while a watcher has this device ramped', async () => {
    seedSharing(true)
    const t = load()
    // After load(): the module registry was just reset, so this is the same
    // AsyncStorage instance the app module holds.
    const AsyncStorage = require('@react-native-async-storage/async-storage')
    await AsyncStorage.setItem('oneroof-live-until', String(Date.now() + 60_000))
    world().locationUpdates = { name: t.LOCATION_TASK, options: {} }
    world().registered.add(t.LOCATION_TASK)
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    expect(world().locationUpdates?.options.accuracy).toBe(ACCURACY.High)
    expect(world().locationUpdates?.options.foregroundService).toBeTruthy()
  })

  it('C4 sharing on + permission + task NOT running (e.g. auto-unregistered) → started again', async () => {
    seedSharing(true)
    const t = load()
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    expect(world().locationUpdates?.name).toBe(t.LOCATION_TASK)
    expect(world().locationUpdates?.options.foregroundService).toBeTruthy()
  })

  it('C4 a task registered by an older build with worse options is restarted with the current ones', async () => {
    seedSharing(true)
    const t = load()
    world().locationUpdates = { name: t.LOCATION_TASK, options: { accuracy: ACCURACY.Low } }
    world().registered.add(t.LOCATION_TASK)
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    expect(world().locationUpdates?.options.foregroundService).toBeTruthy()
  })

  it('C5 sharing OFF → nothing is started', async () => {
    seedSharing(false)
    const t = load()
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    expect(world().locationUpdates).toBeNull()
  })

  it('C5 paused → no position is shared', async () => {
    seedSharing(true, { paused_until: new Date(Date.now() + 3600_000).toISOString() })
    const t = load()
    await t.resumeBackgroundUpdatesIfSharing(LABELS)
    // Either don't run updates, or run them but the task writes nothing (§D3).
    if (world().locationUpdates) {
      const task = world().tasks.get(t.LOCATION_TASK)
      expect(task).toBeTruthy()
      world().writes = []
      await task!({ data: { locations: [world().position] }, error: null, executionInfo: { eventId: '1', taskName: t.LOCATION_TASK } })
      expect(world().writes.filter((w) => w.table === 'member_locations' && w.payload?.lat != null)).toEqual([])
    }
  })
})

describe('C7 — the foreground service is never dropped', () => {
  it('relaxing from live mode (app open) with NO stored labels still runs a foreground service', async () => {
    seedSharing(true)
    const t = load()
    goForeground()
    const AsyncStorage = require('@react-native-async-storage/async-storage')
    // Ramped, window already over, labels never persisted (older build / cleared storage).
    await AsyncStorage.setItem('oneroof-live-until', String(Date.now() - 60_000))
    world().locationUpdates = { name: t.LOCATION_TASK, options: {} }
    world().registered.add(t.LOCATION_TASK)
    const task = world().tasks.get(t.LOCATION_TASK)!
    await task({
      data: { locations: [world().position] },
      error: null,
      executionInfo: { eventId: 'x', taskName: t.LOCATION_TASK },
    })
    expect(world().calls).toContain('location.startLocationUpdatesAsync')
    const fg = world().locationUpdates?.options.foregroundService
    expect(fg?.notificationTitle).toBeTruthy()
    expect(fg?.notificationBody).toBeTruthy()
  })
})

describe('E — permission flow (Android 11+)', () => {
  it('E1 asks for foreground before background', async () => {
    world().fg = 'undetermined'
    world().fgOnRequest = 'granted'
    world().bg = 'undetermined'
    world().bgOnRequest = 'granted'
    const t = load()
    const ok = await t.ensureBackgroundPermission()
    const calls = world().calls
    const fgAt = calls.indexOf('location.requestForegroundPermissionsAsync')
    const bgAt = calls.indexOf('location.requestBackgroundPermissionsAsync')
    expect(fgAt).toBeGreaterThanOrEqual(0)
    expect(bgAt).toBeGreaterThan(fgAt)
    expect(ok).toBe(true)
  })

  it('E2 foreground denied → background not requested, result is false', async () => {
    world().fg = 'undetermined'
    world().fgOnRequest = 'denied'
    world().bg = 'undetermined'
    const t = load()
    const ok = await t.ensureBackgroundPermission()
    expect(ok).toBe(false)
    expect(world().calls).not.toContain('location.requestBackgroundPermissionsAsync')
  })

  it('E already granted → true without prompting', async () => {
    const t = load()
    expect(await t.ensureBackgroundPermission()).toBe(true)
    expect(world().calls.filter((c) => c.startsWith('location.request'))).toEqual([])
  })
})
