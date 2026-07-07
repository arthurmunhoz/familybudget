// Apple Calendar (iCloud) two-way sync — ON-DEVICE via EventKit (expo-calendar).
//
// Apple has NO server calendar API (Sign in with Apple is auth-only), so unlike
// Google there are no OAuth tokens, no Vercel endpoints, and no connections
// table. Everything here runs on the iPhone: we request Calendar permission,
// read the user's device calendars (which include their iCloud calendars) and
// mirror them into `calendar_events` (source='apple', owner = this member), and
// push this member's One Roof events out to a dedicated "One Roof" device
// calendar. Connection state + the oneroof→device id map are per-device, in
// AsyncStorage (a device event id is only meaningful on that device).
//
// Pulled rows render read-only in the app (Calendar.tsx treats source!=='oneroof'
// as external). Recurring device events come back as expanded instances, so each
// occurrence is stored as its own non-recurring row (apple_event_id = id#start).
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
// expo-calendar 56.0.9 deprecated the classic promise-based API at the
// package root (calling it now rejects with a deprecation notice instead of
// running) — the exact same functions still work unchanged from the /legacy
// subpath, which is what this whole file is built against.
import * as Calendar from 'expo-calendar/legacy'

import { supabase } from './supabase'
import type { CalendarEvent, EventRecurrence } from './types'

export const isAppleCalendarAvailable = Platform.OS === 'ios'

// expo-calendar doesn't re-export its `Event` type at the namespace top level,
// so derive what we need from the function signatures.
type DeviceEvent = Awaited<ReturnType<typeof Calendar.getEventsAsync>>[number]
type EventDetails = NonNullable<Parameters<typeof Calendar.createEventAsync>[1]>

/** How far back / forward we mirror events, in days. */
const WINDOW_BACK = 30
const WINDOW_FWD = 180
const ONE_ROOF_CALENDAR_TITLE = 'One Roof'

export interface AppleConnection {
  connected: boolean
  lastSyncedAt: string | null
  calendarCount: number
}

interface ConnState {
  connected: boolean
  sourceCalendarIds: string[]
  oneRoofCalendarId: string | null
  lastSyncedAt: string | null
}

type PushMap = Record<string, { deviceId: string; syncedAt: string }>

// ── Local (per-device, per-user) state ───────────────────────────────────────
async function currentUser(): Promise<{ email: string; household_id: string } | null> {
  // getSession() reads the cached local session (no network round-trip); unlike
  // getUser() (which re-validates against the Auth server), it can't fail on a
  // flaky connection and turn into a false "not signed in" mid-sync.
  const { data: s } = await supabase.auth.getSession()
  const email = s.session?.user.email
  if (!email) return null
  const { data } = await supabase
    .from('allowed_users')
    .select('household_id')
    .eq('email', email)
    .maybeSingle()
  const household_id = (data as { household_id?: string } | null)?.household_id
  if (!household_id) return null
  return { email, household_id }
}

function connKey(email: string) {
  return `apple_cal_conn:${email}`
}
function pushKey(email: string) {
  return `apple_cal_pushmap:${email}`
}

async function readConn(email: string): Promise<ConnState> {
  try {
    const raw = await AsyncStorage.getItem(connKey(email))
    if (raw) return JSON.parse(raw) as ConnState
  } catch {
    /* fall through to default */
  }
  return { connected: false, sourceCalendarIds: [], oneRoofCalendarId: null, lastSyncedAt: null }
}
async function writeConn(email: string, s: ConnState): Promise<void> {
  await AsyncStorage.setItem(connKey(email), JSON.stringify(s))
}
async function readPushMap(email: string): Promise<PushMap> {
  try {
    const raw = await AsyncStorage.getItem(pushKey(email))
    if (raw) return JSON.parse(raw) as PushMap
  } catch {
    /* fall through */
  }
  return {}
}
async function writePushMap(email: string, m: PushMap): Promise<void> {
  await AsyncStorage.setItem(pushKey(email), JSON.stringify(m))
}

// ── Date helpers (calendar_events use local ISO dates + wall-clock times) ─────
function localDate(iso: string, time?: string | null): Date {
  const [y, mo, da] = iso.split('-').map(Number)
  if (time) {
    const [h, mi, s] = time.split(':').map(Number)
    return new Date(y, mo - 1, da, h, mi || 0, s || 0)
  }
  return new Date(y, mo - 1, da)
}
function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}
function hms(d: Date): string {
  return d.toTimeString().slice(0, 8)
}
function addDays(iso: string, n: number): string {
  const d = localDate(iso)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

const FREQ: Record<Exclude<EventRecurrence, 'none'>, Calendar.Frequency> = {
  daily: Calendar.Frequency.DAILY,
  weekly: Calendar.Frequency.WEEKLY,
  monthly: Calendar.Frequency.MONTHLY,
  yearly: Calendar.Frequency.YEARLY,
}

// ── Connect ──────────────────────────────────────────────────────────────────
/** Request Calendar permission, choose which device calendars to mirror, ensure
 *  the writable "One Roof" device calendar exists, then run a first sync.
 *  Returns false if the user denied permission; throws on unexpected failure. */
export async function connectAppleCalendar(): Promise<boolean> {
  if (!isAppleCalendarAvailable) return false
  const who = await currentUser()
  if (!who) throw new Error('Not signed in')

  const perm = await Calendar.requestCalendarPermissionsAsync()
  if (perm.status !== 'granted') return false

  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)

  // Ensure our dedicated writable calendar exists (created once, reused after).
  let oneRoofId = cals.find((c) => c.title === ONE_ROOF_CALENDAR_TITLE)?.id ?? null
  if (!oneRoofId) {
    try {
      const def = await Calendar.getDefaultCalendarAsync()
      oneRoofId = await Calendar.createCalendarAsync({
        title: ONE_ROOF_CALENDAR_TITLE,
        name: ONE_ROOF_CALENDAR_TITLE,
        color: '#C2603F',
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: def.source?.id,
        source: def.source,
        ownerAccount: 'personal',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      })
    } catch {
      // Couldn't create our calendar — import still works, push is skipped.
      oneRoofId = null
    }
  }

  // Mirror from every event calendar except our own (avoids re-importing pushes).
  const sourceCalendarIds = cals
    .filter((c) => c.id !== oneRoofId && c.title !== ONE_ROOF_CALENDAR_TITLE)
    .map((c) => c.id)

  await writeConn(who.email, {
    connected: true,
    sourceCalendarIds,
    oneRoofCalendarId: oneRoofId,
    lastSyncedAt: null,
  })
  await syncAppleCalendar()
  return true
}

// ── Sync ─────────────────────────────────────────────────────────────────────
export async function syncAppleCalendar(): Promise<void> {
  if (!isAppleCalendarAvailable) return
  const who = await currentUser()
  if (!who) return
  const state = await readConn(who.email)
  if (!state.connected) return

  const now = new Date()
  const start = new Date(now.getTime() - WINDOW_BACK * 86400000)
  const end = new Date(now.getTime() + WINDOW_FWD * 86400000)
  const windowStart = isoDay(start)
  const windowEnd = isoDay(end)

  await pullFromDevice(who, state, start, end, windowStart, windowEnd)
  await pushToDevice(who, state, windowStart, windowEnd)

  state.lastSyncedAt = new Date().toISOString()
  await writeConn(who.email, state)
}

async function pullFromDevice(
  who: { email: string; household_id: string },
  state: ConnState,
  start: Date,
  end: Date,
  windowStart: string,
  windowEnd: string,
): Promise<void> {
  if (state.sourceCalendarIds.length === 0) return
  let events: DeviceEvent[] = []
  try {
    events = await Calendar.getEventsAsync(state.sourceCalendarIds, start, end)
  } catch {
    return
  }

  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    const s = new Date(ev.startDate)
    const e = new Date(ev.endDate)
    if (isNaN(s.getTime())) continue
    let start_date: string
    let end_date: string
    let start_time: string | null = null
    let end_time: string | null = null
    if (ev.allDay) {
      start_date = isoDay(s)
      // EventKit all-day end is exclusive next-midnight; inclusive last day = e-1ms.
      end_date = isNaN(e.getTime()) ? start_date : isoDay(new Date(e.getTime() - 1))
      if (end_date < start_date) end_date = start_date
    } else {
      start_date = isoDay(s)
      end_date = isNaN(e.getTime()) ? start_date : isoDay(e)
      start_time = hms(s)
      end_time = isNaN(e.getTime()) ? start_time : hms(e)
    }
    // Recurring events expand to multiple instances sharing ev.id — key each
    // occurrence by its start so they don't collide on the unique index.
    const appleId = `${ev.id}#${s.toISOString()}`
    if (seen.has(appleId)) continue
    seen.add(appleId)
    rows.push({
      household_id: who.household_id,
      title: ev.title || '(no title)',
      start_date,
      end_date,
      all_day: !!ev.allDay,
      start_time,
      end_time,
      location: ev.location || null,
      notes: ev.notes || null,
      owner_email: who.email,
      color: null,
      recurrence: 'none',
      recurrence_until: null,
      kind: 'event',
      reminder_minutes: null,
      source: 'apple',
      apple_event_id: appleId,
    })
  }

  if (rows.length) {
    await supabase
      .from('calendar_events')
      .upsert(rows, { onConflict: 'household_id,apple_event_id' })
  }

  // Prune my apple rows in-window that no longer exist on the device.
  const { data: existing } = await supabase
    .from('calendar_events')
    .select('apple_event_id')
    .eq('source', 'apple')
    .eq('owner_email', who.email)
    .gte('start_date', windowStart)
    .lte('start_date', windowEnd)
  const stale = (existing ?? [])
    .map((r) => (r as { apple_event_id: string }).apple_event_id)
    .filter((id) => id && !seen.has(id))
  if (stale.length) {
    await supabase
      .from('calendar_events')
      .delete()
      .eq('source', 'apple')
      .eq('owner_email', who.email)
      .in('apple_event_id', stale)
  }
}

async function pushToDevice(
  who: { email: string; household_id: string },
  state: ConnState,
  windowStart: string,
  windowEnd: string,
): Promise<void> {
  if (!state.oneRoofCalendarId) return
  const calId = state.oneRoofCalendarId
  const map = await readPushMap(who.email)

  // My One Roof-authored events overlapping the window.
  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('source', 'oneroof')
    .eq('created_by', who.email)
    .lte('start_date', windowEnd)
    .gte('end_date', windowStart)
  const events = (data ?? []) as CalendarEvent[]
  const live = new Set<string>()

  for (const ev of events) {
    live.add(ev.id)
    const details = eventToDeviceDetails(ev)
    const known = map[ev.id]
    try {
      if (!known) {
        const deviceId = await Calendar.createEventAsync(calId, details)
        map[ev.id] = { deviceId, syncedAt: ev.created_at }
      } else if ((ev.created_at || '') > known.syncedAt || known.syncedAt === '') {
        // created_at is stable; we refresh on any change via updated timestamp below.
        await Calendar.updateEventAsync(known.deviceId, details)
        map[ev.id] = { deviceId: known.deviceId, syncedAt: new Date().toISOString() }
      } else {
        await Calendar.updateEventAsync(known.deviceId, details)
      }
    } catch {
      // Device event vanished (user deleted it) — forget the mapping so a later
      // sync recreates it.
      delete map[ev.id]
    }
  }

  // Events I removed in One Roof → remove from the device.
  for (const oneroofId of Object.keys(map)) {
    if (!live.has(oneroofId)) {
      try {
        await Calendar.deleteEventAsync(map[oneroofId].deviceId)
      } catch {
        /* already gone */
      }
      delete map[oneroofId]
    }
  }

  await writePushMap(who.email, map)
}

function eventToDeviceDetails(ev: CalendarEvent): EventDetails {
  const startDate = localDate(ev.start_date, ev.all_day ? null : ev.start_time)
  let endDate: Date
  if (ev.all_day) {
    endDate = localDate(addDays(ev.end_date, 1))
  } else {
    endDate = localDate(ev.end_date, ev.end_time || ev.start_time)
    if (endDate.getTime() <= startDate.getTime()) {
      endDate = new Date(startDate.getTime() + 3600000)
    }
  }
  const details: EventDetails = {
    title: ev.title,
    startDate,
    endDate,
    allDay: ev.all_day,
    location: ev.location || undefined,
    notes: ev.notes || undefined,
  }
  if (ev.recurrence !== 'none') {
    details.recurrenceRule = {
      frequency: FREQ[ev.recurrence],
      ...(ev.recurrence_until
        ? { endDate: localDate(ev.recurrence_until, '23:59:59') }
        : {}),
    }
  }
  if (ev.reminder_minutes != null) {
    details.alarms = [{ relativeOffset: -ev.reminder_minutes }]
  }
  return details
}

// ── Status / disconnect ──────────────────────────────────────────────────────
export async function getAppleConnection(): Promise<AppleConnection | null> {
  if (!isAppleCalendarAvailable) return null
  const who = await currentUser()
  if (!who) return null
  const state = await readConn(who.email)
  if (!state.connected) return null
  return {
    connected: true,
    lastSyncedAt: state.lastSyncedAt,
    calendarCount: state.sourceCalendarIds.length,
  }
}

/** Forget the connection: drop this member's imported apple rows, delete the
 *  events we pushed to the device, and clear local state. Leaves the user's own
 *  iCloud calendars untouched. */
export async function disconnectAppleCalendar(): Promise<void> {
  if (!isAppleCalendarAvailable) return
  const who = await currentUser()
  if (!who) return

  // Remove events we pushed onto the device.
  const map = await readPushMap(who.email)
  for (const oneroofId of Object.keys(map)) {
    try {
      await Calendar.deleteEventAsync(map[oneroofId].deviceId)
    } catch {
      /* ignore */
    }
  }

  await supabase
    .from('calendar_events')
    .delete()
    .eq('source', 'apple')
    .eq('owner_email', who.email)

  await AsyncStorage.multiRemove([connKey(who.email), pushKey(who.email)])
}
