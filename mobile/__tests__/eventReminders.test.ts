/**
 * Calendar event reminders: which local notifications a phone schedules.
 * reminder_minutes before the start (all-day events start at 9:00), only for
 * the phone's own events and the whole household's, within the window.
 */
import { EVENT_REMINDER_MAX, eventReminderId, planEventReminders } from '@/lib/eventReminderPlan'
import type { CalendarEvent } from '@/lib/types'

const ME = 'me@x.com'
function ev(p: Partial<CalendarEvent> & Pick<CalendarEvent, 'id'>): CalendarEvent {
  return {
    household_id: 'h',
    title: 'Dentist',
    start_date: '2026-11-25',
    end_date: '2026-11-25',
    all_day: false,
    start_time: '15:00:00',
    end_time: '16:00:00',
    location: null,
    notes: null,
    owner_email: ME,
    color: null,
    recurrence: 'none',
    recurrence_until: null,
    kind: 'event',
    reminder_minutes: 10,
    source: 'oneroof',
    google_event_id: null,
    google_calendar_id: null,
    apple_event_id: null,
    synced_at: null,
    created_by: ME,
    created_at: '2026-11-01T00:00:00Z',
    ...p,
  }
}
const NOW = new Date(2026, 10, 25, 9, 0)
const TODAY = '2026-11-25'

test('timed: fires N minutes before the start, local time', () => {
  const [r] = planEventReminders([ev({ id: 'a' })], ME, NOW, TODAY)
  expect(r.id).toBe(eventReminderId('a', TODAY))
  expect(r.fireAt).toEqual(new Date(2026, 10, 25, 14, 50))
})

test('0 = at the start; an hour before crosses the hour', () => {
  const plan = planEventReminders(
    [ev({ id: 'a', reminder_minutes: 0 }), ev({ id: 'b', reminder_minutes: 60, start_time: '10:30:00' })],
    ME,
    NOW,
    TODAY,
  )
  expect(plan.map((p) => p.fireAt)).toEqual([new Date(2026, 10, 25, 9, 30), new Date(2026, 10, 25, 15, 0)])
})

test('all-day: 9:00 that day, or the day before', () => {
  const plan = planEventReminders(
    [
      ev({ id: 'a', all_day: true, start_time: null, start_date: '2026-11-26', end_date: '2026-11-26', reminder_minutes: 0 }),
      ev({ id: 'b', all_day: true, start_time: null, start_date: '2026-11-28', end_date: '2026-11-28', reminder_minutes: 1440 }),
    ],
    ME,
    NOW,
    TODAY,
  )
  expect(plan.map((p) => p.fireAt)).toEqual([new Date(2026, 10, 26, 9, 0), new Date(2026, 10, 27, 9, 0)])
})

test('skips past reminders, no-reminder events and other people’s events', () => {
  const plan = planEventReminders(
    [
      ev({ id: 'past', start_time: '09:05:00' }), // 8:55 < now
      ev({ id: 'none', reminder_minutes: null }),
      ev({ id: 'theirs', owner_email: 'sam@x.com' }),
      ev({ id: 'house', owner_email: null }),
    ],
    ME,
    NOW,
    TODAY,
  )
  expect(plan.map((p) => p.eventId)).toEqual(['house'])
})

test('repeating events remind on each occurrence, capped', () => {
  const plan = planEventReminders([ev({ id: 'd', recurrence: 'daily' })], ME, NOW, TODAY)
  expect(plan.length).toBe(14)
  expect(plan[1].day).toBe('2026-11-26')
  const many = planEventReminders(
    [ev({ id: 'd', recurrence: 'daily' }), ev({ id: 'e', recurrence: 'daily', start_time: '18:00:00' })],
    ME,
    NOW,
    TODAY,
  )
  expect(many.length).toBe(EVENT_REMINDER_MAX)
})

test('a week-before reminder for an event beyond the window', () => {
  const plan = planEventReminders(
    [ev({ id: 'w', all_day: true, start_time: null, start_date: '2026-12-15', end_date: '2026-12-15', reminder_minutes: 10080 })],
    ME,
    NOW,
    TODAY,
  )
  expect(plan.map((p) => p.fireAt)).toEqual([new Date(2026, 11, 8, 9, 0)])
})
