/**
 * Calendar Day/Week layout (apps/calendar/calendarLayout.ts): overlapping
 * events side by side, multi-day timed events clipped per day, all-day bars
 * packed into rows, Sunday-first weeks.
 */
import { allDayRows, layoutColumns, timedBlocks, weekStart } from '@/apps/calendar/calendarLayout'
import type { Occurrence } from '@/lib/calendar'
import type { CalendarEvent } from '@/lib/types'

let n = 0
function occ(p: Partial<CalendarEvent> & { start?: string; end?: string }): Occurrence {
  const start = p.start ?? '2026-11-11'
  const end = p.end ?? start
  const event = {
    id: `e${++n}`,
    title: p.title ?? `e${n}`,
    start_date: start,
    end_date: end,
    all_day: p.all_day ?? false,
    start_time: p.start_time ?? null,
    end_time: p.end_time ?? null,
  } as CalendarEvent
  return { event, start, end }
}

describe('calendar layout', () => {
  it('puts overlapping events side by side and lets a lone one take the width', () => {
    const a = occ({ start_time: '09:00:00', end_time: '10:00:00', title: 'a' })
    const b = occ({ start_time: '09:30:00', end_time: '11:00:00', title: 'b' })
    const c = occ({ start_time: '10:00:00', end_time: '10:30:00', title: 'c' })
    const d = occ({ start_time: '14:00:00', end_time: '15:00:00', title: 'd' })
    const placed = layoutColumns(timedBlocks([a, b, c, d], '2026-11-11'))
    const by = (t: string) => placed.find((p) => p.occ.event.title === t)!
    expect(by('a')).toMatchObject({ col: 0, cols: 2, span: 1 })
    expect(by('b')).toMatchObject({ col: 1, cols: 2, span: 1 })
    // c starts when a ends → reuses column 0
    expect(by('c')).toMatchObject({ col: 0, cols: 2 })
    expect(by('d')).toMatchObject({ col: 0, cols: 1, span: 1 })
  })

  it('stretches a block over free columns to its right', () => {
    const a = occ({ start_time: '09:00:00', end_time: '12:00:00', title: 'a' })
    const b = occ({ start_time: '09:00:00', end_time: '10:00:00', title: 'b' })
    const c = occ({ start_time: '09:00:00', end_time: '10:00:00', title: 'c' })
    const d = occ({ start_time: '10:30:00', end_time: '11:00:00', title: 'd' })
    const placed = layoutColumns(timedBlocks([a, b, c, d], '2026-11-11'))
    const by = (t: string) => placed.find((p) => p.occ.event.title === t)!
    expect(by('a').cols).toBe(3)
    expect(by('d')).toMatchObject({ col: 1, span: 2 })
  })

  it('clips multi-day timed events to each day and gives short ones a minimum size', () => {
    const o = occ({ start: '2026-11-10', end: '2026-11-12', start_time: '20:00:00', end_time: '08:00:00' })
    expect(timedBlocks([o], '2026-11-10')[0]).toMatchObject({ start: 1200, end: 1440 })
    expect(timedBlocks([o], '2026-11-11')[0]).toMatchObject({ start: 0, end: 1440 })
    expect(timedBlocks([o], '2026-11-12')[0]).toMatchObject({ start: 0, end: 480 })
    const quick = occ({ start_time: '09:00:00', end_time: '09:05:00' })
    expect(timedBlocks([quick], '2026-11-11')[0]).toMatchObject({ start: 540, end: 570 })
    const noEnd = occ({ start_time: '09:00:00' })
    expect(timedBlocks([noEnd], '2026-11-11')[0]).toMatchObject({ start: 540, end: 600 })
  })

  it('packs all-day bars into rows across the week', () => {
    const days = Array.from({ length: 7 }, (_, i) => `2026-11-${String(8 + i).padStart(2, '0')}`)
    const trip = occ({ all_day: true, start: '2026-11-06', end: '2026-11-10', title: 'trip' })
    const bday = occ({ all_day: true, start: '2026-11-09', title: 'bday' })
    const later = occ({ all_day: true, start: '2026-11-13', title: 'later' })
    const bars = allDayRows([trip, bday, bday, later], days)
    expect(bars).toHaveLength(3)
    const by = (t: string) => bars.find((b) => b.occ.event.title === t)!
    expect(by('trip')).toMatchObject({ from: 0, to: 2, row: 0 })
    expect(by('bday')).toMatchObject({ from: 1, to: 1, row: 1 })
    expect(by('later')).toMatchObject({ from: 5, to: 5, row: 0 })
  })

  it('starts weeks on Sunday', () => {
    expect(weekStart('2026-11-11')).toBe('2026-11-08')
    expect(weekStart('2026-11-08')).toBe('2026-11-08')
    expect(weekStart('2026-03-01')).toBe('2026-03-01')
    expect(weekStart('2026-01-01')).toBe('2025-12-28')
  })
})
