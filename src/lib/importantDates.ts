import { daysBetweenISO } from './format'
import type { ImportantDate } from './types'

/** Clamp a month/day to a valid date in `year` (Feb 29 → Feb 28 on non-leap
 *  years), returned as YYYY-MM-DD. */
function clampMonthDay(year: number, month: number, day: number): string {
  const lastDay = new Date(year, month, 0).getDate()
  const d = Math.min(day, lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Next occurrence (YYYY-MM-DD) of a date:
 *  - repeats_annually: the next time its month/day lands on or after today
 *    (this year if still ahead, else next year).
 *  - one-time: the event_date itself (may be in the past = expired).
 * ISO date strings compare correctly lexicographically.
 */
export function nextOccurrence(d: ImportantDate, todayISO: string): string {
  if (!d.repeats_annually) return d.event_date
  const [, mm, dd] = d.event_date.split('-').map(Number)
  const thisYear = Number(todayISO.slice(0, 4))
  const candidate = clampMonthDay(thisYear, mm, dd)
  return candidate >= todayISO ? candidate : clampMonthDay(thisYear + 1, mm, dd)
}

/** Whole days from today until the next occurrence (negative = expired). */
export function daysUntil(d: ImportantDate, todayISO: string): number {
  return daysBetweenISO(todayISO, nextOccurrence(d, todayISO))
}

/** Years the entry will mark at its next occurrence (age for a birthday, years
 *  married for an anniversary). 0 or negative if no real past year was given. */
export function yearsAtNext(d: ImportantDate, todayISO: string): number {
  const startYear = Number(d.event_date.slice(0, 4))
  const occYear = Number(nextOccurrence(d, todayISO).slice(0, 4))
  return occYear - startYear
}

/** Count of entries needing attention: due within `within` days, or an expired
 *  one-time date. Drives the hub badge. */
export function dueSoonCount(dates: ImportantDate[], todayISO: string, within = 30): number {
  return dates.filter((d) => daysUntil(d, todayISO) <= within).length
}
