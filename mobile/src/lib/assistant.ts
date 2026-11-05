// The Home's "ask anything" bar. Two halves, deliberately split:
//  - UNDERSTANDING: `/api/suggest-ping?action=assistant` turns free text into an
//    intent (Claude Haiku, structured output). When that's unreachable (offline,
//    not deployed, AI paused) `localParse` covers the two everyday phrasings.
//  - DOING: everything below runs with the user's OWN Supabase session, so RLS
//    stays the boundary — the server never writes household data for this.
import { supabase } from './supabase'
import { STORE_CATALOG } from './stores'
import { compareOccurrences, occurrencesByDay, type Occurrence } from './calendar'
import { overdueEvents } from './petCare'
import type { CalendarEvent, PetEvent, Profile, ShoppingItem, ShoppingStore } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export type Scope = 'me' | 'all' | 'person'
export type Intent =
  | { intent: 'add_items'; items: string[]; store: string }
  | { intent: 'agenda'; scope: Scope; person: string; date: string }
  | { intent: 'unknown'; reply: string }

export interface AskContext {
  today: string
  weekday: string
  lang: string
  stores: string[]
  members: string[]
  me: string
}

// ── understanding ────────────────────────────────────────────────────────────

/** Ask the server; fall back to the local parser when it can't answer. Returns
 *  null only when neither understood the request. */
export async function understand(text: string, ctx: AskContext): Promise<Intent | null> {
  const remote = await askServer(text, ctx)
  if (remote && remote.intent !== 'unknown') return remote
  return localParse(text, ctx.today) ?? remote
}

async function askServer(text: string, ctx: AskContext): Promise<Intent | null> {
  if (!API_BASE) return null
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return null
    const res = await fetch(`${API_BASE}/api/suggest-ping?action=assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, ...ctx }),
    })
    if (!res.ok) return null
    const j = await res.json()
    // An older deploy answers this URL as a plain nudge ({kind, emoji, message}),
    // which has no `intent` — treat it as "server can't do this yet".
    if (j?.intent === 'add_items' && Array.isArray(j.items) && j.items.length) {
      return { intent: 'add_items', items: j.items, store: j.store ?? '' }
    }
    if (j?.intent === 'agenda') {
      return { intent: 'agenda', scope: j.scope ?? 'me', person: j.person ?? '', date: j.date ?? ctx.today }
    }
    if (j?.intent === 'unknown') return { intent: 'unknown', reply: j.reply ?? '' }
    return null
  } catch {
    return null
  }
}

const ADD_VERB =
  /^(?:por favor,?\s+)?(?:adicion[ae](?:r)?|coloc[ae](?:r)?|p[oõ]e|bota|inclu[ia](?:r)?|add|put|agreg[ae](?:r)?|añad[ei](?:r)?|pon)\s+/i
// "na lista do Walmart", "to the Walmart list", "a la lista de Walmart", "no Walmart"
const LIST_AFTER = /\s+(?:na|à|a|no|en|para|pra)\s+(?:minha\s+|nossa\s+|la\s+)?lista\s+(?:d[aeo]s?\s+|de\s+(?:la\s+|el\s+)?)?(.+)$/i
const LIST_BEFORE = /\s+(?:to|on|in)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:shopping\s+)?list$/i
const PLAIN_LIST = /\s+(?:na|à|a|no|en|to|on|in)\s+(?:minha\s+|nossa\s+|la\s+|the\s+|my\s+)?(?:lista|list)(?:\s+de\s+compras|\s+of\s+groceries)?$/i

/** The two phrasings people use most, in pt/en/es. Deliberately narrow — the
 *  server parse is the real thing; this keeps the bar useful offline. */
export function localParse(raw: string, today: string): Intent | null {
  const text = raw.trim().replace(/[.!?]+$/, '')
  if (ADD_VERB.test(text)) {
    let rest = text.replace(ADD_VERB, '')
    let store = ''
    const after = rest.match(LIST_AFTER)
    const before = rest.match(LIST_BEFORE)
    if (after) {
      store = after[1]
      rest = rest.slice(0, after.index)
    } else if (before) {
      store = before[1]
      rest = rest.slice(0, before.index)
    } else {
      rest = rest.replace(PLAIN_LIST, '')
    }
    const items = rest
      .split(/\s*,\s*|\s+(?:e|and|y)\s+/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    if (items.length) return { intent: 'add_items', items, store: store.trim() }
  }
  const lower = text.toLowerCase()
  // \b is ASCII-only in JS, so "amanhã" never ends on one — bound by letters.
  // (An explicit Latin letter class rather than \\p{L}: safest across JS engines.)
  const word = (alts: string) => new RegExp(`(?<![a-zà-öø-ÿ])(?:${alts})(?![a-zà-öø-ÿ])`)
  if (word('hoje|today|hoy|amanh[ãa]|tomorrow|mañana|agenda|calend[aá]rio|calendar').test(lower)) {
    const tomorrow = word('amanh[ãa]|tomorrow|mañana').test(lower)
    const all = word('todos|todo el mundo|everyone|everybody|family|fam[ií]lia|a gente|us all').test(lower)
    return { intent: 'agenda', scope: all ? 'all' : 'me', person: '', date: tomorrow ? addDay(today) : today }
  }
  return null
}

function addDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// ── doing: shopping ──────────────────────────────────────────────────────────

export interface AddResult {
  store: ShoppingStore | null
  added: ShoppingItem[]
  /** Already on that list (open), so not added twice. */
  existing: string[]
  /** The rest of that list's open items, for context under the new ones. */
  others: ShoppingItem[]
  /** The store didn't exist and was made for this request (Undo removes it). */
  createdStore: boolean
}

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Find the household's store by name (or the catalog's spelling of it), and
 *  create it when it's new — saying "the Costco list" should just work. */
async function resolveStore(
  name: string,
  stores: ShoppingStore[],
): Promise<{ store: ShoppingStore | null; created: boolean }> {
  const wanted = norm(name)
  if (!wanted) return { store: null, created: false }
  const catalog = STORE_CATALOG.find((e) => norm(e.name) === wanted || e.slug === wanted.replace(/[^a-z0-9]/g, ''))
  const hit = stores.find((s) => norm(s.name) === wanted || (catalog && s.slug === catalog.slug))
  if (hit) return { store: hit, created: false }
  const { data, error } = await supabase
    .from('shopping_stores')
    .insert({ name: catalog?.name ?? name.trim(), slug: catalog?.slug ?? null, color: null })
    .select('*')
    .single()
  if (error) throw error
  return { store: data as ShoppingStore, created: true }
}

export async function addItems(items: string[], storeName: string, addedBy: string): Promise<AddResult> {
  const [{ data: storeRows }, { data: openRows }] = await Promise.all([
    supabase.from('shopping_stores').select('*'),
    supabase.from('shopping_items').select('*').eq('checked', false).order('created_at'),
  ])
  const { store, created } = await resolveStore(storeName, (storeRows ?? []) as ShoppingStore[])
  const storeId = store?.id ?? null
  const open = ((openRows ?? []) as ShoppingItem[]).filter((i) => i.store_id === storeId)
  const have = new Set(open.map((i) => norm(i.label)))
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
      .insert(fresh.map((label) => ({ label, added_by: addedBy, store_id: storeId })))
      .select('*')
    if (error) throw error
    added = (data ?? []) as ShoppingItem[]
  }
  return { store, added, existing, others: open, createdStore: created }
}

/** Take back what one request added — and the store, if the request made it. */
export async function undoAdd(ids: string[], createdStoreId?: string): Promise<void> {
  if (ids.length) {
    const { error } = await supabase.from('shopping_items').delete().in('id', ids)
    if (error) throw error
  }
  if (createdStoreId) await supabase.from('shopping_stores').delete().eq('id', createdStoreId)
}

// ── doing: agenda ────────────────────────────────────────────────────────────

export interface AgendaRow {
  key: string
  title: string
  /** 'HH:MM' or null for all-day / pet care. */
  start: string | null
  end: string | null
  kind: 'event' | 'pet'
  ownerEmail: string | null
  color: string | null
  location: string | null
}

export interface AgendaAnswer {
  date: string
  scope: Scope
  person: Profile | null
  rows: AgendaRow[]
  /** When the asked-about list is empty: what the rest of the house has. */
  others: AgendaRow[]
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

function eventRow(o: Occurrence): AgendaRow {
  const ev = o.event
  return {
    key: `${ev.id}:${o.start}`,
    title: ev.title,
    start: ev.all_day ? null : hhmm(ev.start_time),
    end: ev.all_day ? null : hhmm(ev.end_time),
    kind: 'event',
    ownerEmail: ev.owner_email,
    color: ev.color,
    location: ev.location,
  }
}

/** Find a member by the name the user said — first name is enough. */
export function findMember(name: string, profiles: Profile[]): Profile | null {
  const n = norm(name)
  if (!n) return null
  return (
    profiles.find((p) => norm(p.display_name) === n) ??
    profiles.find((p) => norm(p.display_name).split(/\s+/)[0] === n.split(/\s+/)[0]) ??
    null
  )
}

export async function agendaFor(
  date: string,
  scope: Scope,
  personName: string,
  me: Profile | null,
  profiles: Profile[],
  today: string,
): Promise<AgendaAnswer> {
  const [{ data: ev }, petRes] = await Promise.all([
    supabase.from('calendar_events').select('*'),
    date === today
      ? Promise.all([
          supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
          supabase.from('pets').select('id, name'),
        ])
      : Promise.resolve(null),
  ])
  const occ = [...(occurrencesByDay((ev ?? []) as CalendarEvent[], date, date).get(date) ?? [])].sort(compareOccurrences)
  let all: AgendaRow[] = occ.map(eventRow)
  // Pet care is the household's, so it shows for "me" and "all" alike.
  if (petRes) {
    const [pe, pets] = petRes
    const names = Object.fromEntries(((pets.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
    const due = overdueEvents((pe.data ?? []) as PetEvent[], today)
    all = all.concat(
      due.map((e) => ({
        key: `pet:${e.id}`,
        title: names[e.pet_id] ? `${e.title} · ${names[e.pet_id]}` : e.title,
        start: null,
        end: null,
        kind: 'pet' as const,
        ownerEmail: null,
        color: null,
        location: null,
      })),
    )
  }
  const person = scope === 'person' ? findMember(personName, profiles) : scope === 'me' ? me : null
  const effective: Scope = scope === 'person' && !person ? 'all' : scope
  // Someone's day = their own events plus the whole-household ones.
  const mine = (r: AgendaRow) => r.ownerEmail === null || r.ownerEmail === person?.email
  const rows = effective === 'all' ? all : all.filter(mine)
  const others = rows.length ? [] : all.filter((r) => !mine(r))
  return { date, scope: effective, person: effective === 'all' ? null : person, rows, others }
}
