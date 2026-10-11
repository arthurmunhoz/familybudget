/**
 * SPEC §G — Whereabouts switched OFF on Android (the Android v1 default).
 *
 * The switch is WHEREABOUTS_ON_ANDROID in app.config.js. Off, the Android build
 * must not declare location in any form Google Play reviews, must not show the
 * feature, and must not run any of its background work — including work an
 * EARLIER build (a test APK) left registered on the phone. iOS is unaffected.
 */
import path from 'path'

import { fix, ME, positionWrites, resetWorld, seedSharing, world } from './helpers/world'

const ROOT = path.resolve(__dirname, '../..')
const LOCATION_PERMS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
]

/** app.config.js evaluated as EAS evaluates it, with NO override env var. */
function defaultConfig(): any {
  const saved = process.env.WHEREABOUTS_ANDROID
  delete process.env.WHEREABOUTS_ANDROID
  try {
    jest.resetModules()
    const appJson = require(path.join(ROOT, 'app.json'))
    const fn = require(path.join(ROOT, 'app.config.js'))
    return fn({ config: JSON.parse(JSON.stringify(appJson.expo)) })
  } finally {
    if (saved != null) process.env.WHEREABOUTS_ANDROID = saved
  }
}

function plugin(cfg: any, name: string): any[] | null {
  for (const p of cfg.plugins ?? []) {
    if (p === name) return [name, {}]
    if (Array.isArray(p) && p[0] === name) return p
  }
  return null
}

/** Run the config plugins' Android-manifest mods over a minimal merged manifest. */
async function manifestAfterMods(cfg: any): Promise<any> {
  const manifest = {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: {},
          service: [{ $: { 'android:name': 'expo.modules.location.services.LocationTaskService' } }],
        },
      ],
    },
  }
  let result: any = null
  for (const p of cfg.plugins ?? []) {
    if (typeof p !== 'function') continue
    const out = p({ ...cfg, mods: {} })
    const mod = out.mods?.android?.manifest
    if (mod) {
      const res = await mod({ ...out, modResults: manifest, modRequest: { platform: 'android' } })
      result = res.modResults
    }
  }
  return result ?? manifest
}

beforeEach(() => {
  resetWorld()
  world().whereabouts = false
})

describe('G1 — native config (default build)', () => {
  const cfg = defaultConfig()

  it('is OFF unless someone switches it on', () => {
    expect(cfg.extra?.whereaboutsAndroid).toBe(false)
  })

  it('declares no location permission and no foreground-service permission for it', () => {
    const perms: string[] = cfg.android.permissions ?? []
    for (const p of [...LOCATION_PERMS, 'android.permission.FOREGROUND_SERVICE']) expect(perms).not.toContain(p)
  })

  it('BLOCKS the location permissions libraries declare (Mapbox, expo-location)', () => {
    expect(cfg.android.blockedPermissions).toEqual(expect.arrayContaining(LOCATION_PERMS))
  })

  it('expo-location runs no Android background location / foreground service', () => {
    const opts = plugin(cfg, 'expo-location')![1]
    expect(opts.isAndroidBackgroundLocationEnabled).toBe(false)
    expect(opts.isAndroidForegroundServiceEnabled).toBe(false)
  })

  it("removes expo-location's location foreground service from the merged manifest", async () => {
    const m = await manifestAfterMods(cfg)
    const svc = m.manifest.application[0].service.find(
      (s: any) => s.$['android:name'] === 'expo.modules.location.services.LocationTaskService',
    )
    expect(svc.$['tools:node']).toBe('remove')
    expect(m.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools')
  })

  it('leaves iOS exactly as it was (background location mode + strings)', () => {
    expect(cfg.ios.infoPlist.UIBackgroundModes).toContain('location')
    expect(cfg.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeTruthy()
    expect(plugin(cfg, 'expo-location')![1].isIosBackgroundLocationEnabled).toBe(true)
  })

  it('switching it back on restores every Android declaration (one switch)', () => {
    process.env.WHEREABOUTS_ANDROID = '1'
    try {
      jest.resetModules()
      const appJson = require(path.join(ROOT, 'app.json'))
      const on = require(path.join(ROOT, 'app.config.js'))({ config: JSON.parse(JSON.stringify(appJson.expo)) })
      expect(on.extra.whereaboutsAndroid).toBe(true)
      expect(on.android.permissions).toEqual(expect.arrayContaining(LOCATION_PERMS))
      expect(on.android.blockedPermissions ?? []).not.toEqual(expect.arrayContaining(LOCATION_PERMS))
      expect((on.plugins ?? []).filter((p: unknown) => typeof p === 'function')).toHaveLength(0)
    } finally {
      delete process.env.WHEREABOUTS_ANDROID
    }
  })
})

describe('G2 — nothing of the feature is visible', () => {
  it('the hub has no Whereabouts tile (and the other apps are all still there)', () => {
    jest.resetModules()
    const { APPS } = require('@/lib/apps')
    const ids = APPS.map((a: { id: string }) => a.id)
    expect(ids).not.toContain('location')
    expect(ids).toEqual(expect.arrayContaining(['pings', 'calendar', 'budget', 'shopping', 'pets', 'docs', 'family', 'calc']))
  })

  it('switched on, the tile is back in its place', () => {
    world().whereabouts = true
    jest.resetModules()
    const { APPS } = require('@/lib/apps')
    expect(APPS.map((a: { id: string }) => a.id)[1]).toBe('location')
  })

  it('a tap on a place alert does not navigate to /location', async () => {
    jest.resetModules()
    const Notifications = require('expo-notifications')
    const { router } = require('expo-router')
    const push = jest.spyOn(router, 'push').mockImplementation(() => {})
    require('@/lib/backgroundNotifications').registerBackgroundNotifications()
    const onTap = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0]
    onTap({ notification: { request: { content: { data: { url: '/location' } } } } })
    onTap({ notification: { request: { content: { data: { url: '/pings' } } } } })
    await new Promise((r) => setTimeout(r, 5))
    expect(push.mock.calls.map((c) => c[0])).toEqual(['/pings'])
  })
})

describe('G3 — no background work, even left over from an earlier build', () => {
  it('a location fix from a leftover registration writes nothing and retires the task', async () => {
    seedSharing(true)
    jest.resetModules()
    const t = require('@/lib/locationTask')
    world().locationUpdates = { name: t.LOCATION_TASK, options: {} }
    world().registered.add(t.LOCATION_TASK)
    await world().tasks.get(t.LOCATION_TASK)!({
      data: { locations: [fix(27.3, -82.3, Date.now())] },
      error: null,
      executionInfo: { eventId: 'x', taskName: t.LOCATION_TASK },
    })
    expect(positionWrites()).toEqual([])
    expect(world().locationUpdates).toBeNull()
  })

  it('a geofence crossing from a leftover registration records nothing', async () => {
    seedSharing(true)
    jest.resetModules()
    const { GEOFENCE_TASK } = require('@/lib/placesTask')
    const recorded: unknown[] = []
    world().rpc.record_place_event = (args) => recorded.push(args)
    await world().tasks.get(GEOFENCE_TASK)!({
      data: { eventType: 1, region: { identifier: 'place-1' } },
      error: null,
      executionInfo: { eventId: 'g', taskName: GEOFENCE_TASK },
    })
    expect(recorded).toEqual([])
    expect(world().writes.filter((w) => w.table === 'place_events')).toEqual([])
  })

  it('a live-wake push captures nothing', async () => {
    seedSharing(true)
    world().db.location_live_requests = [
      { target_email: ME, expires_at: new Date(Date.now() + 60_000).toISOString() },
    ]
    jest.resetModules()
    await require('@/lib/locationTask').respondToLiveWake()
    expect(positionWrites()).toEqual([])
    expect(world().calls).not.toContain('location.getCurrentPositionAsync')
  })

  it('launch tears down a leftover location task and fences, and never starts new ones', async () => {
    seedSharing(true)
    jest.resetModules()
    const { LOCATION_TASK } = require('@/lib/locationTask')
    const { GEOFENCE_TASK } = require('@/lib/placesTask')
    world().locationUpdates = { name: LOCATION_TASK, options: {} }
    world().registered.add(LOCATION_TASK)
    world().geofences = { name: GEOFENCE_TASK, regions: [{ identifier: 'p' }] }
    world().registered.add(GEOFENCE_TASK)

    const React = require('react')
    const { create, act } = require('react-test-renderer')
    jest.doMock('@/lib/auth', () => ({ useAuth: () => ({ profile: { email: ME } }) }))
    jest.doMock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
    const { useLocationSync } = require('@/hooks/useLocationSync')
    const { useGeofenceSync } = require('@/hooks/useGeofenceSync')
    function Probe() {
      useLocationSync()
      useGeofenceSync()
      return null
    }
    await act(async () => {
      create(React.createElement(Probe))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(world().locationUpdates).toBeNull()
    expect(world().geofences).toBeNull()
    expect(world().calls).not.toContain('location.startLocationUpdatesAsync')
    // Account-wide state is NOT touched: sharing may belong to another device.
    expect(world().db.member_locations[0].sharing).toBe(true)
  })
})
