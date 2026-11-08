// The Home assistant's "doing" half, part two (2026-11): the actions added
// after the first set in lib/assistant.ts — editing and finding events, money
// corrections and per-category totals, pet care logging, family updates,
// where someone is, more shopping-list moves, weather, "which is cheaper",
// documents and a day overview. Same rule as there: everything runs with the
// user's OWN Supabase session (RLS is the boundary) and every write returns
// what its Undo needs. No wording here — components/home/askActions.ts turns
// these results into answers.
import * as Location from 'expo-location'

import { supabase } from './supabase'
import { upcomingOccurrences } from './calendar'
import { budgetsWithMonths, matchStore, norm, periodForBudget, pickBudget, refTo, type Deal, type FamilyField } from './assistant'
import { categoryById } from './categories'
import { nextBirthday } from './birthday'
import { fetchMemberLocations, isPaused, isSharingLive } from './location'
import { fetchPlaces, placeAt } from './places'
import { fetchActivePings } from './pings'
import { loadHomeLocation } from './weather'
import { notifyPetCareChange } from './petCareNotify'
import type {
  Budget,
  CalendarEvent,
  CategoryOverride,
  CustomCategory,
  Entry,
  FamilyDocument,
  MemberProfile,
  Month,
  PetCareTask,
  PetEvent,
  PetEventType,
  Profile,
  ShoppingItem,
  ShoppingStore,
} from './types'

// ── calendar: edit ───────────────────────────────────────────────────────────

export interface EventEdit {
  newTitle: string
  location: string
  notes: string
  /** Minutes before; -1 = leave as is, -2 = remove the reminder. */
  reminder: number
}

/** Apply the edit; returns the updated row (Undo = restoreEvent(before)). */
export async function editEvent(ev: CalendarEvent, e: EventEdit): Promise<CalendarEvent | null> {
  const patch: Partial<CalendarEvent> & { updated_at: string } = { updated_at: new Date().toISOString() }
  if (e.newTitle.trim()) patch.title = e.newTitle.trim()
  if (e.location.trim()) patch.location = e.location.trim()
  if (e.notes.trim()) patch.notes = ev.notes ? `${ev.notes}\n${e.notes.trim()}` : e.notes.trim()
  if (e.reminder === -2) patch.reminder_minutes = null
  else if (e.reminder >= 0) patch.reminder_minutes = e.reminder
  const { data, error } = await supabase.from('calendar_events').update(patch).eq('id', ev.id).select('*').single()
  return error ? null : (data as CalendarEvent)
}

// ── calendar: birthdays ──────────────────────────────────────────────────────

export interface BirthdayRow {
  name: string
  date: string
  inDays: number
  /** Age turning (birthdays) / years (anniversaries); 0 when unknown. */
  years: number
  kind: 'birthday' | 'anniversary'
}

/** The coming birthdays and anniversaries: family members' birthdays (Family)
 *  plus birthday/anniversary events on the calendar, soonest first. */
export async function upcomingBirthdays(today: string, profiles: Profile[], limit = 6): Promise<BirthdayRow[]> {
  const [{ data: mp }, { data: ev }] = await Promise.all([
    supabase.from('member_profiles').select('email, birthday'),
    supabase.from('calendar_events').select('*').in('kind', ['birthday', 'anniversary']),
  ])
  const rows: BirthdayRow[] = []
  const seen = new Set<string>()
  for (const r of (mp ?? []) as { email: string; birthday: string | null }[]) {
    if (!r.birthday || !/^\d{4}-\d{2}-\d{2}$/.test(r.birthday)) continue
    const p = profiles.find((x) => x.email === r.email)
    if (!p) continue
    const nb = nextBirthday(r.birthday, today)
    const name = p.display_name.split(' ')[0]
    seen.add(norm(name))
    rows.push({ name, date: nb.date, inDays: nb.inDays, years: nb.turning, kind: 'birthday' })
  }
  for (const o of upcomingOccurrences((ev ?? []) as CalendarEvent[], today, 366)) {
    // A member's birthday also on the calendar shouldn't show twice.
    if (o.event.kind === 'birthday' && [...seen].some((n) => norm(o.event.title).includes(n))) continue
    const years = Number(o.start.slice(0, 4)) - Number(o.event.start_date.slice(0, 4))
    const inDays = Math.round((new Date(o.start + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86_400_000)
    rows.push({ name: o.event.title, date: o.start, inDays, years: years > 0 ? years : 0, kind: o.event.kind === 'anniversary' ? 'anniversary' : 'birthday' })
  }
  return rows.sort((a, b) => a.inDays - b.inDays).slice(0, limit)
}

// ── money ────────────────────────────────────────────────────────────────────

/** "groceries = Groceries" lines for the server (built-ins + the household's). */
export async function categoriesContext(): Promise<string[]> {
  const [{ data: custom }, { data: overrides }] = await Promise.all([
    supabase.from('custom_categories').select('*'),
    supabase.from('category_overrides').select('*'),
  ])
  const ov = (overrides ?? []) as CategoryOverride[]
  const builtin = [
    'groceries', 'dining', 'transport', 'home', 'utilities', 'health', 'entertainment',
    'shopping', 'travel', 'subscriptions', 'gifts', 'pets', 'salary', 'other',
  ].map((id) => `${id} = ${categoryById(id, [], ov).name}`)
  return [...builtin, ...((custom ?? []) as CustomCategory[]).map((c) => `${c.id} = ${c.name}`)]
}

export interface EntryRow {
  entry: Entry
  budget: Budget
  month: Month
}

const matchesThing = (e: Entry, thing: string) => {
  const n = norm(thing)
  return !n || norm(e.label).includes(n) || n.includes(norm(e.label)) || (!!e.subcategory && norm(e.subcategory).includes(n))
}

/** Entries of the CURRENT period of each budget (or the one named), newest
 *  first, optionally narrowed to a category and/or a thing ("Uber"). */
export async function periodEntries(
  budgetName: string,
  category: string,
  thing: string,
  today: string,
  at?: string,
  /** Only this member's entries ("meus gastos"); undefined = the household. */
  email?: string,
  /** An explicit day / week / month: entries dated in it, whatever period. */
  range?: { from: string; to: string },
): Promise<EntryRow[]> {
  const { budgets, months } = await budgetsWithMonths()
  const named = budgetName ? pickBudget(budgets, budgetName) : null
  const pick = named ? [named] : budgets
  if (range) {
    const ids = new Set(pick.map((b) => b.id))
    const mine = months.filter((m) => ids.has(m.budget_id))
    if (!mine.length) return []
    const { data } = await supabase
      .from('entries')
      .select('*')
      .in('month_id', mine.map((m) => m.id))
      .gte('entry_date', range.from)
      .lte('entry_date', range.to)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
    return ((data ?? []) as Entry[])
      .filter((e) => (!category || e.category === category) && matchesThing(e, thing) && (!email || e.person_email === email))
      .map((e) => {
        const month = mine.find((m) => m.id === e.month_id)!
        return { entry: e, budget: pick.find((b) => b.id === month.budget_id)!, month }
      })
  }
  const periods = pick.map((b) => ({ budget: b, month: periodForBudget(b, months, at ?? today, !!at) })).filter((p): p is { budget: Budget; month: Month } => !!p.month)
  if (!periods.length) return []
  const { data } = await supabase
    .from('entries')
    .select('*')
    .in('month_id', periods.map((p) => p.month.id))
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
  return ((data ?? []) as Entry[])
    .filter((e) => (!category || e.category === category) && matchesThing(e, thing) && (!email || e.person_email === email))
    .map((e) => {
      const p = periods.find((x) => x.month.id === e.month_id)!
      return { entry: e, budget: p.budget, month: p.month }
    })
}

/** The entry a correction means: the latest one matching `thing`, else the
 *  latest one the asker logged (across every budget they can see). */
export async function lastEntry(thing: string, me: string, ref?: string): Promise<EntryRow | null> {
  const { data } = await supabase.from('entries').select('*').order('created_at', { ascending: false }).limit(80)
  const all = (data ?? []) as Entry[]
  // The model pointed at an entry it was shown ("e2"): exactly that one.
  const r = refTo(ref)
  const byRef = r?.kind === 'entry' ? all.find((e) => e.id === r.id) : undefined
  const hit = byRef ?? (thing.trim() ? all.find((e) => matchesThing(e, thing)) : (all.find((e) => e.person_email === me) ?? all[0]))
  if (!hit) return null
  const { budgets, months } = await budgetsWithMonths()
  const month = months.find((m) => m.id === hit.month_id)
  const budget = month ? budgets.find((b) => b.id === month.budget_id) : undefined
  return month && budget ? { entry: hit, budget, month } : null
}

export async function updateEntry(e: Entry, amount: number, label: string): Promise<Entry | null> {
  const patch: Partial<Entry> = {}
  if (amount > 0) patch.amount = amount
  if (label.trim()) patch.label = label.trim()
  const { data, error } = await supabase.from('entries').update(patch).eq('id', e.id).select('*').single()
  return error ? null : (data as Entry)
}

export async function restoreEntry(before: Entry): Promise<void> {
  await supabase.from('entries').update({ amount: before.amount, label: before.label }).eq('id', before.id)
}

export async function deleteEntryRow(e: Entry): Promise<boolean> {
  const { error } = await supabase.from('entries').delete().eq('id', e.id)
  return !error
}

/** Undo a deletion: the same row (same id) back. */
export async function reinsertEntry(e: Entry): Promise<void> {
  await supabase.from('entries').insert(e)
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

/** "Lola: Comida, Passeio" per pet, for the server. */
export async function petTasksContext(): Promise<string[]> {
  const { pets, tasks } = await petsAndTasks()
  return pets
    .map((p) => {
      const mine = tasks.filter((t) => t.pet_id === p.id).map((t) => t.title)
      return mine.length ? `${p.name}: ${mine.join(', ')}` : ''
    })
    .filter(Boolean)
}

export interface PetDoneResult {
  /** The completions written (Undo deletes these task/day pairs). */
  done: { task: PetCareTask; pet: string }[]
  missing: string[]
  /** No pet named and several have that task. */
  needPet: boolean
}

/** Mark routine tasks done today, for the pet named (or the only pet that has
 *  a task by that name). */
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
    // No pet named: only when one pet has it (else "which pet?").
    const owners = new Set(hits.map((t) => t.pet_id))
    if (!pet && owners.size > 1) {
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
  if (done.length) notifyPetCareChange()
  return { done, missing, needPet }
}

export async function undoPetTasksDone(done: PetDoneResult['done'], today: string): Promise<void> {
  for (const d of done) await supabase.from('pet_task_done').delete().eq('task_id', d.task.id).eq('done_on', today)
  if (done.length) notifyPetCareChange()
}

export type PetLogResult = { ok: true; ev: PetEvent; pet: string } | { ok: false; reason: 'no_pet' }

export async function logPetEvent(
  petName: string,
  type: PetEventType,
  title: string,
  date: string,
  next: string,
  me: string,
): Promise<PetLogResult> {
  const { pets } = await petsAndTasks()
  const pet = findPet(pets, petName)
  if (!pet) return { ok: false, reason: 'no_pet' }
  const { data, error } = await supabase
    .from('pet_events')
    .insert({
      pet_id: pet.id,
      type,
      title: title.trim() || type,
      notes: null,
      event_date: date,
      next_due: next && next > date ? next : null,
      added_by: me,
    })
    .select('*')
    .single()
  if (error || !data) return { ok: false, reason: 'no_pet' }
  notifyPetCareChange()
  return { ok: true, ev: data as PetEvent, pet: pet.name }
}

export async function deletePetEvent(id: string): Promise<void> {
  await supabase.from('pet_events').delete().eq('id', id)
  notifyPetCareChange()
}

export interface PetNextRow {
  pet: string
  title: string
  type: PetEventType
  due: string
  last: string
}

/** When each kind of care is next due: the LATEST event per pet+title that
 *  has a next due date, soonest first. */
export async function petNextDue(petName: string, type: PetEventType | ''): Promise<{ rows: PetNextRow[]; pet: string }> {
  const [{ pets }, { data }] = await Promise.all([petsAndTasks(), supabase.from('pet_events').select('*').order('event_date', { ascending: false })])
  const pet = petName ? findPet(pets, petName) : null
  const latest = new Map<string, PetEvent>()
  for (const e of (data ?? []) as PetEvent[]) {
    if (pet && e.pet_id !== pet.id) continue
    if (type && e.type !== type) continue
    const key = `${e.pet_id}:${norm(e.title)}`
    if (!latest.has(key)) latest.set(key, e)
  }
  const rows = [...latest.values()]
    .filter((e) => !!e.next_due)
    .map((e) => ({ pet: pets.find((p) => p.id === e.pet_id)?.name ?? '', title: e.title, type: e.type, due: e.next_due!, last: e.event_date }))
    .sort((a, b) => a.due.localeCompare(b.due))
  return { rows, pet: pet?.name ?? '' }
}

export type WeightResult = { ok: true; id: string; pet: string; previous: number | null } | { ok: false }

export async function logPetWeight(petName: string, weight: number, today: string): Promise<WeightResult> {
  const { pets } = await petsAndTasks()
  const pet = findPet(pets, petName)
  if (!pet) return { ok: false }
  const { data: prev } = await supabase
    .from('pet_weights')
    .select('weight')
    .eq('pet_id', pet.id)
    .order('measured_on', { ascending: false })
    .limit(1)
  const { data, error } = await supabase.from('pet_weights').insert({ pet_id: pet.id, weight, measured_on: today }).select('id').single()
  if (error || !data) return { ok: false }
  const p = (prev ?? [])[0] as { weight: number } | undefined
  return { ok: true, id: (data as { id: string }).id, pet: pet.name, previous: p ? Number(p.weight) : null }
}

export async function deletePetWeight(id: string): Promise<void> {
  await supabase.from('pet_weights').delete().eq('id', id)
}

// ── family ───────────────────────────────────────────────────────────────────

/** Change one stored detail; returns the old value for Undo. */
export async function setFamilyField(email: string, field: FamilyField, value: string | null): Promise<{ ok: boolean; previous: string | null }> {
  const { data } = await supabase.from('member_profiles').select('*').eq('email', email).maybeSingle()
  const previous = ((data as MemberProfile | null)?.[field] as string | null | undefined) ?? null
  const { error } = await supabase
    .from('member_profiles')
    .upsert({ email, [field]: value, updated_at: new Date().toISOString() }, { onConflict: 'email' })
  return { ok: !error, previous }
}

// ── location ─────────────────────────────────────────────────────────────────

export type WhereResult =
  | { ok: true; person: Profile; place: string | null; address: string | null; minutesAgo: number; battery: number | null; atAsked: boolean | null }
  | { ok: false; reason: 'no_person' | 'not_sharing' | 'paused' | 'no_fix'; person: Profile | null }

/** Where a member is: the saved place they're inside, else a street address
 *  (on-device geocoder), and how fresh that is. Respects their sharing: off or
 *  paused says so and shows nothing. `asked` = "did they get to X?". */
export async function whereIs(person: Profile | null, asked: string): Promise<WhereResult> {
  if (!person) return { ok: false, reason: 'no_person', person: null }
  const [locs, places] = await Promise.all([fetchMemberLocations(), fetchPlaces().catch(() => [])])
  const loc = locs.find((l) => l.user_email === person.email)
  if (isPaused(loc)) return { ok: false, reason: 'paused', person }
  if (!loc?.sharing) return { ok: false, reason: 'not_sharing', person }
  if (!isSharingLive(loc)) return { ok: false, reason: 'no_fix', person }
  const here = placeAt(places, { lat: loc.lat, lng: loc.lng })
  let address: string | null = null
  if (!here) {
    try {
      const a = (await Location.reverseGeocodeAsync({ latitude: loc.lat, longitude: loc.lng }))[0]
      if (a) address = [a.name || a.street, a.city].filter(Boolean).join(', ') || null
    } catch {
      /* no address is fine */
    }
  }
  const n = norm(asked)
  const atAsked = n ? !!here && (norm(here.name).includes(n) || n.includes(norm(here.name))) : null
  return {
    ok: true,
    person,
    place: here?.name ?? null,
    address,
    minutesAgo: Math.max(0, Math.round((Date.now() - new Date(loc.updated_at).getTime()) / 60_000)),
    battery: loc.battery,
    atAsked,
  }
}

// ── nudges ───────────────────────────────────────────────────────────────────

/** Who has seen the asker's latest still-active nudge. */
export async function lastNudgeSeen(me: string, profiles: Profile[]): Promise<{ message: string; emoji: string; seen: string[]; notYet: string[] } | null> {
  const mine = (await fetchActivePings()).filter((p) => p.sender_email === me)
  const p = mine[0]
  if (!p) return null
  const audience = (p.recipients ?? profiles.map((x) => x.email)).filter((e) => e !== me)
  const acked = new Set(p.acks.map((a) => a.user_email))
  const name = (e: string) => profiles.find((x) => x.email === e)?.display_name.split(' ')[0] ?? e
  return {
    message: p.message,
    emoji: p.emoji,
    seen: audience.filter((e) => acked.has(e)).map(name),
    notYet: audience.filter((e) => !acked.has(e)).map(name),
  }
}

// ── shopping ─────────────────────────────────────────────────────────────────

async function stores(): Promise<ShoppingStore[]> {
  const { data } = await supabase.from('shopping_stores').select('*').order('created_at')
  return (data ?? []) as ShoppingStore[]
}

function matchLabels(said: string[], pool: ShoppingItem[]): { hits: ShoppingItem[]; missing: string[] } {
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

export type MoveItemsResult =
  | { ok: true; moved: ShoppingItem[]; missing: string[]; store: ShoppingStore }
  | { ok: false; reason: 'no_store'; store: string }

/** Move open items to another (existing) store. Undo = restoreStores(moved). */
export async function moveItemsTo(said: string[], storeName: string): Promise<MoveItemsResult> {
  const store = matchStore(storeName, await stores())
  if (!store) return { ok: false, reason: 'no_store', store: storeName }
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

/** Put bought items back as still to buy. Undo = check them again. */
export async function uncheckSaid(said: string[]): Promise<{ hits: ShoppingItem[]; missing: string[] }> {
  const { data } = await supabase.from('shopping_items').select('*').eq('checked', true).order('checked_at', { ascending: false })
  const r = matchLabels(said, (data ?? []) as ShoppingItem[])
  if (r.hits.length) await supabase.from('shopping_items').update({ checked: false, checked_at: null }).in('id', r.hits.map((i) => i.id))
  return r
}

export async function recheck(items: ShoppingItem[]): Promise<void> {
  for (const i of items) await supabase.from('shopping_items').update({ checked: true, checked_at: i.checked_at }).eq('id', i.id)
}

// ── weather ──────────────────────────────────────────────────────────────────

export type WeatherKind = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

export type DayWeather =
  | { ok: true; city: string; min: number; max: number; rain: number; kind: WeatherKind; unit: string }
  | { ok: false; reason: 'no_city' | 'too_far' | 'failed' }

const kindOf = (code: number): WeatherKind =>
  code >= 95 ? 'storm' : code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82 ? 'snow' : code >= 61 ? 'rain' : code >= 51 ? 'drizzle' : code >= 45 ? 'fog' : code >= 2 ? 'cloudy' : 'clear'

/** The forecast for one day at the Home's weather city (Open-Meteo, the same
 *  source as the Home card; up to 16 days ahead). */
export async function weatherFor(date: string, today: string, celsius: boolean): Promise<DayWeather> {
  const home = await loadHomeLocation()
  if (!home) return { ok: false, reason: 'no_city' }
  const ahead = Math.round((new Date(date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86_400_000)
  if (ahead < 0 || ahead > 15) return { ok: false, reason: 'too_far' }
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

// ── which is cheaper ─────────────────────────────────────────────────────────

export interface DealRow extends Deal {
  perUnit: number
  best: boolean
}

/** Price per unit of each option; the cheapest marked, plus how much cheaper
 *  it is than the next best (%). */
export function compareDeals(deals: Deal[]): { rows: DealRow[]; savingPct: number } {
  const rows = deals.map((d) => ({ ...d, perUnit: d.price / d.size, best: false }))
  const sorted = [...rows].sort((a, b) => a.perUnit - b.perUnit)
  sorted[0].best = true
  const savingPct = sorted.length > 1 ? Math.round((1 - sorted[0].perUnit / sorted[1].perUnit) * 100) : 0
  return { rows, savingPct }
}

// ── documents ────────────────────────────────────────────────────────────────

/** Documents matching what was said (title, or its category id), of the
 *  member named when one was. Opening goes through the vault (and its lock). */
export async function findDocuments(said: string, owner: Profile | null): Promise<FamilyDocument[]> {
  const { data } = await supabase.from('documents').select('*').order('created_at', { ascending: false })
  const n = norm(said)
  const pool = ((data ?? []) as FamilyDocument[]).filter((d) => !owner || d.owner_email === owner.email)
  const exact = pool.filter((d) => norm(d.title) === n)
  if (exact.length) return exact
  const words = n.split(/\s+/).filter((w) => w.length > 2)
  return pool.filter(
    (d) => norm(d.title).includes(n) || n.includes(norm(d.title)) || norm(d.category) === n || (words.length > 0 && words.every((w) => norm(d.title).includes(w))),
  )
}

// ── a day overview ───────────────────────────────────────────────────────────

/** Active nudges addressed to me (or to everyone) that I haven't seen. */
export async function unseenNudges(me: string): Promise<{ emoji: string; message: string; from: string }[]> {
  const pings = await fetchActivePings()
  return pings
    .filter((p) => p.sender_email !== me && (!p.recipients || p.recipients.includes(me)) && !p.acks.some((a) => a.user_email === me))
    .map((p) => ({ emoji: p.emoji, message: p.message, from: p.sender_email }))
}

