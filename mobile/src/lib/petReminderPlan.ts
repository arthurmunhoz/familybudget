// Which pet-routine reminders this phone should have scheduled right now —
// pure, so it is unit-tested (__tests__/petReminders.test.ts) without
// expo-notifications. lib/petReminders.ts does the scheduling.
//
// A reminder for (task, day) fires at day + remind_at + GRACE, in the PHONE'S
// local time, unless somebody has a pet_task_done row for that task and day.
// Daily routines remind every day; interval routines only on days they are due
// or overdue (dueInDays ≤ 0, the same rule Pet Care shows), assuming nothing
// else gets marked in between — a later mark reschedules anyway.
import { addDaysISO } from './format'
import { dueInDays, latestDoneByTask } from './petCare'
import type { PetCareTask, PetTaskDone } from './types'

/** Minutes after the routine's time before anyone is asked. */
export const PET_REMINDER_GRACE_MIN = 45
/** Today plus the next two days: a phone that isn't opened for a day still
 *  reminds, without filling the OS queue. */
export const PET_REMINDER_DAYS = 3
/** iOS keeps at most 64 pending local notifications per app (the rest are
 *  dropped silently); leave room for everything else. */
export const PET_REMINDER_MAX = 40

export interface PlannedReminder {
  /** Notification identifier: `petrem:<taskId>:<YYYY-MM-DD>`. */
  id: string
  taskId: string
  petId: string
  day: string
  fireAt: Date
  title: string
}

export const reminderId = (taskId: string, day: string): string => `petrem:${taskId}:${day}`
export const isReminderId = (id: string): boolean => id.startsWith('petrem:')

/** "08:00:00" / "8:05" → [8, 5]; anything else → null. */
export function parseRemindAt(v: string | null | undefined): [number, number] | null {
  if (!v) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return [h, min]
}

/** "08:00:00" → "08:00" (null when unset or unreadable). */
export function remindAtHHMM(v: string | null | undefined): string | null {
  const p = parseRemindAt(v)
  return p ? `${String(p[0]).padStart(2, '0')}:${String(p[1]).padStart(2, '0')}` : null
}

const localDate = (iso: string, h: number, m: number): Date => {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m, 0, 0)
}

export function planPetReminders(
  tasks: PetCareTask[],
  done: PetTaskDone[],
  now: Date,
  today: string,
): PlannedReminder[] {
  const latest = latestDoneByTask(done)
  const doneKeys = new Set(done.map((d) => `${d.task_id}|${d.done_on}`))
  const out: PlannedReminder[] = []
  for (const task of tasks) {
    const time = parseRemindAt(task.remind_at)
    if (!time) continue
    for (let i = 0; i < PET_REMINDER_DAYS; i++) {
      const day = addDaysISO(today, i)
      if (doneKeys.has(`${task.id}|${day}`)) continue
      if (task.kind === 'interval' && dueInDays(task, latest.get(task.id), day) > 0) continue
      const fireAt = localDate(day, time[0], time[1])
      fireAt.setMinutes(fireAt.getMinutes() + PET_REMINDER_GRACE_MIN)
      // Already past (or about to be): the moment is gone — don't fire late.
      if (fireAt.getTime() <= now.getTime() + 30_000) continue
      out.push({ id: reminderId(task.id, day), taskId: task.id, petId: task.pet_id, day, fireAt, title: task.title })
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime()).slice(0, PET_REMINDER_MAX)
}
