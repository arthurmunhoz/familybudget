import type { Period } from './types'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function formatMoney(amount: number): string {
  return usd.format(amount)
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Whole days from a to b (positive when b is later) */
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000)
}

/** Inclusive last day of a period starting at startISO */
export function periodEndISO(period: Period, startISO: string): string {
  if (period === 'daily') return startISO
  if (period === 'weekly') return addDaysISO(startISO, 6)
  const d = parseISO(startISO)
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

export function periodLengthDays(period: Period, startISO: string): number {
  return daysBetweenISO(startISO, periodEndISO(period, startISO)) + 1
}

/** Short list label: "Jun 2026" / "Jun 8 – Jun 14, 2026" / "Jun 11, 2026" */
export function periodLabel(period: Period, startISO: string): string {
  const start = parseISO(startISO)
  if (period === 'monthly') {
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  if (period === 'weekly') {
    const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${startStr} – ${formatDay(periodEndISO('weekly', startISO))}`
  }
  return formatDay(startISO)
}

/** Long detail-page title: "June 2026" / "Week of Jun 8, 2026" / "Thursday, Jun 11, 2026" */
export function periodTitle(period: Period, startISO: string): string {
  const start = parseISO(startISO)
  if (period === 'monthly') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  if (period === 'weekly') return `Week of ${formatDay(startISO)}`
  return start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Start of the period containing today (weeks start on Sunday) */
export function currentPeriodStart(period: Period): string {
  const now = new Date()
  if (period === 'daily') return todayISO()
  if (period === 'weekly') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
    return toISO(d)
  }
  return toISO(new Date(now.getFullYear(), now.getMonth(), 1))
}

export function nextPeriodStart(period: Period, startISO: string): string {
  if (period === 'daily') return addDaysISO(startISO, 1)
  if (period === 'weekly') return addDaysISO(startISO, 7)
  const d = parseISO(startISO)
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

/** "Jun 9, 2026" from "2026-06-09" */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** "Mon, Jun 9" from "2026-06-09" — used for day section headers */
export function formatDayHeading(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function todayISO(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** "<1m" / "45m" / "2h 15m" from a number of seconds */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" from a timestamptz */
export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Pretty-print a US 10-digit phone as "(415) 555-0182" (or "+1 (…)" with a
 *  leading country code). Anything else (international, partial) is returned
 *  unchanged so non-US numbers aren't mangled. */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    const d = digits.slice(1)
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  return value.trim()
}
