// Pure layout math for the Calendar's Day / Week time grids (no React).
//
// - `timedBlocks(occs, day)`: the timed occurrences that touch `day`, as minute
//   ranges on that day's 0–1440 axis (a multi-day timed event runs to midnight
//   on its first day, fills the middle days and starts at midnight on the last).
// - `layoutColumns(blocks)`: the overlap layout — events that overlap sit side
//   by side. Blocks are grouped into clusters (chains of overlap); inside a
//   cluster each block takes the first column that is free at its start, and
//   then stretches right over any columns no overlapping block uses.
// - `allDayRows(occs, days)`: all-day (and multi-day all-day) occurrences as
//   bars across the visible columns, packed into the fewest rows.
//
// Dates are ISO `YYYY-MM-DD` strings compared lexicographically, as everywhere.
import type { Occurrence } from '@/lib/calendar'

/** Shortest drawn block, in minutes — a 5-minute event still needs a tappable,
 *  readable box, and the overlap test uses the drawn size so boxes never sit
 *  on top of each other. */
export const MIN_BLOCK_MIN = 30

export interface TimedBlock {
  occ: Occurrence
  /** minutes from midnight on this day */
  start: number
  end: number
}

export interface PlacedBlock extends TimedBlock {
  col: number
  /** how many columns this block spans (≥1) */
  span: number
  /** columns in its overlap cluster */
  cols: number
}

export const toMinutes = (hhmm: string | null | undefined): number | null => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return null
  return h * 60 + (Number.isNaN(m) ? 0 : m)
}

/** `minMin`: the shortest a block may be drawn, in minutes — the grid raises
 *  it when hours are short so a one-line title always fits (and blocks that
 *  would then touch sit side by side instead of covering each other). */
export function timedBlocks(occs: Occurrence[], day: string, minMin: number = MIN_BLOCK_MIN): TimedBlock[] {
  const out: TimedBlock[] = []
  for (const occ of occs) {
    const ev = occ.event
    if (ev.all_day) continue
    if (occ.start > day || occ.end < day) continue
    const s = toMinutes(ev.start_time) ?? 0
    let e = toMinutes(ev.end_time)
    const first = occ.start === day
    const last = occ.end === day
    let start = first ? s : 0
    let end: number
    if (last) {
      // Same-day event with no (or a non-advancing) end → one hour.
      if (e == null || (first && e <= s)) e = s + 60
      end = first ? e : (e ?? 1440)
    } else {
      end = 1440
    }
    start = Math.max(0, Math.min(start, 1440 - minMin))
    end = Math.min(1440, Math.max(end, start + minMin))
    out.push({ occ, start, end })
  }
  return out
}

export function layoutColumns(blocks: TimedBlock[]): PlacedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end || a.occ.event.title.localeCompare(b.occ.event.title))
  const placed: PlacedBlock[] = []
  let cluster: PlacedBlock[] = []
  let colEnds: number[] = [] // per column: when its last block ends
  let clusterEnd = -1

  const flush = () => {
    const cols = colEnds.length
    for (const b of cluster) {
      b.cols = cols
      // Stretch right while no block in the next column overlaps this one.
      let span = 1
      for (let c = b.col + 1; c < cols; c++) {
        const blocked = cluster.some((o) => o.col === c && o.start < b.end && o.end > b.start)
        if (blocked) break
        span++
      }
      b.span = span
    }
    placed.push(...cluster)
    cluster = []
    colEnds = []
    clusterEnd = -1
  }

  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush()
    let col = colEnds.findIndex((end) => end <= b.start)
    if (col < 0) {
      col = colEnds.length
      colEnds.push(b.end)
    } else {
      colEnds[col] = b.end
    }
    cluster.push({ ...b, col, span: 1, cols: 1 })
    clusterEnd = Math.max(clusterEnd, b.end)
  }
  if (cluster.length) flush()
  return placed
}

export interface AllDayBar {
  occ: Occurrence
  /** first and last visible column it covers (inclusive) */
  from: number
  to: number
  row: number
}

/** All-day occurrences as bars over `days` (the visible columns, in order). */
export function allDayRows(occs: Occurrence[], days: string[]): AllDayBar[] {
  const first = days[0]
  const last = days[days.length - 1]
  const seen = new Set<string>()
  const items: Omit<AllDayBar, 'row'>[] = []
  for (const occ of occs) {
    if (!occ.event.all_day) continue
    const key = `${occ.event.id}:${occ.start}`
    if (seen.has(key)) continue
    seen.add(key)
    if (occ.start > last || occ.end < first) continue
    const from = days.findIndex((d) => d >= occ.start)
    let to = days.length - 1
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] <= occ.end) {
        to = i
        break
      }
    }
    if (from < 0 || to < from) continue
    items.push({ occ, from, to })
  }
  // Longest first, then by start — the classic packing that keeps spans on top.
  items.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from || a.occ.event.title.localeCompare(b.occ.event.title))
  const rows: boolean[][] = []
  return items.map((it) => {
    let row = 0
    for (; ; row++) {
      if (!rows[row]) rows[row] = Array(days.length).fill(false)
      let free = true
      for (let c = it.from; c <= it.to; c++) if (rows[row][c]) free = false
      if (free) break
    }
    for (let c = it.from; c <= it.to; c++) rows[row][c] = true
    return { ...it, row }
  })
}

/** Sunday of the week containing `iso` (the grid is Sunday-first). */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(d - date.getDay())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "HH:MM" for minutes from midnight (clamped to the day). */
export function minutesToHHMM(min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
