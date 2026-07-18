import type { PetCareTask, PetEvent, PetTaskDone, PetTaskIcon } from './types'

/**
 * The most recent event per (pet, type, title). Re-logging a recurring
 * treatment retires the previous one's due date — so only the latest counts.
 * Input must be sorted newest-first (event_date desc).
 */
export function latestPerKey(events: PetEvent[]): PetEvent[] {
  const latest = new Map<string, PetEvent>()
  for (const e of events) {
    const key = `${e.pet_id}|${e.type}|${e.title.trim().toLowerCase()}`
    if (!latest.has(key)) latest.set(key, e)
  }
  return [...latest.values()]
}

/** Latest events that carry a next_due date, soonest first. */
export function reminderEvents(events: PetEvent[]): PetEvent[] {
  return latestPerKey(events)
    .filter((e) => e.next_due)
    .sort((a, b) => a.next_due!.localeCompare(b.next_due!))
}

/** Reminders that are due today or already past — the "needs attention" set. */
export function overdueEvents(events: PetEvent[], today: string): PetEvent[] {
  return reminderEvents(events).filter((e) => e.next_due! <= today)
}

// ── Routines (migration 069) ─────────────────────────────────────────────────
// Daily tasks are a checklist that resets each day (ordered by sort_order);
// interval tasks are due every interval_days from their latest completion.

const dayMs = 86_400_000
function isoDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / dayMs)
}

/** Latest completion date per task id. Input order doesn't matter. */
export function latestDoneByTask(done: PetTaskDone[]): Map<string, PetTaskDone> {
  const map = new Map<string, PetTaskDone>()
  for (const d of done) {
    const prev = map.get(d.task_id)
    if (!prev || d.done_on > prev.done_on) map.set(d.task_id, d)
  }
  return map
}

/** Days until an interval task is due (negative = overdue). Never completed →
 *  due today (0), so a fresh routine asks for a first log rather than lying. */
export function dueInDays(task: PetCareTask, latest: PetTaskDone | undefined, today: string): number {
  if (!latest) return 0
  return isoDiff(today, latest.done_on) + (task.interval_days ?? 0)
}

/** A pet's daily checklist in order, with today's completion (if any). */
export function dailyChecklist(
  tasks: PetCareTask[],
  done: PetTaskDone[],
  petId: string,
  today: string,
): { task: PetCareTask; done: PetTaskDone | null }[] {
  return tasks
    .filter((t) => t.pet_id === petId && t.kind === 'daily')
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((task) => ({
      task,
      done: done.find((d) => d.task_id === task.id && d.done_on === today) ?? null,
    }))
}

/** A pet's interval routines with their due state, most urgent first. */
export function routineStatus(
  tasks: PetCareTask[],
  done: PetTaskDone[],
  petId: string,
  today: string,
): { task: PetCareTask; lastDone: string | null; dueIn: number }[] {
  const latest = latestDoneByTask(done)
  return tasks
    .filter((t) => t.pet_id === petId && t.kind === 'interval')
    .map((task) => {
      const last = latest.get(task.id)
      return { task, lastDone: last?.done_on ?? null, dueIn: dueInDays(task, last, today) }
    })
    .sort((a, b) => a.dueIn - b.dueIn)
}

/** Default routine seeded when a pet is created — every item is editable or
 *  deletable afterwards. Titles are i18n KEYS (petcare.tpl.*), resolved by the
 *  caller with t() before insert. */
export function templateTasks(
  species: string | null,
): { key: string; icon: PetTaskIcon; kind: 'daily' | 'interval'; interval_days: number | null }[] {
  const base: ReturnType<typeof templateTasks> = [
    { key: 'breakfast', icon: 'bowl', kind: 'daily', interval_days: null },
    { key: 'dinner', icon: 'bowl', kind: 'daily', interval_days: null },
    { key: 'brushTeeth', icon: 'teeth', kind: 'interval', interval_days: 7 },
    { key: 'nailTrim', icon: 'nails', kind: 'interval', interval_days: 28 },
    { key: 'fleaMed', icon: 'pill', kind: 'interval', interval_days: 30 },
  ]
  if (species === 'dog') {
    return [
      { key: 'morningWalk', icon: 'walk', kind: 'daily', interval_days: null },
      ...base.slice(0, 2),
      { key: 'eveningWalk', icon: 'walk', kind: 'daily', interval_days: null },
      { key: 'bath', icon: 'bath', kind: 'interval', interval_days: 21 },
      ...base.slice(2),
    ]
  }
  if (species === 'cat') {
    return [...base.slice(0, 2), { key: 'litter', icon: 'paw', kind: 'daily', interval_days: null }, ...base.slice(2)]
  }
  return base
}
