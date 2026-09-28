/**
 * SPEC §D — the background-location task handler, run as Android runs it
 * headless: a FRESH module registry, no UI, only a persisted session and the
 * database. §F — the live-wake path (a data-only push that asks this device
 * for a fresh fix while a family member is watching).
 */
import { fix, goBackground, ME, positionWrites, resetWorld, seedSharing, world } from './helpers/world'

type Handler = (body: any) => any

function headlessTask(): { handler: Handler; name: string; mod: typeof import('@/lib/locationTask') } {
  // A fresh registry = a fresh JS context: no module state survives from the UI.
  jest.resetModules()
  const mod: typeof import('@/lib/locationTask') = require('@/lib/locationTask')
  if (!world().tasks.has(mod.LOCATION_TASK)) mod.registerLocationTask()
  const handler = world().tasks.get(mod.LOCATION_TASK)
  if (!handler) throw new Error('location task was never defined')
  return { handler, name: mod.LOCATION_TASK, mod }
}

async function run(handler: Handler, name: string, body: { data?: any; error?: any }) {
  await handler({ data: body.data ?? null, error: body.error ?? null, executionInfo: { eventId: 'e1', taskName: name } })
  // let any fire-and-forget writes settle
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  resetWorld()
})

describe('D — background task handler (headless)', () => {
  it('D1 writes the NEWEST fix of a batch, once', async () => {
    seedSharing(true)
    const { handler, name } = headlessTask()
    const now = Date.now()
    await run(handler, name, {
      data: { locations: [fix(27.1, -82.1, now - 120_000), fix(27.3, -82.3, now), fix(27.2, -82.2, now - 60_000)] },
    })
    const w = positionWrites()
    expect(w).toHaveLength(1)
    const row = Array.isArray(w[0].payload) ? w[0].payload[0] : w[0].payload
    expect(row).toEqual(expect.objectContaining({ lat: 27.3, lng: -82.3 }))
    expect(row.accuracy).toBe(10)
    const stored = world().db.member_locations.find((r) => r.user_email === ME)
    expect(stored).toEqual(expect.objectContaining({ lat: 27.3, lng: -82.3 }))
  })

  it('D1 the stored row keeps sharing on', async () => {
    seedSharing(true)
    const { handler, name } = headlessTask()
    await run(handler, name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })
    const stored = world().db.member_locations.find((r) => r.user_email === ME)
    expect(stored?.sharing).toBe(true)
  })

  it('D2 an error payload does not throw and writes nothing', async () => {
    seedSharing(true)
    const { handler, name } = headlessTask()
    await expect(run(handler, name, { error: { code: 'E_LOCATION_UNAVAILABLE', message: 'x' } })).resolves.toBeUndefined()
    expect(positionWrites()).toEqual([])
  })

  it('D3 sharing turned off elsewhere → no position written', async () => {
    seedSharing(false)
    const { handler, name } = headlessTask()
    await run(handler, name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })
    expect(positionWrites()).toEqual([])
  })

  it('D3 paused → no position written', async () => {
    seedSharing(true, { paused_until: new Date(Date.now() + 3600_000).toISOString() })
    const { handler, name } = headlessTask()
    await run(handler, name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })
    expect(positionWrites()).toEqual([])
  })

  it('D4 signed out → no throw, no write', async () => {
    seedSharing(true)
    world().sessionEmail = null
    const { handler, name } = headlessTask()
    await expect(run(handler, name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })).resolves.toBeUndefined()
    expect(positionWrites()).toEqual([])
  })

  it('D5 two consecutive headless processes each write their first fix', async () => {
    seedSharing(true)
    let t = headlessTask()
    await run(t.handler, t.name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })
    t = headlessTask()
    await run(t.handler, t.name, { data: { locations: [fix(27.4, -82.4, Date.now() + 1000)] } })
    expect(positionWrites().length).toBe(2)
  })

  it('D6 a stationary phone still refreshes its row at least every 15 minutes', async () => {
    // Same spot, 20 min later: the family must see "updated just now", not "20 min ago".
    seedSharing(true)
    const { handler, name } = headlessTask()
    const t0 = Date.now()
    await run(handler, name, { data: { locations: [fix(27.3, -82.3, t0)] } })
    const spy = jest.spyOn(Date, 'now').mockReturnValue(t0 + 20 * 60_000)
    try {
      await run(handler, name, { data: { locations: [fix(27.3, -82.3, t0 + 20 * 60_000)] } })
    } finally {
      spy.mockRestore()
    }
    expect(positionWrites().length).toBe(2)
  })
})

describe('F — live wake', () => {
  function watchedBy(ms: number) {
    world().db.location_live_requests = [
      { requester_email: 'wife@example.com', target_email: ME, expires_at: new Date(Date.now() + ms).toISOString() },
    ]
  }

  it('F1 respondToLiveWake captures a fresh fix and writes it when sharing', async () => {
    seedSharing(true)
    watchedBy(1_500)
    world().position = fix(28.0, -82.0, Date.now())
    const { mod } = headlessTask()
    await mod.respondToLiveWake()
    await new Promise((r) => setTimeout(r, 0))
    const w = positionWrites()
    expect(w.length).toBeGreaterThanOrEqual(1)
    const row = Array.isArray(w[w.length - 1].payload) ? w[w.length - 1].payload[0] : w[w.length - 1].payload
    expect(row).toEqual(expect.objectContaining({ lat: 28.0, lng: -82.0 }))
  })

  it('F2 respondToLiveWake writes nothing when sharing is off', async () => {
    seedSharing(false)
    watchedBy(1_500)
    const { mod } = headlessTask()
    await mod.respondToLiveWake()
    expect(positionWrites()).toEqual([])
  })

  const LIVE = JSON.stringify({ type: 'live-wake', by: 'Paty' })
  // What expo-notifications hands the task on Android for a data-only FCM
  // message (RemoteMessageSerializer): Expo's `data` arrives as JSON in `body`,
  // mirrored to `dataString`; the notification part is null. The JobScheduler
  // delivery path wraps that same message under `notification`.
  const androidDirect = {
    data: { body: LIVE, dataString: LIVE, experienceId: '@oneroof/one-roof', scopeKey: '@oneroof/one-roof' },
    notification: null,
    from: '190924216094',
    priority: 1,
  }
  const androidJob = { notification: androidDirect }

  it.each([
    ['direct', androidDirect],
    ['job-wrapped', androidJob],
  ])('F3 an Android data-only live-wake push (%s), delivered headless, ends in a written fix', async (_n, data) => {
    seedSharing(true)
    watchedBy(1_500)
    world().position = fix(28.1, -82.1, Date.now())
    jest.resetModules()
    jest.isolateModules(() => {
      require('@/lib/backgroundNotifications').registerBackgroundNotifications()
    })
    const name = world().notificationTaskRegistered
    expect(name).toBeTruthy()
    const task = world().tasks.get(name!)
    expect(task).toBeTruthy()
    await task!({ data, error: null, executionInfo: { eventId: 'n1', taskName: name } })
    const w = positionWrites()
    expect(w.length).toBeGreaterThanOrEqual(1)
    const row = Array.isArray(w[0].payload) ? w[0].payload[0] : w[0].payload
    expect(row).toEqual(expect.objectContaining({ lat: 28.1, lng: -82.1 }))
  })

  it('F5 background live wake on Android: the ramp cannot take the service with it, and the burst still writes', async () => {
    seedSharing(true)
    watchedBy(1_500)
    world().position = fix(28.2, -82.2, Date.now())
    const { mod, name } = headlessTask()
    // The background task is already running (started from the foreground earlier).
    world().locationUpdates = { name, options: { foregroundService: { notificationTitle: 't', notificationBody: 'b' } } }
    world().registered.add(name)
    goBackground()
    await mod.respondToLiveWake()
    // ramped to the live cadence…
    expect(world().locationUpdates?.options.accuracy).toBe(4)
    // …and a fresh fix reached the database
    const w = positionWrites()
    expect(w.length).toBeGreaterThanOrEqual(1)
  })

  it('F6 relaxing after the watch ends, in the background, really steps down to the saver cadence', async () => {
    seedSharing(true)
    const { handler, name } = headlessTask()
    const AsyncStorage = require('@react-native-async-storage/async-storage')
    await AsyncStorage.setItem('oneroof-live-until', String(Date.now() - 1_000))
    world().locationUpdates = { name, options: { accuracy: 4, timeInterval: 5_000 } }
    world().registered.add(name)
    goBackground()
    await run(handler, name, { data: { locations: [fix(27.3, -82.3, Date.now())] } })
    expect(world().locationUpdates?.options.accuracy).toBe(3)
    expect(world().locationUpdates?.options.timeInterval).toBe(60_000)
  })

  it('F4 the iOS payload shape is still understood', () => {
    const { notificationTaskPayload } = require('@/lib/backgroundNotifications')
    expect(
      notificationTaskPayload({ notification: { request: { content: { data: { type: 'live-wake' } } } } }),
    ).toEqual({ type: 'live-wake' })
    expect(notificationTaskPayload(androidDirect)).toEqual({ type: 'live-wake', by: 'Paty' })
    expect(notificationTaskPayload(androidJob)).toEqual({ type: 'live-wake', by: 'Paty' })
    expect(notificationTaskPayload(null)).toBeUndefined()
  })
})
