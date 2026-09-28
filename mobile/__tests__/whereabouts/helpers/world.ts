// The simulated device + backend every Whereabouts test runs against.
//
// It lives on globalThis ON PURPOSE: the headless tests throw away the module
// registry (jest.isolateModules / resetModules) to model Android starting a
// fresh JS context, and the "device" and "database" must survive that — just
// like the real phone and the real Supabase do.

export type PermStatus = 'granted' | 'denied' | 'undetermined'
export type Row = Record<string, any>

export interface Write {
  table: string
  op: 'insert' | 'upsert' | 'update' | 'delete'
  payload: any
  options?: any
}

export interface World {
  // device
  fg: PermStatus
  bg: PermStatus
  /** What the OS answers when the app REQUESTS the permission (defaults to the current status). */
  fgOnRequest?: PermStatus
  bgOnRequest?: PermStatus
  canAskAgain: boolean
  position: { coords: Record<string, number | null>; timestamp: number } | null
  /** TaskManager.defineTask calls in the CURRENT JS context. */
  tasks: Map<string, (body: any) => any>
  /** Tasks the OS holds registrations for (survive JS restarts). */
  registered: Set<string>
  locationUpdates: { name: string; options: any } | null
  geofences: { name: string; regions: any[] } | null
  notificationTaskRegistered: string | null
  calls: string[]
  /** expo-location's AppForegroundedSingleton: false in a headless/background JS context. */
  foregrounded: boolean
  // backend
  sessionEmail: string | null
  db: Record<string, Row[]>
  writes: Write[]
  rpc: Record<string, (args: any) => any>
  fetches: { url: string; init?: any }[]
}

export function freshWorld(): World {
  return {
    fg: 'granted',
    bg: 'granted',
    canAskAgain: true,
    position: {
      coords: { latitude: 27.95, longitude: -82.46, accuracy: 12, speed: 0, altitude: 0, heading: 0, altitudeAccuracy: 0 },
      timestamp: Date.now(),
    },
    tasks: new Map(),
    registered: new Set(),
    locationUpdates: null,
    geofences: null,
    notificationTaskRegistered: null,
    calls: [],
    foregrounded: true,
    sessionEmail: ME,
    db: {},
    writes: [],
    rpc: {},
    fetches: [],
  }
}

export const ME = 'arthur@example.com'
export const HOUSEHOLD = '00000000-0000-0000-0000-00000000aaaa'

export function world(): World {
  const g = globalThis as any
  if (!g.__whereaboutsWorld) g.__whereaboutsWorld = freshWorld()
  return g.__whereaboutsWorld
}

export function resetWorld(): World {
  ;(globalThis as any).__whereaboutsWorld = freshWorld()
  return world()
}

/** My member_locations row with sharing on — the normal "I'm sharing" state. */
export function seedSharing(on = true, extra: Row = {}): void {
  world().db.member_locations = [
    {
      user_email: ME,
      household_id: HOUSEHOLD,
      lat: 27.9,
      lng: -82.4,
      accuracy: 20,
      speed: null,
      battery: 80,
      sharing: on,
      paused_until: null,
      updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      ...extra,
    },
  ]
}

/** Only the writes that carry a position into member_locations. */
export function positionWrites(): Write[] {
  return world().writes.filter((w) => {
    if (w.table !== 'member_locations' || w.op === 'delete') return false
    const rows = Array.isArray(w.payload) ? w.payload : [w.payload]
    return rows.some((r: Row) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
  })
}

/** Put the "device" in the background: expo-location's native foreground check
 *  and React Native's AppState both say so (call AFTER the app module is loaded,
 *  so it's the same react-native instance the module holds). */
export function goBackground(): void {
  setAppState('background')
}

/** The app is open on screen (the state a user-driven start/resume runs in). */
export function goForeground(): void {
  setAppState('active')
}

function setAppState(state: 'active' | 'background'): void {
  world().foregrounded = state === 'active'
  const { AppState } = require('react-native')
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true })
}

export function fix(lat: number, lng: number, timestamp: number, accuracy = 10) {
  return {
    coords: { latitude: lat, longitude: lng, accuracy, speed: 1, altitude: 0, heading: 0, altitudeAccuracy: 0 },
    timestamp,
  }
}
