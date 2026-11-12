/**
 * Pet routine reminders (migration 098): which local notifications a phone
 * schedules. A reminder fires remind_at + grace on each day, in the phone's
 * local time, unless the task is already marked for that day; interval
 * routines only on days they are due.
 */
import {
  PET_REMINDER_GRACE_MIN,
  PET_REMINDER_MAX,
  parseRemindAt,
  planPetReminders,
  remindAtHHMM,
} from '@/lib/petReminderPlan'
import type { PetCareTask, PetTaskDone } from '@/lib/types'

function task(p: Partial<PetCareTask> & Pick<PetCareTask, 'id'>): PetCareTask {
  return {
    pet_id: 'lola',
    kind: 'daily',
    title: 'Morning food',
    icon: 'bowl',
    interval_days: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    remind_at: '08:00:00',
    ...p,
  }
}
const done = (task_id: string, done_on: string): PetTaskDone => ({
  id: `${task_id}-${done_on}`,
  task_id,
  done_on,
  done_by: 'a@b.c',
  created_at: '',
})

const TODAY = '2026-11-11'
const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m)

describe('parseRemindAt', () => {
  it('reads Postgres time and HH:MM', () => {
    expect(parseRemindAt('08:00:00')).toEqual([8, 0])
    expect(parseRemindAt('7:30')).toEqual([7, 30])
    expect(remindAtHHMM('19:05:00')).toBe('19:05')
  })
  it('rejects empty and nonsense', () => {
    expect(parseRemindAt(null)).toBeNull()
    expect(parseRemindAt(undefined)).toBeNull()
    expect(parseRemindAt('25:00')).toBeNull()
    expect(remindAtHHMM('x')).toBeNull()
  })
})

describe('planPetReminders', () => {
  it('fires grace minutes after the time, today and the next two days', () => {
    const plan = planPetReminders([task({ id: 't' })], [], at(7), TODAY)
    expect(plan.map((p) => p.day)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13'])
    expect(plan[0].fireAt).toEqual(new Date(2026, 10, 11, 8, PET_REMINDER_GRACE_MIN))
    expect(plan[0].id).toBe('petrem:t:2026-11-11')
  })

  it('skips a day already marked — someone fed her before the reminder', () => {
    const plan = planPetReminders([task({ id: 't' })], [done('t', TODAY)], at(7), TODAY)
    expect(plan.map((p) => p.day)).toEqual(['2026-11-12', '2026-11-13'])
  })

  it('never fires late: past today’s moment, today is dropped', () => {
    const plan = planPetReminders([task({ id: 't' })], [], at(9), TODAY)
    expect(plan[0].day).toBe('2026-11-12')
  })

  it('ignores tasks without a time', () => {
    expect(planPetReminders([task({ id: 't', remind_at: null })], [], at(7), TODAY)).toEqual([])
    expect(planPetReminders([task({ id: 't', remind_at: undefined })], [], at(7), TODAY)).toEqual([])
  })

  it('interval routines only on the days they are due', () => {
    // Bath every 3 days, last on the 9th → due the 12th.
    const bath = task({ id: 'b', kind: 'interval', interval_days: 3, remind_at: '18:00:00' })
    const plan = planPetReminders([bath], [done('b', '2026-11-09')], at(7), TODAY)
    expect(plan.map((p) => p.day)).toEqual(['2026-11-12', '2026-11-13'])
  })

  it('interval routine overdue reminds every day until marked', () => {
    const bath = task({ id: 'b', kind: 'interval', interval_days: 3, remind_at: '18:00:00' })
    const plan = planPetReminders([bath], [done('b', '2026-11-01')], at(7), TODAY)
    expect(plan).toHaveLength(3)
  })

  it('caps the total, soonest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => task({ id: `t${i}`, remind_at: `${8 + (i % 10)}:00` }))
    const plan = planPetReminders(many, [], at(7), TODAY)
    expect(plan).toHaveLength(PET_REMINDER_MAX)
    for (let i = 1; i < plan.length; i++) expect(plan[i].fireAt >= plan[i - 1].fireAt).toBe(true)
  })
})
