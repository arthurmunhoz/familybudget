import type { PetEvent } from './types'

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
