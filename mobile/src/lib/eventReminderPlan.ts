// Which calendar-event reminders this phone should have scheduled right now —
// pure, so it is unit-tested (__tests__/eventReminders.test.ts) without
// expo-notifications. lib/eventReminders.ts does the scheduling.
//
// `calendar_events.reminder_minutes` = how long BEFORE the start to remind
// (null = no reminder). A timed event starts at its start_time; an all-day
// one "starts" at ALL_DAY_AT (9:00) on its day, so 0 = 9:00 that day and
// 1440 = 9:00 the day before. Everything is in the PHONE'S local time.
//
// Who gets it: the event's owner, or everyone when it belongs to the whole
// household (owner_email null). Each phone schedules only its own.
import { occurrencesInRange } from './calendar'
import { addDaysISO } from './format'
import type { CalendarEvent } from './types'

/** The minutes an all-day event is treated as starting at (9:00). */
export const ALL_DAY_AT = 9 * 60
/** How far ahead to schedule; the app re-plans on every foreground. */
export const EVENT_REMINDER_DAYS = 14
/** iOS keeps at most 64 pending local notifications per app; pet reminders
 *  use up to 40 (petReminderPlan), so leave the rest for these. */
export const EVENT_REMINDER_MAX = 20

/** The choices the event form offers (minutes before). */
export const TIMED_REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440] as const
export const ALL_DAY_REMINDER_OPTIONS = [0, 1440, 2880, 10080] as const
export const DEFAULT_TIMED_REMINDER = 10
export const DEFAULT_ALL_DAY_REMINDER = 0

export interface PlannedEventReminder {
  /** Notification identifier: `evrem:<eventId>:<YYYY-MM-DD>`. */
  id: string
  eventId: string
  /** the occurrence's day (ISO) */
  day: string
  fireAt: Date
  minutes: number
  event: CalendarEvent
}

export const eventReminderId = (eventId: string, day: string): string => `evrem:${eventId}:${day}`
export const isEventReminderId = (id: string): boolean => id.startsWith('evrem:')

function startMinutes(ev: CalendarEvent): number {
  if (ev.all_day || !ev.start_time) return ALL_DAY_AT
  const [h, m] = ev.start_time.split(':').map(Number)
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m)
}

export function planEventReminders(
  events: CalendarEvent[],
  me: string,
  now: Date,
  today: string,
): PlannedEventReminder[] {
  const mine = events.filter(
    (e) => e.reminder_minutes != null && e.reminder_minutes >= 0 && (!e.owner_email || e.owner_email === me),
  )
  if (!mine.length) return []
  // Look a week past the window too: a "1 week before" reminder for an event
  // 20 days out fires within it.
  const maxLead = Math.max(...mine.map((e) => e.reminder_minutes ?? 0))
  const extraDays = Math.ceil(maxLead / 1440)
  const end = addDaysISO(today, EVENT_REMINDER_DAYS + extraDays)
  const horizon = now.getTime() + EVENT_REMINDER_DAYS * 86_400_000
  const out: PlannedEventReminder[] = []
  for (const occ of occurrencesInRange(mine, today, end)) {
    const ev = occ.event
    const [y, mo, d] = occ.start.split('-').map(Number)
    const s = startMinutes(ev)
    const minutes = ev.reminder_minutes ?? 0
    const fireAt = new Date(y, mo - 1, d, Math.floor(s / 60), s % 60 - minutes, 0, 0)
    const t = fireAt.getTime()
    if (t <= now.getTime() || t > horizon) continue
    out.push({ id: eventReminderId(ev.id, occ.start), eventId: ev.id, day: occ.start, fireAt, minutes, event: ev })
  }
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
  return out.slice(0, EVENT_REMINDER_MAX)
}
