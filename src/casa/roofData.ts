// Roof on the home device — the "doing" half beyond lists/agenda basics: a web
// port of mobile/src/lib/assistant.ts (events: locate / move / remove / series)
// and mobile/src/lib/assistantActions.ts (edit and find events, birthdays,
// pets, family, where is someone, nudges, shopping moves, weather, deals).
// Same queries as the phone, run with the DEVICE's session (the paired
// member's) — RLS stays the boundary. Every write returns what its Undo needs.
// No wording here: assistant.ts turns these results into answers.
// Not ported on purpose: money (lives on the phone) and documents (a shared
// screen in the kitchen must not open the vault).
import { addDays, occurrencesInRange, upcomingOccurrences, type Occurrence } from '../lib/calendar'
import { fetchMemberLocations, fetchPlaces, isPaused, isSharingLive, placeAt } from '../lib/location'
import { routineOrder, taskTime } from '../lib/petCare'
import { fetchActivePings } from '../lib/pings'
import { STORE_CATALOG } from '../lib/stores'
import { supabase } from '../lib/supabase'
import type { CalendarEvent, EventRecurrence, MemberProfile, PetCareTask, PetEvent, PetEventType, ShoppingItem, ShoppingStore } from '../lib/types'
import { loadHomeLocation } from '../lib/weather'
import type { Member } from './data'
import type { Deal, FamilyField } from './intent'
import { lsGet, norm } from './util'

// ── refs: the rows the model can point at ("v3") ─────────────────────────────

export type Ref = { kind: 'event'; id: string; start: string }
let refs = new Map<string, Ref>()
export const refTo = (ref?: string): Ref | undefined => (ref ? refs.get(ref) : undefined)
export function setEventRefs(occ: Occurrence[]): void {
  const next = new Map<string, Ref>()
  occ.forEach((o, i) => next.set(`v${i + 1}`, { kind: 'event', id: o.event.id, start: o.start }))
  refs = next
}

// ── members ──────────────────────────────────────────────────────────────────

/** A member by the name said — first name is enough. */
export function findMember(name: string, members: Member[]): Member | null {
  const n = norm(name)
  if (!n) return null
  return members.find((m) => norm(m.name) === n) ?? members.find((m) => norm(m.name).split(/\s+/)[0] === n.split(/\s+/)[0]) ?? null
}

// ── shopping ─────────────────────────────────────────────────────────────────

async function stores(): Promise<ShoppingStore[]> {
  const { data } = await supabase.from('shopping_stores').select('*').order('created_at')
  return (data ?? []) as ShoppingStore[]
}

/** The household's store for a spoken name (or the catalog's spelling of it);
 *  null when there's no such store — Roof then ASKS rather than guessing. */
export function matchStore(name: string, list: ShoppingStore[]): ShoppingStore | null {
  const wanted = norm(name)
  if (!wanted) return null
  const catalog = STORE_CATALOG.find((e) => norm(e.name) === wanted || e.slug === wanted.replace(/[^a-z0-9]/g, ''))
  return list.find((s) => norm(s.name) === wanted || (!!catalog && s.slug === catalog.slug)) ?? null
}

/** A new store (a "new list"), with the catalog's name/logo when known. */
export async function createStore(name: string): Promise<ShoppingStore> {
  const wanted = norm(name)
  const catalog = STORE_CATALOG.find((e) => norm(e.name) === wanted || e.slug === wanted.replace(/[^a-z0-9]/g, ''))
  const { data, error } = await supabase
    .from('shopping_stores')
    .insert({ name: catalog?.name ?? name.trim(), slug: catalog?.slug ?? null, color: null })
    .select('*')
    .single()
  if (error) throw error
  return data as ShoppingStore
}

export interface AddResult {
  store: ShoppingStore | null
  added: ShoppingItem[]
  existing: string[]
  createdStore: boolean
}

/** Add to one list (`store` null = "anywhere"), skipping what's already open there. */
export async function addItems(items: string[], store: ShoppingStore | null, by: string, createdStore = false): Promise<AddResult> {
  const { data: openRows } = await supabase.from('shopping_items').select('*').eq('checked', false)
  const storeId = store?.id ?? null
  const have = new Set(((openRows ?? []) as ShoppingItem[]).filter((i) => i.store_id === storeId).map((i) => norm(i.label)))
  const fresh: string[] = []
  const existing: string[] = []
  for (const label of items) {
    const k = norm(label)
    if (have.has(k)) existing.push(label)
    else if (!fresh.some((f) => norm(f) === k)) fresh.push(label)
  }
  let added: ShoppingItem[] = []
  if (fresh.length) {
    const { data, error } = await supabase
      .from('shopping_items')
      .insert(fresh.map((label) => ({ label, added_by: by, store_id: storeId })))
      .select('*')
    if (error) throw error
    added = (data ?? []) as ShoppingItem[]
  }
  return { store, added, existing, createdStore }
}

export async function undoAdd(ids: string[], createdStoreId?: string): Promise<void> {
  if (ids.length) await supabase.from('shopping_items').delete().in('id', ids)
  if (createdStoreId) await supabase.from('shopping_stores').delete().eq('id', createdStoreId)
}

export function matchLabels(said: string[], pool: ShoppingItem[]): { hits: ShoppingItem[]; missing: string[] } {
  const hits: ShoppingItem[] = []
  const missing: string[] = []
  for (const s of said) {
    const n = norm(s)
    const hit =
      pool.find((i) => !hits.includes(i) && norm(i.label) === n) ??
      pool.find((i) => !hits.includes(i) && (norm(i.label).includes(n) || n.includes(norm(i.label))))
    if (hit) hits.push(hit)
    else missing.push(s)
  }
  return { hits, missing }
}

export type MoveItemsResult = { ok: true; moved: ShoppingItem[]; missing: string[]; store: ShoppingStore } | { ok: false; store: string }

/** Move open items to another (existing) store. Undo = restoreStores(moved). */
export async function moveItemsTo(said: string[], storeName: string): Promise<MoveItemsResult> {
  const store = matchStore(storeName, await stores())
  if (!store) return { ok: false, store: storeName }
  const { data } = await supabase.from('shopping_items').select('*').eq('checked', false)
  const r = matchLabels(said, (data ?? []) as ShoppingItem[])
  const moved = r.hits.filter((i) => i.store_id !== store.id)
  if (moved.length) await supabase.from('shopping_items').update({ store_id: store.id }).in('id', moved.map((i) => i.id))
  return { ok: true, moved, missing: r.missing, store }
}

export async function restoreStores(items: ShoppingItem[]): Promise<void> {
  for (const i of items) await supabase.from('shopping_items').update({ store_id: i.store_id }).eq('id', i.id)
}

/** Delete the bought items (of one store when named). Undo = restoreItems. */
export async function clearChecked(storeName: string): Promise<{ cleared: ShoppingItem[]; store: ShoppingStore | null; unknownStore: boolean }> {
  const store = storeName ? matchStore(storeName, await stores()) : null
  if (storeName && !store) return { cleared: [], store: null, unknownStore: true }
  let q = supabase.from('shopping_items').select('*').eq('checked', true)
  if (store) q = q.eq('store_id', store.id)
  const { data } = await q
  const cleared = (data ?? []) as ShoppingItem[]
  if (cleared.length) await supabase.from('shopping_items').delete().in('id', cleared.map((i) => i.id))
  return { cleared, store, unknownStore: false }
}

/** Put bought items back as still to buy. Undo = recheck. */
export async function uncheckSaid(said: string[]): Promise<{ hits: ShoppingItem[]; missing: string[] }> {
  const { data } = await supabase.from('shopping_items').select('*').eq('checked', true).order('checked_at', { ascending: false })
  const r = matchLabels(said, (data ?? []) as ShoppingItem[])
  if (r.hits.length) await supabase.from('shopping_items').update({ checked: false, checked_at: null }).in('id', r.hits.map((i) => i.id))
  return r
}

export async function recheck(items: ShoppingItem[]): Promise<void> {
  for (const i of items) await supabase.from('shopping_items').update({ checked: true, checked_at: i.checked_at }).eq('id', i.id)
}

// ── calendar ─────────────────────────────────────────────────────────────────

export interface EventOptsIn {
  end?: string
  endTime?: string
  recurrence?: CalendarEvent['recurrence']
  kind?: CalendarEvent['kind']
  location?: string
  notes?: string
  reminder?: number | null
}

/** A new event, with the extras said (end, repeat, place, reminder…). */
export async function addEvent(title: string, date: string, time: string, owner: string | null, opts: EventOptsIn = {}): Promise<CalendarEvent> {
  const timed = /^\d{2}:\d{2}$/.test(time)
  const [h, m] = timed ? time.split(':').map(Number) : [0, 0]
  const defaultEnd = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  const endTime = timed && opts.endTime && /^\d{2}:\d{2}$/.test(opts.endTime) && opts.endTime > time ? `${opts.endTime}:00` : defaultEnd
  const { data, error } = await supabase
    .from('calendar_events')
    .insert({
      title: title.trim(),
      start_date: date,
      end_date: opts.end && opts.end > date ? opts.end : date,
      all_day: !timed,
      start_time: timed ? `${time}:00` : null,
      end_time: timed ? endTime : null,
      owner_email: owner,
      kind: opts.kind ?? 'event',
      recurrence: opts.recurrence ?? 'none',
      reminder_minutes: opts.reminder ?? null,
      location: opts.location?.trim() || null,
      notes: opts.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return data as CalendarEvent
}

export type Located = { ok: true; occ: Occurrence } | { ok: false; reason: 'not_found' | 'ambiguous'; options: Occurrence[] }

/** Whose event the request named: a first name, and their email when that
 *  name is a member (a child without an account matches by title only). */
export interface EventWho {
  name: string
  email?: string | null
}

const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean)
const CONNECTORS = new Set(['o', 'a', 'do', 'da', 'de', 'dos', 'das', 'del', 'el', 'la', 'the', 'of', 'for', 's', 'para', 'pra'])

/** "o dentista do Pedro": a member → by owner; anyone else → by the name in the title. */
export function eventWho(person: string | undefined, members: Member[]): EventWho | undefined {
  const name = person?.trim()
  if (!name) return undefined
  const m = findMember(name, members)
  return m ? { name: m.first, email: m.email } : { name }
}

export function isTheirs(ev: CalendarEvent, who: EventWho): boolean {
  if (who.email && ev.owner_email === who.email) return true
  const first = words(who.name)[0]
  return !!first && words(ev.title).includes(first)
}

function titleWithout(title: string, who: EventWho | undefined): string {
  if (!who) return norm(title)
  const name = words(who.name)[0]
  if (!name) return norm(title)
  return words(title)
    .filter((w, i, all) => w !== name && !(all[i + 1] === name && ['do', 'da', 'de', 'dos', 'das', 'del', 'of', 'for'].includes(w)) && w !== 's')
    .join(' ')
}

/** The phone's pickOccurrence: a person and a day narrow it; two DIFFERENT
 *  events still left are ambiguous — the caller asks which, never the first. */
export function pickOccurrence(pool: Occurrence[], title: string, hasDate: boolean, who?: EventWho): Located {
  const n = titleWithout(title, who)
  const full = norm(title)
  const exact = (o: Occurrence) => {
    const t = norm(o.event.title)
    return !!n && (t === n || t === full)
  }
  const said = words(n).filter((w) => !CONNECTORS.has(w))
  const strong = (o: Occurrence) => {
    if (exact(o)) return true
    const tw = words(o.event.title)
    return said.length > 0 && said.every((w) => tw.includes(w))
  }
  const weak = (o: Occurrence) => {
    const t = norm(o.event.title)
    return !!n && !!t && (t.includes(n) || n.includes(t))
  }
  let hits: Occurrence[]
  if (!n) hits = hasDate || who ? pool : []
  else {
    hits = pool.filter(strong)
    if (!hits.length) hits = pool.filter(weak)
  }
  if (who && hits.length) {
    const theirs = hits.filter((o) => isTheirs(o.event, who))
    if (!theirs.length) return { ok: false, reason: 'ambiguous', options: dedupe(hits) }
    hits = theirs
  }
  if (!hits.length) return { ok: false, reason: 'not_found', options: hasDate ? pool : [] }
  const options = dedupe(hits)
  if (options.length > 1) return { ok: false, reason: 'ambiguous', options }
  return { ok: true, occ: hits[0] }
}

function dedupe(hits: Occurrence[]): Occurrence[] {
  const seen = new Set<string>()
  return hits.filter((o) => (seen.has(o.event.id) ? false : (seen.add(o.event.id), true)))
}

/** The event meant: on `date` when given, else its NEXT occurrence. */
export async function locateEvent(title: string, date: string, today: string, withinDays = 92, ref?: string, who?: EventWho): Promise<Located> {
  const { data } = await supabase.from('calendar_events').select('*')
  const events = (data ?? []) as CalendarEvent[]
  const pool = date ? occurrencesInRange(events, date, date) : upcomingOccurrences(events, today, withinDays)
  const r = refTo(ref)
  const byRef = r ? events.find((ev) => ev.id === r.id) : undefined
  if (byRef && r && (!who || isTheirs(byRef, who))) {
    const check = title && !who && !date ? pickOccurrence(pool, title, false) : null
    if (!(check && !check.ok && check.reason === 'ambiguous' && check.options.some((o) => o.event.id === byRef.id))) {
      const occ = occurrencesInRange([byRef], r.start, r.start)[0] ?? { event: byRef, start: byRef.start_date, end: byRef.end_date }
      return { ok: true, occ }
    }
  }
  return pickOccurrence(pool, title, !!date, who)
}

/** From a connected Apple/Google calendar: changed at the source only. */
export const isExternal = (ev: CalendarEvent) => !!ev.source && ev.source !== 'oneroof'

export type MoveResult =
  | { ok: true; ev: CalendarEvent; before: CalendarEvent }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'external'; options: Occurrence[] }
  | { ok: false; reason: 'recurring'; occ: Occurrence }

const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`

function movePatch(ev: CalendarEvent, occStart: string, to: string, time: string) {
  const shift = Math.round((new Date(to + 'T12:00:00').getTime() - new Date(occStart + 'T12:00:00').getTime()) / 86_400_000)
  const patch: Partial<CalendarEvent> & { updated_at: string } = {
    start_date: addDays(ev.start_date, shift),
    end_date: addDays(ev.end_date, shift),
    updated_at: new Date().toISOString(),
  }
  if (/^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number)
    const len = ev.start_time && ev.end_time ? Math.max(15, (toMin(ev.end_time) ?? 0) - (toMin(ev.start_time) ?? 0)) : 60
    patch.all_day = false
    patch.start_time = `${time}:00`
    patch.end_time = fromMin(Math.min(23 * 60 + 59, h * 60 + m + len))
  }
  return patch
}

/** Move one occurrence (a series is left for the caller to ask about). */
export async function moveOccurrence(occ: Occurrence, to: string, time: string): Promise<MoveResult> {
  const before = occ.event
  if (isExternal(before)) return { ok: false, reason: 'external', options: [occ] }
  if (before.recurrence && before.recurrence !== 'none') return { ok: false, reason: 'recurring', occ }
  return applyMove(before, occ.start, to, time)
}

export async function moveSeries(ev: CalendarEvent, occStart: string, to: string, time: string): Promise<MoveResult> {
  return applyMove(ev, occStart, to, time)
}

async function applyMove(before: CalendarEvent, occStart: string, to: string, time: string): Promise<MoveResult> {
  const { data, error } = await supabase.from('calendar_events').update(movePatch(before, occStart, to, time)).eq('id', before.id).select('*').single()
  if (error || !data) return { ok: false, reason: 'not_found', options: [] }
  return { ok: true, ev: data as CalendarEvent, before }
}

/** Undo a move or an edit: the event's fields back as they were. */
export async function restoreEvent(before: CalendarEvent): Promise<void> {
  const fields: Partial<CalendarEvent> = { ...before }
  delete fields.id
  delete (fields as { household_id?: string }).household_id
  await supabase.from('calendar_events').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', before.id)
}

export type RemoveResult =
  | { ok: true; ev: CalendarEvent }
  | { ok: false; reason: 'not_found' | 'external' }
  | { ok: false; reason: 'recurring'; occ: Occurrence }

export async function removeOccurrence(occ: Occurrence): Promise<RemoveResult> {
  const ev = occ.event
  if (isExternal(ev)) return { ok: false, reason: 'external' }
  if (ev.recurrence && ev.recurrence !== 'none') return { ok: false, reason: 'recurring', occ }
  const { error } = await supabase.from('calendar_events').delete().eq('id', ev.id)
  if (error) return { ok: false, reason: 'not_found' }
  return { ok: true, ev }
}

export async function removeSeries(ev: CalendarEvent): Promise<boolean> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', ev.id)
  return !error
}

/** Stop a series before `occStart` (that one and later go; earlier stay). */
export async function endSeries(ev: CalendarEvent, occStart: string): Promise<boolean> {
  if (occStart <= ev.start_date) return removeSeries(ev)
  const { error } = await supabase
    .from('calendar_events')
    .update({ recurrence_until: addDays(occStart, -1), updated_at: new Date().toISOString() })
    .eq('id', ev.id)
  return !error
}

/** Undo a removal: the same row (same id) back. */
export async function unremoveEvent(ev: CalendarEvent): Promise<void> {
  await supabase.from('calendar_events').insert({ ...ev, updated_at: new Date().toISOString() })
}

export interface EventEdit {
  newTitle: string
  location: string
  notes: string
  /** Minutes before; -1 = leave as is, -2 = remove the reminder. */
  reminder: number
  /** Make it repeat ("repete todo mês"); absent = leave as is. */
  recurrence?: EventRecurrence
}

export async function editEvent(ev: CalendarEvent, e: EventEdit): Promise<CalendarEvent | null> {
  const patch: Partial<CalendarEvent> & { updated_at: string } = { updated_at: new Date().toISOString() }
  if (e.newTitle.trim()) patch.title = e.newTitle.trim()
  if (e.location.trim()) patch.location = e.location.trim()
  if (e.notes.trim()) patch.notes = ev.notes ? `${ev.notes}\n${e.notes.trim()}` : e.notes.trim()
  if (e.reminder === -2) patch.reminder_minutes = null
  else if (e.reminder >= 0) patch.reminder_minutes = e.reminder
  if (e.recurrence) patch.recurrence = e.recurrence
  const { data, error } = await supabase.from('calendar_events').update(patch).eq('id', ev.id).select('*').single()
  return error ? null : (data as CalendarEvent)
}

export interface BirthdayRow {
  name: string
  date: string
  inDays: number
  years: number
  kind: 'birthday' | 'anniversary'
}

function nextBirthday(birth: string, today: string): { date: string; inDays: number; turning: number } {
  const [by, bm, bd] = birth.split('-').map(Number)
  const ty = Number(today.slice(0, 4))
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const on = (y: number) => `${y}-${String(bm).padStart(2, '0')}-${String(bm === 2 && bd === 29 && !leap(y) ? 28 : bd).padStart(2, '0')}`
  let year = ty
  if (on(year) < today) year += 1
  const date = on(year)
  return { date, inDays: daysBetween(today, date), turning: year - by }
}

export const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 86_400_000)

/** Members' birthdays (Family) plus birthday/anniversary events, soonest first. */
export async function upcomingBirthdays(today: string, members: Member[], limit = 6): Promise<BirthdayRow[]> {
  const [{ data: mp }, { data: ev }] = await Promise.all([
    supabase.from('member_profiles').select('email, birthday'),
    supabase.from('calendar_events').select('*').in('kind', ['birthday', 'anniversary']),
  ])
  const rows: BirthdayRow[] = []
  const seen = new Set<string>()
  for (const r of (mp ?? []) as { email: string; birthday: string | null }[]) {
    if (!r.birthday || !/^\d{4}-\d{2}-\d{2}$/.test(r.birthday)) continue
    const m = members.find((x) => x.email === r.email)
    if (!m) continue
    const nb = nextBirthday(r.birthday, today)
    seen.add(norm(m.first))
    rows.push({ name: m.first, date: nb.date, inDays: nb.inDays, years: nb.turning, kind: 'birthday' })
  }
  for (const o of upcomingOccurrences((ev ?? []) as CalendarEvent[], today, 366)) {
    if (o.event.kind === 'birthday' && [...seen].some((n) => norm(o.event.title).includes(n))) continue
    const years = Number(o.start.slice(0, 4)) - Number(o.event.start_date.slice(0, 4))
    rows.push({ name: o.event.title, date: o.start, inDays: daysBetween(today, o.start), years: years > 0 ? years : 0, kind: o.event.kind === 'anniversary' ? 'anniversary' : 'birthday' })
  }
  return rows.sort((a, b) => a.inDays - b.inDays).slice(0, limit)
}

// ── pets ─────────────────────────────────────────────────────────────────────

interface PetLite {
  id: string
  name: string
}

async function petsAndTasks(): Promise<{ pets: PetLite[]; tasks: PetCareTask[] }> {
  const [p, t] = await Promise.all([supabase.from('pets').select('id, name'), supabase.from('pet_care_tasks').select('*').order('sort_order')])
  return { pets: (p.data ?? []) as PetLite[], tasks: (t.data ?? []) as PetCareTask[] }
}

function findPet(pets: PetLite[], name: string): PetLite | null {
  const n = norm(name)
  if (!n) return pets.length === 1 ? pets[0] : null
  return pets.find((p) => norm(p.name) === n) ?? pets.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name))) ?? null
}

/** The pets named — one, several ("Lola, Aninha") — or every pet for "". */
function petsNamed(pets: PetLite[], petName: string): PetLite[] {
  const said = petName.split(',').map((x) => x.trim()).filter(Boolean)
  if (!said.length) return pets
  const hit = said.map((n) => findPet(pets, n)).filter((p): p is PetLite => !!p)
  return pets.filter((p) => hit.some((h) => h.id === p.id))
}

export interface PetDoneResult {
  done: { task: PetCareTask; pet: string }[]
  missing: string[]
  needPet: boolean
}

/** Mark routine tasks done today, for the pet named (or the only pet that has it). */
export async function petTasksDone(petName: string, said: string[], today: string): Promise<PetDoneResult> {
  const { pets, tasks } = await petsAndTasks()
  const pet = findPet(pets, petName)
  const done: PetDoneResult['done'] = []
  const missing: string[] = []
  let needPet = false
  for (const s of said) {
    const n = norm(s)
    const pool = tasks.filter((t) => !pet || t.pet_id === pet.id)
    let hits = pool.filter((t) => norm(t.title) === n)
    if (!hits.length) hits = pool.filter((t) => norm(t.title).includes(n) || n.includes(norm(t.title)))
    if (!hits.length) {
      missing.push(s)
      continue
    }
    if (!pet && new Set(hits.map((t) => t.pet_id)).size > 1) {
      needPet = true
      continue
    }
    const task = hits[0]
    const { error } = await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: today })
    if (error && error.code !== '23505') {
      missing.push(s)
      continue
    }
    done.push({ task, pet: pets.find((p) => p.id === task.pet_id)?.name ?? '' })
  }
  return { done, missing, needPet }
}

export async function undoPetTasksDone(done: PetDoneResult['done'], today: string): Promise<void> {
  for (const d of done) await supabase.from('pet_task_done').delete().eq('task_id', d.task.id).eq('done_on', today)
}

export type PetLogResult = { ok: true; ev: PetEvent; pet: string } | { ok: false }

/** A vet visit / vaccine / … on a day (today or past), with a next due. */
export async function logPetEvent(petName: string, type: PetEventType, title: string, date: string, next: string, me: string): Promise<PetLogResult> {
  const { pets } = await petsAndTasks()
  const pet = findPet(pets, petName)
  if (!pet) return { ok: false }
  const { data, error } = await supabase
    .from('pet_events')
    .insert({ pet_id: pet.id, type, title: title.trim() || type, notes: null, event_date: date, next_due: next && next > date ? next : null, added_by: me })
    .select('*')
    .single()
  if (error || !data) return { ok: false }
  return { ok: true, ev: data as PetEvent, pet: pet.name }
}

export async function deletePetEvent(id: string): Promise<void> {
  await supabase.from('pet_events').delete().eq('id', id)
}

export interface PetNextRow {
  pet: string
  title: string
  type: PetEventType
  due: string
  last: string
  every?: number
}

/** When each kind of care is next due, soonest first (events with a next due
 *  + interval routines done at least once). */
export async function petNextDue(petName: string, type: PetEventType | ''): Promise<{ rows: PetNextRow[]; pet: string }> {
  const [{ pets, tasks }, { data }] = await Promise.all([petsAndTasks(), supabase.from('pet_events').select('*').order('event_date', { ascending: false })])
  const chosen = petsNamed(pets, petName)
  const ids = new Set(chosen.map((p) => p.id))
  const nameOf = (id: string) => pets.find((p) => p.id === id)?.name ?? ''
  const latest = new Map<string, PetEvent>()
  for (const e of (data ?? []) as PetEvent[]) {
    if (!ids.has(e.pet_id) || (type && e.type !== type)) continue
    const key = `${e.pet_id}:${norm(e.title)}`
    if (!latest.has(key)) latest.set(key, e)
  }
  const rows: PetNextRow[] = [...latest.values()]
    .filter((e) => !!e.next_due)
    .map((e) => ({ pet: nameOf(e.pet_id), title: e.title, type: e.type, due: e.next_due!, last: e.event_date }))
  if (!type) {
    const routines = tasks.filter((t) => t.kind === 'interval' && ids.has(t.pet_id) && (t.interval_days ?? 0) > 0)
    if (routines.length) {
      const { data: done } = await supabase
        .from('pet_task_done')
        .select('task_id, done_on')
        .in('task_id', routines.map((t) => t.id))
        .order('done_on', { ascending: false })
      const last = new Map<string, string>()
      for (const d of (done ?? []) as { task_id: string; done_on: string }[]) if (!last.has(d.task_id)) last.set(d.task_id, d.done_on)
      for (const t of routines) {
        const at = last.get(t.id)
        if (!at) continue
        const due = addDays(at, t.interval_days ?? 0)
        const twin = rows.findIndex((r) => r.pet === nameOf(t.pet_id) && norm(r.title) === norm(t.title))
        if (twin >= 0) {
          if (due < rows[twin].due) rows[twin] = { ...rows[twin], due, last: at, every: t.interval_days ?? undefined }
          continue
        }
        rows.push({ pet: nameOf(t.pet_id), title: t.title, type: 'other', due, last: at, every: t.interval_days ?? undefined })
      }
    }
  }
  rows.sort((a, b) => a.due.localeCompare(b.due))
  return { rows, pet: petName.trim() ? chosen.map((p) => p.name).join(', ') : '' }
}

export interface PetRoutine {
  pet: string
  daily: { task: PetCareTask; time: string | null; done: boolean }[]
  interval: { task: PetCareTask; last: string | null; due: string | null }[]
}

/** Each pet's whole routine: daily items with their time and today's tick,
 *  then interval routines with last done / next due. */
export async function petRoutine(petName: string, today: string): Promise<PetRoutine[]> {
  const { pets, tasks } = await petsAndTasks()
  const chosen = petsNamed(pets, petName)
  const mine = tasks.filter((t) => chosen.some((p) => p.id === t.pet_id))
  const { data: done } = mine.length
    ? await supabase.from('pet_task_done').select('task_id, done_on').in('task_id', mine.map((t) => t.id)).order('done_on', { ascending: false })
    : { data: [] }
  const rows = (done ?? []) as { task_id: string; done_on: string }[]
  const last = new Map<string, string>()
  for (const d of rows) if (!last.has(d.task_id)) last.set(d.task_id, d.done_on)
  return chosen
    .map((p) => ({
      pet: p.name,
      daily: mine
        .filter((t) => t.pet_id === p.id && t.kind === 'daily')
        .sort(routineOrder)
        .map((task) => ({ task, time: taskTime(task), done: rows.some((d) => d.task_id === task.id && d.done_on === today) })),
      interval: mine
        .filter((t) => t.pet_id === p.id && t.kind === 'interval')
        .map((task) => {
          const at = last.get(task.id) ?? null
          return { task, last: at, due: at && task.interval_days ? addDays(at, task.interval_days) : null }
        })
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')),
    }))
    .filter((r) => r.daily.length || r.interval.length)
}

export type WeightResult = { ok: true; id: string; pet: string; previous: number | null } | { ok: false }

export async function logPetWeight(petName: string, weight: number, today: string): Promise<WeightResult> {
  const { pets } = await petsAndTasks()
  const pet = findPet(pets, petName)
  if (!pet) return { ok: false }
  const { data: prev } = await supabase.from('pet_weights').select('weight').eq('pet_id', pet.id).order('measured_on', { ascending: false }).limit(1)
  const { data, error } = await supabase.from('pet_weights').insert({ pet_id: pet.id, weight, measured_on: today }).select('id').single()
  if (error || !data) return { ok: false }
  const p = (prev ?? [])[0] as { weight: number } | undefined
  return { ok: true, id: (data as { id: string }).id, pet: pet.name, previous: p ? Number(p.weight) : null }
}

export async function deletePetWeight(id: string): Promise<void> {
  await supabase.from('pet_weights').delete().eq('id', id)
}

// ── family ───────────────────────────────────────────────────────────────────

export async function familyRow(email: string): Promise<MemberProfile | null> {
  const { data } = await supabase.from('member_profiles').select('*').eq('email', email).maybeSingle()
  return (data as MemberProfile | null) ?? null
}

/** Change one stored detail; returns the old value for Undo. */
export async function setFamilyField(email: string, field: FamilyField, value: string | null): Promise<{ ok: boolean; previous: string | null }> {
  const row = await familyRow(email)
  const previous = (row?.[field] as string | null | undefined) ?? null
  const { error } = await supabase.from('member_profiles').upsert({ email, [field]: value, updated_at: new Date().toISOString() }, { onConflict: 'email' })
  return { ok: !error, previous }
}

// ── where is someone ─────────────────────────────────────────────────────────

export type WhereResult =
  | { ok: true; place: string | null; minutesAgo: number; battery: number | null; atAsked: boolean | null }
  | { ok: false; reason: 'not_sharing' | 'paused' | 'no_fix' }

/** The saved place a member is inside (the web has no street geocoder, so
 *  outside one it only says how fresh the fix is). Off or paused sharing says
 *  so and shows nothing. */
export async function whereIs(email: string, asked: string): Promise<WhereResult> {
  const [locs, places] = await Promise.all([fetchMemberLocations().catch(() => []), fetchPlaces().catch(() => [])])
  const loc = locs.find((l) => l.user_email === email)
  if (isPaused(loc)) return { ok: false, reason: 'paused' }
  if (!loc?.sharing) return { ok: false, reason: 'not_sharing' }
  if (!isSharingLive(loc)) return { ok: false, reason: 'no_fix' }
  const here = placeAt(places, { lat: loc.lat, lng: loc.lng })
  const n = norm(asked)
  return {
    ok: true,
    place: here?.name ?? null,
    minutesAgo: Math.max(0, Math.round((Date.now() - new Date(loc.updated_at).getTime()) / 60_000)),
    battery: loc.battery,
    atAsked: n ? !!here && (norm(here.name).includes(n) || n.includes(norm(here.name))) : null,
  }
}

// ── nudges ───────────────────────────────────────────────────────────────────

/** Who has seen the device member's latest still-active nudge. */
export async function lastNudgeSeen(me: string, members: Member[]): Promise<{ message: string; emoji: string; seen: string[]; notYet: string[] } | null> {
  const p = (await fetchActivePings()).filter((x) => x.sender_email === me)[0]
  if (!p) return null
  const audience = (p.recipients ?? members.map((x) => x.email)).filter((e) => e !== me)
  const acked = new Set(p.acks.map((a) => a.user_email))
  const name = (e: string) => members.find((x) => x.email === e)?.first ?? e
  return { message: p.message, emoji: p.emoji, seen: audience.filter((e) => acked.has(e)).map(name), notYet: audience.filter((e) => !acked.has(e)).map(name) }
}

/** Active nudges to the device member (or everyone) not seen yet. */
export async function unseenNudges(me: string): Promise<{ emoji: string; message: string; from: string }[]> {
  const pings = await fetchActivePings().catch(() => [])
  return pings
    .filter((p) => p.sender_email !== me && (!p.recipients || p.recipients.includes(me)) && !p.acks.some((a) => a.user_email === me))
    .map((p) => ({ emoji: p.emoji, message: p.message, from: p.sender_email }))
}

// ── weather ──────────────────────────────────────────────────────────────────

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

export type DayWeather =
  | { ok: true; city: string; min: number; max: number; rain: number; kind: WeatherKind; unit: string }
  | { ok: false; reason: 'no_city' | 'too_far' | 'failed' }

const kindOf = (code: number): WeatherKind =>
  code >= 95 ? 'storm' : code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82 ? 'snow' : code >= 61 ? 'rain' : code >= 51 ? 'drizzle' : code >= 45 ? 'fog' : code >= 2 ? 'cloudy' : 'clear'

/** One day's forecast at the device's city (the hub's own weather city and
 *  °C/°F choice; Open-Meteo, up to 16 days). */
export async function weatherFor(date: string, today: string, lang: string): Promise<DayWeather> {
  const home = loadHomeLocation()
  if (!home) return { ok: false, reason: 'no_city' }
  const ahead = daysBetween(today, date)
  if (ahead < 0 || ahead > 15) return { ok: false, reason: 'too_far' }
  const celsius = (lsGet('casa.unit') || (lang === 'en' ? 'fahrenheit' : 'celsius')) === 'celsius'
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${home.lat}&longitude=${home.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=${celsius ? 'celsius' : 'fahrenheit'}&timezone=auto&start_date=${date}&end_date=${date}`
    const res = await fetch(url)
    if (!res.ok) return { ok: false, reason: 'failed' }
    const d = ((await res.json()) as { daily?: Record<string, number[]> }).daily
    if (!d) return { ok: false, reason: 'failed' }
    return {
      ok: true,
      city: home.city.split(',')[0],
      min: Math.round(d.temperature_2m_min?.[0] ?? 0),
      max: Math.round(d.temperature_2m_max?.[0] ?? 0),
      rain: Math.round(d.precipitation_probability_max?.[0] ?? 0),
      kind: kindOf(d.weather_code?.[0] ?? 0),
      unit: celsius ? '°C' : '°F',
    }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

// ── utilities ────────────────────────────────────────────────────────────────

export interface DealRow extends Deal {
  perUnit: number
  best: boolean
}

export function compareDeals(deals: Deal[]): { rows: DealRow[]; savingPct: number } {
  const rows = deals.map((d) => ({ ...d, perUnit: d.price / d.size, best: false }))
  const sorted = [...rows].sort((a, b) => a.perUnit - b.perUnit)
  sorted[0].best = true
  const savingPct = sorted.length > 1 ? Math.round((1 - sorted[0].perUnit / sorted[1].perUnit) * 100) : 0
  return { rows, savingPct }
}

/** The phone's evenSplit (apps/calc/splitMath): cents add up exactly. */
export function evenSplit(bill: number, people: number, tipPct: number): { tip: number; total: number; per: number; extraCentCount: number } {
  const n = Math.max(1, Math.floor(people))
  const billC = Math.round(bill * 100)
  const tipC = Math.round((billC * tipPct) / 100)
  const totalC = billC + tipC
  const base = Math.floor(totalC / n)
  return { tip: tipC / 100, total: totalC / 100, per: base / 100, extraCentCount: totalC - base * n }
}
