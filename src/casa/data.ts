// Modo Casa — what the hub shows, loaded in one go (stale-while-revalidate via
// useCachedQuery) and kept fresh by Realtime + a slow poll. All reads and
// writes go through the device's own session, so RLS scopes everything to
// the family that paired it.
import { useEffect, useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { memberColor, occurrencesByDay, compareOccurrences, addDays, type Occurrence } from '../lib/calendar'
import { dailyChecklist, routineStatus, overdueEvents } from '../lib/petCare'
import { getSignedUrls } from '../lib/signedUrls'
import { supabase } from '../lib/supabase'
import type {
  CalendarEvent,
  MemberProfile,
  Pet,
  PetCareTask,
  PetEvent,
  PetTaskDone,
  ShoppingItem,
  ShoppingStore,
} from '../lib/types'
import { firstName } from './util'

export interface Member {
  email: string
  name: string
  first: string
  color: string
  avatar: string | null
  /** Their Family-app profile (birthday, phone, sizes…), when filled in. */
  profile: MemberProfile | null
}

export interface HubData {
  householdName: string
  members: Member[]
  events: CalendarEvent[]
  open: ShoppingItem[]
  checked: ShoppingItem[]
  stores: ShoppingStore[]
  pets: (Pet & { photo: string | null })[]
  tasks: PetCareTask[]
  done: PetTaskDone[]
  petEvents: PetEvent[]
}

const EMPTY: HubData = {
  householdName: '',
  members: [],
  events: [],
  open: [],
  checked: [],
  stores: [],
  pets: [],
  tasks: [],
  done: [],
  petEvents: [],
}

async function loadHub(householdId: string, fallback: { email: string; display_name: string }[]): Promise<HubData> {
  const since = addDays(isoToday(), -400)
  const [hh, mem, prof, ev, open, checked, stores, pets, tasks, done, petEv] = await Promise.all([
    supabase.from('households').select('name').eq('id', householdId).maybeSingle(),
    supabase.from('household_members').select('email, display_name, joined_at').eq('household_id', householdId).order('joined_at'),
    supabase.from('member_profiles').select('*'),
    supabase.from('calendar_events').select('*'),
    supabase.from('shopping_items').select('*').eq('checked', false).order('created_at'),
    supabase.from('shopping_items').select('*').eq('checked', true).order('checked_at', { ascending: false }).limit(40),
    supabase.from('shopping_stores').select('*').order('created_at'),
    supabase.from('pets').select('*').order('created_at'),
    supabase.from('pet_care_tasks').select('*'),
    supabase.from('pet_task_done').select('*').gte('done_on', since).order('done_on', { ascending: false }).limit(3000),
    supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
  ])
  const roster: { email: string; display_name: string }[] =
    !mem.error && mem.data?.length ? (mem.data as { email: string; display_name: string }[]) : fallback
  const emails = roster.map((r) => r.email)
  const profRows = ((prof.data ?? []) as MemberProfile[]).filter((p) => emails.includes(p.email))
  const avatarRows = profRows.filter((p) => p.avatar_path)
  const petRows = (pets.data ?? []) as Pet[]
  const paths = [
    ...avatarRows.map((p) => p.avatar_path as string),
    ...petRows.map((p) => p.photo_path).filter(Boolean),
  ] as string[]
  const urls = paths.length ? await getSignedUrls(paths).catch(() => ({}) as Record<string, string>) : {}
  return {
    householdName: (hh.data as { name?: string } | null)?.name ?? '',
    members: roster.map((r) => {
      const a = avatarRows.find((p) => p.email === r.email)?.avatar_path
      const name = r.display_name || r.email
      return {
        email: r.email,
        name,
        first: firstName(name),
        color: memberColor(r.email, emails),
        avatar: a ? (urls[a] ?? null) : null,
        profile: profRows.find((p) => p.email === r.email) ?? null,
      }
    }),
    events: (ev.data ?? []) as CalendarEvent[],
    open: (open.data ?? []) as ShoppingItem[],
    checked: (checked.data ?? []) as ShoppingItem[],
    stores: (stores.data ?? []) as ShoppingStore[],
    pets: petRows.map((p) => ({ ...p, photo: p.photo_path ? (urls[p.photo_path] ?? null) : null })),
    tasks: (tasks.data ?? []) as PetCareTask[],
    done: (done.data ?? []) as PetTaskDone[],
    petEvents: (petEv.data ?? []) as PetEvent[],
  }
}

export function isoToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** The hub's data + revalidate. Realtime on the tables people change from
 *  their phones, a 2-minute poll as the safety net, and a refresh whenever
 *  the screen comes back to the foreground. */
export function useHubData() {
  const { profile, profiles } = useAuth()
  const hid = profile?.household_id ?? ''
  const fallback = useMemo(() => profiles.map((p) => ({ email: p.email, display_name: p.display_name })), [profiles])
  const q = useCachedQuery<HubData>(`casa:hub:${hid}`, () => (hid ? loadHub(hid, fallback) : Promise.resolve(EMPTY)))
  const { revalidate } = q

  useEffect(() => {
    if (!hid) return
    let timer: ReturnType<typeof setTimeout> | null = null
    // Several changes land together (a list cleared on the phone) — refetch once.
    const soon = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void revalidate()
      }, 400)
    }
    const ch = supabase.channel(`casa-${hid}`)
    for (const table of ['shopping_items', 'shopping_stores', 'calendar_events', 'pet_task_done', 'pet_events', 'pets', 'pet_care_tasks', 'member_profiles']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, soon)
    }
    ch.subscribe()
    const poll = setInterval(() => void revalidate(), 120_000)
    const vis = () => {
      if (document.visibilityState === 'visible') void revalidate()
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', vis)
      void supabase.removeChannel(ch)
    }
  }, [hid, revalidate])

  return { data: q.data ?? EMPTY, loading: q.loading && !q.data, revalidate }
}

// ── derived views ────────────────────────────────────────────────────────────

/** Occurrences per day for [from, from + days). */
export function agenda(events: CalendarEvent[], from: string, days: number): Map<string, Occurrence[]> {
  const map = occurrencesByDay(events, from, addDays(from, days - 1))
  for (const list of map.values()) list.sort(compareOccurrences)
  return map
}

/** Minutes since midnight for "HH:MM[:SS]". */
export function minutesOf(hhmm: string | null): number {
  if (!hhmm) return 0
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Today's next event: the first timed one not yet over, else an all-day one. */
export function nextToday(list: Occurrence[], now: Date): Occurrence | null {
  const mins = now.getHours() * 60 + now.getMinutes()
  const timed = list.filter((o) => !o.event.all_day && minutesOf(o.event.end_time ?? o.event.start_time) > mins)
  if (timed.length) return timed[0]
  return list.find((o) => o.event.all_day) ?? null
}

export interface PetDueRow {
  key: string
  pet: HubData['pets'][number]
  title: string
  kind: 'daily' | 'interval' | 'event'
  task?: PetCareTask
  /** For interval routines/events: days late (0 = today). */
  late: number
}

/** What the pets still need today: daily checklist items not ticked, interval
 *  routines due or overdue (never-done routines are skipped, as on the phone's
 *  digest), and vet/vaccine reminders due today or earlier. */
export function petsDue(d: HubData, today: string): PetDueRow[] {
  const rows: PetDueRow[] = []
  for (const pet of d.pets) {
    for (const r of dailyChecklist(d.tasks, d.done, pet.id, today)) {
      if (!r.done) rows.push({ key: `d-${r.task.id}`, pet, title: r.task.title, kind: 'daily', task: r.task, late: 0 })
    }
    for (const r of routineStatus(d.tasks, d.done, pet.id, today)) {
      if (r.lastDone && r.dueIn <= 0)
        rows.push({ key: `i-${r.task.id}`, pet, title: r.task.title, kind: 'interval', task: r.task, late: -r.dueIn })
    }
  }
  for (const e of overdueEvents(d.petEvents, today)) {
    const pet = d.pets.find((p) => p.id === e.pet_id)
    if (!pet) continue
    const [y, m, dd] = e.next_due!.split('-').map(Number)
    const late = Math.round((Date.now() - new Date(y, m - 1, dd).getTime()) / 86_400_000)
    rows.push({ key: `e-${e.id}`, pet, title: e.title, kind: 'event', late: Math.max(0, late) })
  }
  return rows
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function addItem(label: string, storeId: string | null, by: string): Promise<ShoppingItem | null> {
  const { data, error } = await supabase
    .from('shopping_items')
    .insert({ label: label.trim(), added_by: by, store_id: storeId })
    .select('*')
    .single()
  if (error) throw error
  return data as ShoppingItem
}

export async function setChecked(ids: string[], checked: boolean): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('shopping_items')
    .update({ checked, checked_at: checked ? new Date().toISOString() : null })
    .in('id', ids)
  if (error) throw error
}

export async function deleteItems(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('shopping_items').delete().in('id', ids)
  if (error) throw error
}

export async function restoreItems(items: ShoppingItem[]): Promise<void> {
  if (!items.length) return
  await supabase
    .from('shopping_items')
    .insert(items.map((i) => ({ label: i.label, added_by: i.added_by, store_id: i.store_id, checked: i.checked, checked_at: i.checked_at })))
}

export async function petTaskDone(taskId: string, day: string, done: boolean): Promise<void> {
  if (done) {
    const { error } = await supabase.from('pet_task_done').insert({ task_id: taskId, done_on: day })
    if (error && error.code !== '23505') throw error
  } else {
    await supabase.from('pet_task_done').delete().eq('task_id', taskId).eq('done_on', day)
  }
}

export async function insertEvent(fields: {
  title: string
  date: string
  time: string
  owner: string | null
}): Promise<CalendarEvent> {
  const timed = /^\d{2}:\d{2}$/.test(fields.time)
  const [h, m] = timed ? fields.time.split(':').map(Number) : [0, 0]
  const end = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  const { data, error } = await supabase
    .from('calendar_events')
    .insert({
      title: fields.title.trim(),
      start_date: fields.date,
      end_date: fields.date,
      all_day: !timed,
      start_time: timed ? `${fields.time}:00` : null,
      end_time: timed ? end : null,
      owner_email: fields.owner,
      kind: 'event',
      recurrence: 'none',
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return data as CalendarEvent
}

export async function deleteEvent(id: string): Promise<void> {
  await supabase.from('calendar_events').delete().eq('id', id)
}
