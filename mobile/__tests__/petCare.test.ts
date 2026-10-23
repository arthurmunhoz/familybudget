/**
 * Pet Care reminders: re-logging a treatment must retire the previous one's
 * due date, whichever type it was saved under. Real data had Aninha's
 * "Leptospirosis vaccine" logged as a vaccine in 2025 and as a medication in
 * 2026 — keyed on (pet, type, title) those were two series, so the first one's
 * reminder could never be cleared by logging the dose again.
 */
import { overdueEvents, reminderEvents } from '@/lib/petCare'
import type { PetEvent } from '@/lib/types'

let n = 0
function ev(p: Partial<PetEvent> & Pick<PetEvent, 'event_date'>): PetEvent {
  n += 1
  return {
    id: `e${n}`,
    pet_id: 'dog',
    type: 'medication',
    title: 'Numelvi',
    notes: null,
    next_due: null,
    created_at: `${p.event_date}T12:00:00Z`,
    ...p,
  } as PetEvent
}

/** The callers' contract: events arrive newest-first by event_date. */
const newestFirst = (events: PetEvent[]) => [...events].sort((a, b) => b.event_date.localeCompare(a.event_date))

describe('pet care reminders', () => {
  it('the latest dose sets the due date (every other day, two weeks of logs)', () => {
    const logs = []
    for (let d = 1; d <= 15; d += 2) {
      const day = `2026-10-${String(d).padStart(2, '0')}`
      const next = `2026-10-${String(d + 2).padStart(2, '0')}`
      logs.push(ev({ event_date: day, next_due: next }))
    }
    const due = reminderEvents(newestFirst(logs))
    expect(due).toHaveLength(1)
    expect(due[0].next_due).toBe('2026-10-17')
    expect(overdueEvents(newestFirst(logs), '2026-10-16')).toHaveLength(0)
  })

  it('a re-log saved under a different type still retires the old reminder', () => {
    const first = ev({ type: 'vaccine', title: 'Leptospirosis vaccine', event_date: '2025-07-27', next_due: '2026-07-27' })
    const again = ev({ type: 'medication', title: 'Leptospirosis vaccine', event_date: '2026-07-25', next_due: '2027-07-25' })
    const events = newestFirst([first, again])
    expect(reminderEvents(events).map((e) => e.next_due)).toEqual(['2027-07-25'])
    expect(overdueEvents(events, '2026-10-23')).toHaveLength(0)
  })

  it('title matching ignores case and extra spaces', () => {
    const first = ev({ title: 'Simpa  Trio', event_date: '2026-09-01', next_due: '2026-10-01' })
    const again = ev({ title: ' simpa trio', event_date: '2026-10-01', next_due: '2026-10-31' })
    expect(reminderEvents(newestFirst([first, again])).map((e) => e.id)).toEqual([again.id])
  })

  it('a re-log with no next due ends the series instead of leaving the old one overdue', () => {
    const first = ev({ event_date: '2026-09-01', next_due: '2026-09-03' })
    const last = ev({ event_date: '2026-09-03', next_due: null })
    expect(overdueEvents(newestFirst([first, last]), '2026-10-23')).toHaveLength(0)
  })

  it('different pets and different treatments stay separate', () => {
    const a = ev({ pet_id: 'a', event_date: '2026-10-01', next_due: '2026-10-03' })
    const b = ev({ pet_id: 'b', event_date: '2026-10-02', next_due: '2026-10-04' })
    const c = ev({ pet_id: 'a', title: 'Heartworm', event_date: '2026-10-02', next_due: '2026-11-02' })
    expect(reminderEvents(newestFirst([a, b, c]))).toHaveLength(3)
  })
})
