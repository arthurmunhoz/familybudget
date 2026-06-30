/**
 * Calendar helpers: color-by-member palette, recurrence expansion, and the
 * little date/time formatters the Calendar screen needs.
 *
 * Dates are ISO `YYYY-MM-DD` strings end-to-end (compared lexicographically);
 * times are `HH:MM[:SS]` wall-clock strings. We never build Date objects to
 * compare dates — only to step months/years where the math needs it.
 */
import type { CalendarEvent, EventKind, EventRecurrence } from './types'

/** "Everyone" / no-owner events take the brand clay so they read as household-
 *  wide; members get the rest of the palette. All mid-tone so they stay legible
 *  on both the Paper (light) and Dusk (dark) themes. */
export const HOUSEHOLD_COLOR = '#c2603f'
export const MEMBER_PALETTE = [
  '#3f74c2', // blue
  '#3f9e74', // green
  '#b8863a', // gold
  '#9b5fb5', // purple
  '#cf5a7a', // rose
  '#3a9aa5', // teal
  '#c2783f', // orange
  '#6f8e3f', // olive
]

/** Emoji marker for the special date kinds carried over from Important Dates.
 *  A plain 'event' has none. */
export const KIND_EMOJI: Record<EventKind, string> = {
  event: '',
  birthday: '🎂',
  anniversary: '💍',
  renewal: '📋',
  other: '📌',
}

/** Stable color for a member: sort the household's emails and index into the
 *  palette, so each person keeps the same color across every screen + device. */
export function memberColor(email: string, memberEmails: string[]): string {
  const sorted = [...memberEmails].sort()
  const i = sorted.indexOf(email)
  return MEMBER_PALETTE[(i < 0 ? sorted.length : i) % MEMBER_PALETTE.length]
}

/** The color an event renders in: explicit override → owner's color → clay. */
export function eventColor(ev: CalendarEvent, memberEmails: string[]): string {
  if (ev.color) return ev.color
  if (ev.owner_email) return memberColor(ev.owner_email, memberEmails)
  return HOUSEHOLD_COLOR
}

// --- date math (local, kept here so format.ts stays money/period-focused) ---

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000)
}
/** Add n months, clamping the day to the target month's length (Jan 31 → Feb 28). */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, m - 1 + n, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  return toISO(new Date(base.getFullYear(), base.getMonth(), Math.min(d, lastDay)))
}

function nextRecurrence(iso: string, freq: EventRecurrence): string {
  switch (freq) {
    case 'daily':
      return addDays(iso, 1)
    case 'weekly':
      return addDays(iso, 7)
    case 'monthly':
      return addMonths(iso, 1)
    case 'yearly':
      return addMonths(iso, 12)
    default:
      return iso
  }
}

export interface Occurrence {
  event: CalendarEvent
  start: string // ISO date of this occurrence's first day
  end: string // ISO date of this occurrence's last day (inclusive)
}

/** Every occurrence of `events` whose span intersects [rangeStart, rangeEnd].
 *  Recurrence is expanded lazily, bounded to the window, so a daily event that
 *  started years ago doesn't blow up. */
export function occurrencesInRange(
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): Occurrence[] {
  const out: Occurrence[] = []
  for (const ev of events) {
    const duration = Math.max(0, daysBetween(ev.start_date, ev.end_date))
    // Earliest start that could still touch the window (multi-day events that
    // began before rangeStart but spill into it).
    const target = addDays(rangeStart, -duration)

    if (ev.recurrence === 'none') {
      if (ev.start_date <= rangeEnd && ev.end_date >= rangeStart) {
        out.push({ event: ev, start: ev.start_date, end: ev.end_date })
      }
      continue
    }

    // Fast-forward arithmetic for daily/weekly so we don't step day-by-day from
    // the distant past; monthly/yearly just step (few iterations over years).
    let cur = ev.start_date
    if (cur < target) {
      const gap = daysBetween(ev.start_date, target)
      if (ev.recurrence === 'daily') cur = addDays(ev.start_date, Math.max(0, gap))
      else if (ev.recurrence === 'weekly')
        cur = addDays(ev.start_date, Math.max(0, Math.floor(gap / 7)) * 7)
    }
    let guard = 0
    while (cur < target && guard++ < 2000) cur = nextRecurrence(cur, ev.recurrence)

    guard = 0
    while (cur <= rangeEnd && guard++ < 2000) {
      if (ev.recurrence_until && cur > ev.recurrence_until) break
      const occEnd = addDays(cur, duration)
      if (occEnd >= rangeStart) out.push({ event: ev, start: cur, end: occEnd })
      cur = nextRecurrence(cur, ev.recurrence)
    }
  }
  return out
}

/** Occurrences grouped by each ISO day they cover, within [rangeStart, rangeEnd]. */
export function occurrencesByDay(
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>()
  for (const occ of occurrencesInRange(events, rangeStart, rangeEnd)) {
    let day = occ.start < rangeStart ? rangeStart : occ.start
    const last = occ.end > rangeEnd ? rangeEnd : occ.end
    let guard = 0
    while (day <= last && guard++ < 400) {
      const arr = map.get(day)
      if (arr) arr.push(occ)
      else map.set(day, [occ])
      day = addDays(day, 1)
    }
  }
  return map
}

/** Years marked at an occurrence — age for a birthday, years for an anniversary.
 *  0 or negative if the stored start year wasn't a real past year. */
export function yearsAt(ev: CalendarEvent, occurrenceStartISO: string): number {
  return Number(occurrenceStartISO.slice(0, 4)) - Number(ev.start_date.slice(0, 4))
}

/** The single next occurrence (on/after today) of each event within `withinDays`,
 *  soonest first — the "what's coming up" list. Ongoing multi-day events count as
 *  upcoming until they end. */
export function upcomingOccurrences(
  events: CalendarEvent[],
  today: string,
  withinDays = 365,
): Occurrence[] {
  const all = occurrencesInRange(events, today, addDays(today, withinDays))
  const earliest = new Map<string, Occurrence>()
  for (const o of all) {
    if (o.end < today) continue
    const cur = earliest.get(o.event.id)
    if (!cur || o.start < cur.start) earliest.set(o.event.id, o)
  }
  return [...earliest.values()].sort((a, b) =>
    a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.event.title.localeCompare(b.event.title),
  )
}

/** Sort occurrences for an agenda: all-day first, then by start time. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.event.all_day !== b.event.all_day) return a.event.all_day ? -1 : 1
  const at = a.event.start_time ?? ''
  const bt = b.event.start_time ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.event.title.localeCompare(b.event.title)
}

/** "9:00 AM" from "09:00[:00]", localized. */
export function formatTime(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  })
}
