// Global fakes for the native modules Whereabouts talks to. Every fake reads
// and writes the shared `mockWorld()` (see world.ts), so a test sets up the device
// + backend state, runs app code, and asserts on what the "OS" and the
// "database" saw.
//
// Unknown members of a faked module resolve to an async no-op instead of
// throwing, so these tests don't have to know every helper the app calls — only
// the ones the spec is about.
import { world as mockWorld } from './world'

function mockModule(known: Record<string, any>) {
  const fallbacks: Record<string, any> = {}
  return new Proxy(known, {
    get(t, k) {
      if (k === '__esModule') return true
      if (typeof k === 'symbol') return undefined
      if (k in t) return t[k as string]
      if (k === 'default') return undefined
      return (fallbacks[k] ??= jest.fn(async () => undefined))
    },
  })
}

function mockPerm(status: string) {
  return {
    status,
    granted: status === 'granted',
    canAskAgain: mockWorld().canAskAgain,
    expires: 'never',
    android: { accuracy: 'fine' },
    ios: { scope: 'always' },
  }
}

jest.mock('expo-location', () => {
  const log = (s: string) => mockWorld().calls.push(`location.${s}`)
  return mockModule({
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
    ActivityType: { Other: 1, AutomotiveNavigation: 2, Fitness: 3, OtherNavigation: 4, Airborne: 5 },
    GeofencingEventType: { Enter: 1, Exit: 2 },
    GeofencingRegionState: { Unknown: 0, Inside: 1, Outside: 2 },
    PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
    getForegroundPermissionsAsync: jest.fn(async () => mockPerm(mockWorld().fg)),
    requestForegroundPermissionsAsync: jest.fn(async () => {
      log('requestForegroundPermissionsAsync')
      const w = mockWorld()
      w.fg = w.fgOnRequest ?? w.fg
      return mockPerm(w.fg)
    }),
    getBackgroundPermissionsAsync: jest.fn(async () => mockPerm(mockWorld().bg)),
    requestBackgroundPermissionsAsync: jest.fn(async () => {
      log('requestBackgroundPermissionsAsync')
      const w = mockWorld()
      // The OS refuses background without foreground (Android 11+ / iOS).
      if (w.fg !== 'granted') return mockPerm('denied')
      w.bg = w.bgOnRequest ?? w.bg
      return mockPerm(w.bg)
    }),
    getPermissionsAsync: jest.fn(async () => mockPerm(mockWorld().fg)),
    requestPermissionsAsync: jest.fn(async () => mockPerm(mockWorld().fg)),
    hasServicesEnabledAsync: jest.fn(async () => true),
    getProviderStatusAsync: jest.fn(async () => ({
      locationServicesEnabled: true,
      backgroundModeEnabled: true,
      gpsAvailable: true,
      networkAvailable: true,
      passiveAvailable: true,
    })),
    enableNetworkProviderAsync: jest.fn(async () => undefined),
    getCurrentPositionAsync: jest.fn(async () => {
      log('getCurrentPositionAsync')
      return mockWorld().position
    }),
    getLastKnownPositionAsync: jest.fn(async () => mockWorld().position),
    watchPositionAsync: jest.fn(async (_opts: any, cb: (pos: any) => void) => {
      const pos = mockWorld().position
      if (pos) cb(pos)
      return { remove: jest.fn() }
    }),
    reverseGeocodeAsync: jest.fn(async () => []),
    startLocationUpdatesAsync: jest.fn(async (name: string, options: any) => {
      log('startLocationUpdatesAsync')
      const w = mockWorld()
      // Mirrors expo-location's Android LocationModule: a foreground-service
      // start is refused unless the app is foregrounded.
      if (!w.foregrounded && options?.foregroundService) {
        throw new Error('ForegroundServiceStartNotAllowedException')
      }
      w.locationUpdates = { name, options: options ?? {} }
      w.registered.add(name)
    }),
    hasStartedLocationUpdatesAsync: jest.fn(async (name: string) => mockWorld().locationUpdates?.name === name),
    stopLocationUpdatesAsync: jest.fn(async (name: string) => {
      log('stopLocationUpdatesAsync')
      const w = mockWorld()
      if (w.locationUpdates?.name === name) w.locationUpdates = null
      w.registered.delete(name)
    }),
    startGeofencingAsync: jest.fn(async (name: string, regions: any[]) => {
      const w = mockWorld()
      w.geofences = { name, regions }
      w.registered.add(name)
    }),
    hasStartedGeofencingAsync: jest.fn(async (name: string) => mockWorld().geofences?.name === name),
    stopGeofencingAsync: jest.fn(async (name: string) => {
      const w = mockWorld()
      w.geofences = null
      w.registered.delete(name)
    }),
  })
})

jest.mock('expo-task-manager', () =>
  mockModule({
    defineTask: jest.fn((name: string, fn: any) => {
      mockWorld().tasks.set(name, fn)
    }),
    isTaskDefined: jest.fn((name: string) => mockWorld().tasks.has(name)),
    isTaskRegisteredAsync: jest.fn(async (name: string) => mockWorld().registered.has(name)),
    isAvailableAsync: jest.fn(async () => true),
    unregisterTaskAsync: jest.fn(async (name: string) => {
      mockWorld().registered.delete(name)
    }),
    unregisterAllTasksAsync: jest.fn(async () => mockWorld().registered.clear()),
    getRegisteredTasksAsync: jest.fn(async () =>
      [...mockWorld().registered].map((taskName) => ({ taskName, taskType: 'location', options: {} })),
    ),
    getTaskOptionsAsync: jest.fn(async (name: string) =>
      mockWorld().locationUpdates?.name === name ? mockWorld().locationUpdates!.options : null,
    ),
  }),
)

jest.mock('expo-notifications', () =>
  mockModule({
    AndroidImportance: { UNSPECIFIED: -1000, NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
    AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
    AndroidNotificationPriority: { MIN: 'min', LOW: 'low', DEFAULT: 'default', HIGH: 'high', MAX: 'max' },
    BackgroundNotificationTaskResult: { NewData: 1, NoData: 2, Failed: 3 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date', DAILY: 'daily' },
    registerTaskAsync: jest.fn(async (name: string) => {
      mockWorld().notificationTaskRegistered = name
      mockWorld().registered.add(name)
      return null
    }),
    unregisterTaskAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
    requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
    getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[test]' })),
    getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token' })),
    scheduleNotificationAsync: jest.fn(async () => 'local-id'),
    getLastNotificationResponseAsync: jest.fn(async () => null),
  }),
)

jest.mock('@/lib/supabase', () => require('./fakeSupabase'))

jest.mock('expo-battery', () =>
  mockModule({
    getBatteryLevelAsync: jest.fn(async () => 0.8),
    BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
  }),
)

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return mockModule({
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    AFTER_FIRST_UNLOCK: 0,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    WHEN_UNLOCKED: 2,
  })
})

jest.mock('@rnmapbox/maps', () => mockModule({ setAccessToken: jest.fn() }))
jest.mock('react-native-purchases', () => mockModule({}))

// The app's own API (live-wake, place alerts, …).
;(globalThis as any).fetch = jest.fn(async (url: string, init?: any) => {
  mockWorld().fetches.push({ url: String(url), init })
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }
})
