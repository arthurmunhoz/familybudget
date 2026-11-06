// The Home's "ask anything" bar. Two halves, deliberately split:
//  - UNDERSTANDING: `/api/suggest-ping?action=assistant` turns free text into an
//    intent (Claude Haiku, structured output). When that's unreachable (offline,
//    not deployed, AI paused) `localParse` covers the everyday phrasings.
//  - DOING: everything below runs with the user's OWN Supabase session, so RLS
//    stays the boundary — the server never writes household data for this.
// Anything that reaches OTHER people (a nudge) is never done straight away: the
// sheet shows it and waits for a tap. Writes come back with what Undo needs.
import { supabase } from './supabase'
import { STORE_CATALOG } from './stores'
import { compareOccurrences, occurrencesByDay, type Occurrence } from './calendar'
import { dailyChecklist, overdueCare, overdueEvents } from './petCare'
import { suggestCategory } from './categories'
import { addDaysISO, periodEndISO } from './format'
import { notifyPetCareChange } from './petCareNotify'
import type {
  Budget,
  CalendarEvent,
  CategoryRule,
  MemberProfile,
  Month,
  PetCareTask,
  PetEvent,
  PetTaskDone,
  Profile,
  ShoppingItem,
  ShoppingStore,
} from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export type Scope = 'me' | 'all' | 'person'
export type FamilyField =
  | 'phone'
  | 'blood_type'
  | 'height'
  | 'weight'
  | 'shoe_size'
  | 'pants_size'
  | 'shirt_size'
  | 'allergies'
  | 'birthday'
export type Intent =
  | { intent: 'add_items'; items: string[]; store: string }
  | { intent: 'list_items'; store: string }
  | { intent: 'find_items'; items: string[]; reply: string }
  | { intent: 'check_items'; items: string[] }
  | { intent: 'remove_items'; items: string[] }
  | { intent: 'agenda'; scope: Scope; person: string; date: string; end: string; label: string }
  | { intent: 'add_event'; title: string; date: string; time: string; person: string }
  | { intent: 'add_money'; title: string; amount: number; type: 'expense' | 'income'; date: string; budget: string }
  | { intent: 'money_summary'; budget: string }
  | { intent: 'send_nudge'; message: string; person: string }
  | { intent: 'pets_due'; pet: string }
  | { intent: 'family_info'; person: string; field: FamilyField | '' }
  | { intent: 'open_app'; app: string }
  | { intent: 'split_bill'; amount: number; people: number; mode: 'even' | 'items' | ''; tip: number }
  | { intent: 'discount'; amount: number; percent: number }
  | { intent: 'unknown'; reply: string }

export interface AskContext {
  today: string
  weekday: string
  lang: string
  stores: string[]
  members: string[]
  budgets: string[]
  pets: string[]
  /** What's still to buy, "label @ store" — Claude matches questions to it. */
  openItems: string[]
  me: string
  /** This conversation so far, oldest first: what was asked and a one-line
   *  account of what the app answered — so "remove the milk" / "and for
   *  Lola?" resolve against the previous turn. */
  history?: { q: string; a: string }[]
}

// ── understanding ────────────────────────────────────────────────────────────

/** Ask the server; fall back to the local parser when it can't answer. Returns
 *  null only when neither understood the request. */
export async function understand(text: string, ctx: AskContext): Promise<Intent | null> {
  const remote = await askServer(text, ctx)
  const local = localParse(text, ctx.today)
  // A server that answered a single day to "this month" (an older deploy, or a
  // miss) loses to a period the local parser can see in the words.
  if (remote?.intent === 'agenda' && remote.end === remote.date && local?.intent === 'agenda' && local.end > local.date) {
    return { ...remote, date: local.date, end: local.end }
  }
  // The utilities are clear-cut phrasings; an older server that doesn't know
  // them yet would file "divide 58,71 em 3" as an expense.
  if ((local?.intent === 'split_bill' || local?.intent === 'discount') && remote?.intent !== local.intent) return local
  // A pet of THIS household named next to "need / next / routine…" is a
  // routine question, whatever an older server made of it ("what does Lola
  // need next today?" came back as family_info / unknown — owner, 2026-11).
  const pet = petQuestion(text, ctx.pets, ctx.members)
  if (pet && (remote?.intent !== 'pets_due' || !remote.pet)) return { intent: 'pets_due', pet }
  if (remote && remote.intent !== 'unknown') return remote
  return local ?? remote
}

/** The server's JSON → a typed intent (null when it isn't usable). */
export function fromServer(j: Record<string, unknown> | null, today: string): Intent | null {
  if (!j || typeof j.intent !== 'string') return null
  const str = (k: string) => (typeof j[k] === 'string' ? (j[k] as string) : '')
  const items = Array.isArray(j.items) ? (j.items as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str('date')) ? str('date') : today
  switch (j.intent) {
    case 'add_items':
      return items.length ? { intent: 'add_items', items, store: str('store') } : null
    case 'list_items':
      return { intent: 'list_items', store: str('store') }
    case 'find_items':
      // Empty `items` is a real answer here: "no, that's not on the list".
      return { intent: 'find_items', items, reply: str('reply') }
    case 'check_items':
      return items.length ? { intent: 'check_items', items } : null
    case 'remove_items':
      return items.length ? { intent: 'remove_items', items } : null
    case 'agenda': {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(str('date_end')) && str('date_end') > date ? str('date_end') : date
      return { intent: 'agenda', scope: (str('scope') as Scope) || 'me', person: str('person'), date, end, label: str('reply') }
    }
    case 'add_event':
      return str('title') ? { intent: 'add_event', title: str('title'), date, time: str('time'), person: str('person') } : null
    case 'add_money': {
      const amount = typeof j.amount === 'number' ? j.amount : 0
      if (!(amount > 0)) return null
      return {
        intent: 'add_money',
        title: str('title'),
        amount,
        type: str('money_type') === 'income' ? 'income' : 'expense',
        date,
        budget: str('budget'),
      }
    }
    case 'money_summary':
      return { intent: 'money_summary', budget: str('budget') }
    case 'send_nudge':
      return str('title') ? { intent: 'send_nudge', message: str('title'), person: str('person') } : null
    case 'pets_due':
      return { intent: 'pets_due', pet: str('pet') }
    case 'family_info':
      return { intent: 'family_info', person: str('person'), field: str('field') as FamilyField | '' }
    case 'open_app':
      return str('app') ? { intent: 'open_app', app: str('app') } : null
    case 'split_bill': {
      const num = (k: string) => (typeof j[k] === 'number' ? (j[k] as number) : 0)
      const mode = str('split_mode')
      return {
        intent: 'split_bill',
        amount: num('amount') > 0 ? num('amount') : 0,
        people: num('people') >= 1 ? Math.floor(num('people')) : 0,
        mode: mode === 'even' || mode === 'items' ? mode : '',
        tip: num('tip_pct') > 0 ? num('tip_pct') : 0,
      }
    }
    case 'discount': {
      const amount = typeof j.amount === 'number' ? j.amount : 0
      const percent = typeof j.percent === 'number' ? j.percent : 0
      return amount > 0 && percent > 0 ? { intent: 'discount', amount, percent } : null
    }
    case 'unknown':
      return { intent: 'unknown', reply: str('reply') }
    default:
      return null
  }
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
    // An older deploy answers this URL as a plain nudge ({kind, emoji, message}),
    // which has no `intent` — fromServer treats it as "can't do this yet".
    return fromServer(await res.json(), ctx.today)
  } catch {
    return null
  }
}

/** "lista de compras", "shopping list", "mercado"… name the LIST, not a store. */
const GENERIC_LIST = /^(?:as\s+|os\s+)?(?:compras?|supermercado|mercado|shopping|groceries|grocery|la compra|super)$/i

const ADD_VERB =
  /^(?:por favor,?\s+)?(?:adicion[ae](?:r)?|coloc[ae](?:r)?|p[oõ]e|bota|inclu[ia](?:r)?|add|put|agreg[ae](?:r)?|añad[ei](?:r)?|pon)\s+/i
// "na lista do Walmart", "to the Walmart list", "a la lista de Walmart", "no Walmart"
const LIST_AFTER = /\s+(?:na|à|a|no|en|para|pra)\s+(?:minha\s+|nossa\s+|la\s+)?lista\s+(?:d[aeo]s?\s+|de\s+(?:la\s+|el\s+)?)?(.+)$/i
const LIST_BEFORE = /\s+(?:to|on|in)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:shopping\s+)?list$/i
const PLAIN_LIST = /\s+(?:na|à|a|no|en|to|on|in)\s+(?:minha\s+|nossa\s+|la\s+|the\s+|my\s+)?(?:lista|list)(?:\s+de\s+compras|\s+of\s+groceries)?$/i

/** The two phrasings people use most, in pt/en/es. Deliberately narrow — the
 *  server parse is the real thing; this keeps the bar useful offline. */
/** "58,71" / "58.71" / "$58.71" / "1.234,56" → 58.71 */
function money(s: string): number {
  const t = s.replace(/[^\d.,]/g, '')
  if (!t) return 0
  const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'))
  const decimals = lastSep >= 0 && t.length - lastSep - 1 <= 2 ? t.slice(lastSep + 1) : ''
  const whole = (decimals ? t.slice(0, lastSep) : t).replace(/[.,]/g, '')
  return Number(`${whole}${decimals ? `.${decimals}` : ''}`) || 0
}

const PET_NEED =
  /\b(?:need|needs|next|left|routine|due|fed|feed|eat|ate|walk|walked|precisa|precisam|pr[oó]xim[ao]|falta|faltam|rotina|comeu|comer|passear|passeou|necesita|necesitan|siguiente|rutina|toca)\b/

/** The pet a question is about, when it names one of the household's pets
 *  AND asks what it needs ("what does Lola need next today?", "o que falta
 *  pra Chloe?", "a Lola já comeu?"). "" when it isn't that kind of question. */
export function petQuestion(raw: string, pets: string[], members: string[] = []): string {
  const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const lw = fold(raw)
  if (!PET_NEED.test(lw)) return ''
  const words = lw.split(/[^a-z0-9]+/).filter(Boolean)
  const firsts = pets.map((name) => ({ name, n: fold(name).trim(), first: fold(name).trim().split(/\s+/)[0] }))
  // the whole name, or its first word ("Lola" for "Lola Bean")
  for (const p of firsts) if (p.n && (lw.includes(p.n) || words.includes(p.first))) return p.name
  // One slip away — autocorrect and dictation turn "Cloe" into "Cole" — as
  // long as the word isn't a family member's name.
  const people = new Set(members.map((m) => fold(m).split(/\s+/)[0]))
  for (const w of words) {
    if (w.length < 4 || people.has(w)) continue
    const hit = firsts.find((p) => p.first.length >= 4 && oneSlip(w, p.first))
    if (hit) return hit.name
  }
  return ''
}

/** Equal but for one substitution, insertion, deletion or swap of neighbours. */
function oneSlip(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const diff = [...a].map((ch, i) => (ch === b[i] ? -1 : i)).filter((i) => i >= 0)
    if (diff.length === 1) return true
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
  }
  const [s1, l1] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l1.length; i++) if (l1.slice(0, i) + l1.slice(i + 1) === s1) return true
  return false
}

export function localParse(raw: string, today: string): Intent | null {
  // "58 dólares e 71 centavos" → "58.71" (how people SAY an amount)
  const text = raw
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/(\d+)\s*(?:d[oó]lares|reais|dollars|pesos|euros)\s*(?:e|and|y)\s*(\d{1,2})\s*(?:centavos|cents|c[eé]ntimos)/gi, (_m, a, b) => `${a}.${String(b).padStart(2, '0')}`)
  const lw = text.toLowerCase()
  // "divide 58,71 em 3", "split $58.71 between 3 (equally)", "dividir 120 entre 4 por item"
  const split = lw.match(/(?:divid\w*|rach\w*|split|repart\w*)\b.*?(\$?\s?\d[\d.,]*)\s*(?:d[oó]lares|reais|dollars|bucks|pesos)?\b.*?\b(?:em|entre|por|in|into|between|among|para|entre)\s+(\d+)/)
  if (split) {
    const mode = /\b(igual|iguais|igualmente|equal|equally|evenly|partes iguais)\b/.test(lw)
      ? 'even'
      : /\b(por item|por produto|by item|per item|each ordered|cada um pediu|por art[ií]culo)\b/.test(lw)
        ? 'items'
        : ''
    const tipM = lw.match(/(\d{1,2})\s*%\s*(?:de\s+)?(?:gorjeta|tip|propina)/)
    return { intent: 'split_bill', amount: money(split[1]), people: Number(split[2]), mode, tip: tipM ? Number(tipM[1]) : 0 }
  }
  // "80 com 30% de desconto", "30% off 80", "quanto fica 120 com 15% off"
  const off1 = lw.match(/(\$?\d[\d.,]*)\D{0,25}?(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:de\s+)?(?:desconto|off|descuento)/)
  const off2 = lw.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:de\s+desconto\s+)?(?:off|desconto|descuento)\s+(?:em|on|de|sobre|of)?\s*(\$?\d[\d.,]*)/)
  if (off2) return { intent: 'discount', amount: money(off2[2]), percent: Number(off2[1].replace(',', '.')) }
  if (off1) return { intent: 'discount', amount: money(off1[1]), percent: Number(off1[2].replace(',', '.')) }
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
    if (GENERIC_LIST.test(store.trim())) store = ''
    const items = rest
      .split(/\s*,\s*|\s+(?:e|and|y)\s+/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    if (items.length) return { intent: 'add_items', items, store: store.trim() }
  }
  const lower = text.toLowerCase()
  // "tira o leite da lista", "apaga pão e ovos", "remove milk from the list"
  const removeAsk = text.match(
    /^(?:por favor,?\s+)?(?:tir[ae]r?|remov[ae]r?|apag[ae]r?|delet[ae]r?|exclu[ia]r?|risc[ae]r?|remove|delete|take|quit[ae]r?|borr[ae]r?|elimin[ae]r?)\s+(.+?)(?:\s+(?:da|de|do|from|off|of)\s+(?:a\s+|the\s+|my\s+|minha\s+|la\s+)?(?:shopping\s+)?(?:lista|list)(?:\s+de\s+compras)?)?$/i,
  )
  if (removeAsk) {
    const items = splitItems(removeAsk[1].replace(/\s+off$/i, ''))
    if (items.length) return { intent: 'remove_items', items }
  }
  // "já comprei leite", "comprei o pão", "I bought milk", "ya compré leche"
  const boughtAsk = text.match(/^(?:já\s+|ya\s+)?(?:comprei|peguei|compré|bought|i bought|i got|got)\s+(.+)$/i)
  if (boughtAsk) {
    const items = splitItems(boughtAsk[1])
    if (items.length) return { intent: 'check_items', items }
  }
  // "tem leite na lista?", "is there milk on the list?"
  const findAsk = lower.match(/^(?:(?:será que\s+)?tem|há|is there|are there|do we have|hay)\s+(.+?)\s+(?:na|in|on|en)\s+(?:a\s+|the\s+|my\s+|minha\s+|la\s+)?(?:shopping\s+|grocery\s+)?(?:lista|list)\b/)
  if (findAsk) {
    const what = findAsk[1].replace(/^(?:any|some|algum[a]?|um[a]?)\s+/, '').trim()
    if (what) return { intent: 'find_items', items: [what], reply: '' }
  }
  // "o que tem na lista (do Walmart)?", "what's on the shopping list?"
  const listAsk = lower.match(/(?:o que|que|what).*\b(?:lista|list)\b(?:\s+(?:d[aeo]s?|de|from|at)\s+(.+))?/)
  if (listAsk) {
    const st = (listAsk[1] ?? '').replace(/[?!.]+$/, '').trim()
    return { intent: 'list_items', store: GENERIC_LIST.test(st) ? '' : st }
  }
  // \b is ASCII-only in JS, so "amanhã" never ends on one — bound by letters.
  // (An explicit Latin letter class rather than \\p{L}: safest across JS engines.)
  const word = (alts: string) => new RegExp(`(?<![a-zà-öø-ÿ])(?:${alts})(?![a-zà-öø-ÿ])`)
  if (word('hoje|today|hoy|amanh[ãa]|tomorrow|mañana|agenda|calend[aá]rio|calendar').test(lower)) {
    const tomorrow = word('amanh[ãa]|tomorrow|mañana').test(lower)
    const all = word('todos|todo el mundo|everyone|everybody|family|fam[ií]lia|a gente|us all').test(lower)
    const scope = all ? 'all' : 'me'
    // Periods: "este mês", "this week", "próximas semanas"…
    if (word('pr[óo]ximas semanas|next weeks|coming weeks|pr[óo]ximas dos semanas|las pr[óo]ximas semanas').test(lower))
      return { intent: 'agenda', scope, person: '', date: today, end: addDays(today, 21), label: '' }
    if (word('m[êe]s|month|mes').test(lower)) return { intent: 'agenda', scope, person: '', date: today, end: monthEnd(today), label: '' }
    if (word('semana|week').test(lower)) return { intent: 'agenda', scope, person: '', date: today, end: weekEnd(today), label: '' }
    const day = tomorrow ? addDay(today) : today
    return { intent: 'agenda', scope, person: '', date: day, end: day, label: '' }
  }
  return null
}

/** "o leite, os ovos e o pão" → ["leite", "ovos", "pão"] (articles dropped). */
function splitItems(raw: string): string[] {
  return raw
    .split(/\s*,\s*|\s+(?:e|and|y)\s+/i)
    .map((x) => x.replace(/^(?:o|a|os|as|um|uma|the|some|el|la|los|las)\s+/i, '').trim())
    .filter(Boolean)
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const dt = new Date(y, m, 0)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
/** The coming Sunday (today when it is Sunday). */
function weekEnd(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return addDays(iso, (7 - new Date(y, m - 1, d).getDay()) % 7)
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

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export async function fetchStores(): Promise<ShoppingStore[]> {
  const { data } = await supabase.from('shopping_stores').select('*').order('created_at')
  return (data ?? []) as ShoppingStore[]
}

/** The household's store for a spoken name (or the catalog's spelling of it);
 *  null when there's no such store — the sheet then ASKS rather than guessing. */
export function matchStore(name: string, stores: ShoppingStore[]): ShoppingStore | null {
  const wanted = norm(name)
  if (!wanted) return null
  const catalog = STORE_CATALOG.find((e) => norm(e.name) === wanted || e.slug === wanted.replace(/[^a-z0-9]/g, ''))
  return stores.find((s) => norm(s.name) === wanted || (catalog && s.slug === catalog.slug)) ?? null
}

/** Make a new store (a "new list"), using the catalog's name/logo when known. */
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

/** Add to one list (`store` null = "anywhere"), skipping what's already open there. */
export async function addItems(
  items: string[],
  store: ShoppingStore | null,
  addedBy: string,
  createdStore = false,
): Promise<AddResult> {
  const { data: openRows } = await supabase.from('shopping_items').select('*').eq('checked', false).order('created_at')
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
  return { store, added, existing, others: open, createdStore }
}

/** Take back what one request added — and the store, if the request made it. */
export async function undoAdd(ids: string[], createdStoreId?: string): Promise<void> {
  if (ids.length) {
    const { error } = await supabase.from('shopping_items').delete().in('id', ids)
    if (error) throw error
  }
  if (createdStoreId) await supabase.from('shopping_stores').delete().eq('id', createdStoreId)
}

export interface ListGroup {
  store: ShoppingStore | null
  items: ShoppingItem[]
}

/** What's still to buy, grouped by store ("anywhere" last); one store if named. */
export async function listItems(storeName: string): Promise<{ groups: ListGroup[]; store: ShoppingStore | null }> {
  const [stores, { data }] = await Promise.all([
    fetchStores(),
    supabase.from('shopping_items').select('*').eq('checked', false).order('label'),
  ])
  const open = (data ?? []) as ShoppingItem[]
  const store = storeName ? matchStore(storeName, stores) : null
  const valid = new Set(stores.map((s) => s.id))
  const groups: ListGroup[] = []
  for (const s of stores) {
    if (store && s.id !== store.id) continue
    const items = open.filter((i) => i.store_id === s.id)
    if (items.length) groups.push({ store: s, items })
  }
  // A named store means just that store's list, like the filter on screen.
  const anywhere = store ? [] : open.filter((i) => !i.store_id || !valid.has(i.store_id))
  if (anywhere.length) groups.push({ store: null, items: anywhere })
  return { groups, store }
}

/** Open items matching what was said: same name, or one contains the other. */
function matchOpen(said: string[], open: ShoppingItem[]): { hits: ShoppingItem[]; missing: string[] } {
  const hits: ShoppingItem[] = []
  const missing: string[] = []
  for (const w of said) {
    const k = norm(w)
    const hit =
      open.find((i) => norm(i.label) === k && !hits.includes(i)) ??
      open.find((i) => (norm(i.label).includes(k) || k.includes(norm(i.label))) && !hits.includes(i))
    if (hit) hits.push(hit)
    else missing.push(w)
  }
  return { hits, missing }
}

export interface Found {
  label: string
  store: ShoppingStore | null
}

/** Which of these are still to buy, and on which list. */
export async function findItems(said: string[]): Promise<Found[]> {
  const [stores, { data }] = await Promise.all([fetchStores(), supabase.from('shopping_items').select('*').eq('checked', false)])
  const { hits } = matchOpen(said, (data ?? []) as ShoppingItem[])
  return hits.map((i) => ({ label: i.label, store: stores.find((st) => st.id === i.store_id) ?? null }))
}

/** "label @ store" lines for the server (what's still to buy). */
export async function openItemsContext(stores: ShoppingStore[]): Promise<{ lines: string[]; labels: string[] }> {
  const { data } = await supabase.from('shopping_items').select('label, store_id').eq('checked', false)
  const rows = (data ?? []) as { label: string; store_id: string | null }[]
  return {
    lines: rows.map((r) => `${r.label} @ ${stores.find((st) => st.id === r.store_id)?.name ?? 'anywhere'}`),
    labels: rows.map((r) => r.label),
  }
}

export async function checkItems(said: string[]): Promise<{ hits: ShoppingItem[]; missing: string[] }> {
  const { data } = await supabase.from('shopping_items').select('*').eq('checked', false)
  const r = matchOpen(said, (data ?? []) as ShoppingItem[])
  if (r.hits.length) {
    const { error } = await supabase
      .from('shopping_items')
      .update({ checked: true, checked_at: new Date().toISOString() })
      .in('id', r.hits.map((i) => i.id))
    if (error) throw error
  }
  return r
}

export async function uncheckItems(ids: string[]): Promise<void> {
  if (ids.length) await supabase.from('shopping_items').update({ checked: false, checked_at: null }).in('id', ids)
}

export async function removeItems(said: string[]): Promise<{ hits: ShoppingItem[]; missing: string[] }> {
  // Open items first, then ones already in the cart — "delete the bananas"
  // means the bananas wherever they are.
  const { data } = await supabase.from('shopping_items').select('*')
  const all = (data ?? []) as ShoppingItem[]
  const r = matchOpen(said, [...all.filter((i) => !i.checked), ...all.filter((i) => i.checked)])
  if (r.hits.length) {
    const { error } = await supabase.from('shopping_items').delete().in('id', r.hits.map((i) => i.id))
    if (error) throw error
  }
  return r
}

/** Undo a removal: put the same items back on the same lists. */
export async function restoreItems(items: ShoppingItem[]): Promise<void> {
  if (!items.length) return
  await supabase
    .from('shopping_items')
    .insert(items.map((i) => ({ label: i.label, added_by: i.added_by, store_id: i.store_id, checked: i.checked })))
}

// ── doing: calendar ──────────────────────────────────────────────────────────

export async function addEvent(
  title: string,
  date: string,
  time: string,
  owner: Profile | null,
): Promise<CalendarEvent> {
  const timed = /^\d{2}:\d{2}$/.test(time)
  const [h, m] = timed ? time.split(':').map(Number) : [0, 0]
  const endH = Math.min(23, h + 1)
  const { data, error } = await supabase
    .from('calendar_events')
    .insert({
      title: title.trim(),
      start_date: date,
      end_date: date,
      all_day: !timed,
      start_time: timed ? `${time}:00` : null,
      end_time: timed ? `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00` : null,
      owner_email: owner?.email ?? null,
      kind: 'event',
      recurrence: 'none',
      reminder_minutes: null,
      location: null,
      notes: null,
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

// ── doing: money ─────────────────────────────────────────────────────────────

async function budgetsWithMonths(): Promise<{ budgets: Budget[]; months: Month[] }> {
  const [b, m] = await Promise.all([
    supabase.from('budgets').select('*').order('created_at'),
    supabase.from('months').select('*').order('start_date', { ascending: false }),
  ])
  return { budgets: (b.data ?? []) as Budget[], months: (m.data ?? []) as Month[] }
}

/** The period of `budget` that holds `date`; failing that, its LATEST period
 *  (owner, 2026-11: "add it to the last month/week/day") so a request on a day
 *  whose period hasn't been opened yet still lands somewhere sensible. */
export function periodForBudget(budget: Budget, months: Month[], date: string): Month | null {
  const mine = months.filter((m) => m.budget_id === budget.id)
  return (
    mine.find((m) => m.start_date <= date && date <= periodEndISO(budget.period, m.start_date)) ??
    [...mine].sort((x, y) => y.start_date.localeCompare(x.start_date))[0] ??
    null
  )
}

/** Which budget a request means: the one NAMED (matched loosely), the only
 *  one, or — with several and none named — none: the caller asks. */
export function pickBudget(budgets: Budget[], name: string): Budget | null {
  const n = norm(name)
  if (n) {
    const hit =
      budgets.find((b) => norm(b.name) === n) ??
      budgets.find((b) => norm(b.name).includes(n) || n.includes(norm(b.name)))
    if (hit) return hit
  }
  return budgets.length === 1 ? budgets[0] : null
}

export type MoneyResult =
  | { ok: true; entryId: string; budget: Budget; month: Month; category: string }
  | { ok: false; reason: 'no_budget' | 'no_period'; budget: Budget | null }
  | { ok: false; reason: 'choose_budget'; budgets: Budget[] }

/** Record an expense/income. `budgetId` (from a "which budget?" answer) wins
 *  over the name said; with several budgets and no clear one, nothing is
 *  written and the caller is told to ask. */
export async function addMoney(
  title: string,
  amount: number,
  type: 'expense' | 'income',
  date: string,
  budgetName: string,
  me: string,
  budgetId?: string,
): Promise<MoneyResult> {
  const { budgets, months } = await budgetsWithMonths()
  if (!budgets.length) return { ok: false, reason: 'no_budget', budget: null }
  const budget = budgetId ? (budgets.find((b) => b.id === budgetId) ?? null) : pickBudget(budgets, budgetName)
  if (!budget) return { ok: false, reason: 'choose_budget', budgets }
  const month = periodForBudget(budget, months, date)
  if (!month) return { ok: false, reason: 'no_period', budget }
  const { data: rules } = await supabase.from('category_rules').select('*')
  const label = title.trim() || (type === 'income' ? 'Income' : 'Expense')
  const category = type === 'income' ? 'salary' : suggestCategory(label, (rules ?? []) as CategoryRule[])
  // A date outside the chosen (latest) period would hide the entry from it —
  // keep it inside: today if it fits, else the period's last day.
  const end = periodEndISO(budget.period, month.start_date)
  const entryDate = date < month.start_date ? month.start_date : date > end ? end : date
  const { data, error } = await supabase
    .from('entries')
    .insert({
      month_id: month.id,
      type,
      label,
      amount,
      category,
      subcategory: null,
      entry_date: entryDate,
      person_email: me,
      recurring: false,
    })
    .select('id')
    .single()
  if (error) throw error
  return { ok: true, entryId: (data as { id: string }).id, budget, month, category }
}

export async function deleteEntry(id: string): Promise<void> {
  await supabase.from('entries').delete().eq('id', id)
}

export interface MoneyLine {
  budget: Budget
  month: Month | null
  income: number
  spent: number
}

/** This period's received / spent per budget (or the one named). */
export async function moneySummary(budgetName: string, today: string): Promise<MoneyLine[]> {
  const { budgets, months } = await budgetsWithMonths()
  const pick = budgetName ? budgets.filter((b) => norm(b.name) === norm(budgetName)) : budgets
  const lines: MoneyLine[] = []
  for (const b of pick.length ? pick : budgets) {
    const month = periodForBudget(b, months, today)
    let income = 0
    let spent = 0
    if (month) {
      const { data } = await supabase.from('entries').select('type, amount, entry_date').eq('month_id', month.id)
      for (const e of (data ?? []) as { type: string; amount: number; entry_date: string }[]) {
        if (e.entry_date > today) continue
        if (e.type === 'income') income += Number(e.amount)
        else spent += Number(e.amount)
      }
    }
    lines.push({ budget: b, month, income, spent })
  }
  return lines
}

// ── doing: pets, family ──────────────────────────────────────────────────────

export interface PetDue {
  id: string
  title: string
  pet: string
  /** overdue = past its date; today = due today; routine = on today's daily
   *  checklist and not ticked yet. */
  status: 'overdue' | 'today' | 'routine'
  /** For overdue: how many days late. */
  late: number
}

/** What the pets still need: overdue / due-today care (events with a next
 *  due, interval routines) plus today's daily checklist items not ticked yet —
 *  for one pet when `petName` matches, else every pet. Overdue first, then the
 *  daily checklist in its own order ("what's next for Lola?" = the first
 *  routine row), then what's due today. */
export interface PetsAnswer {
  rows: PetDue[]
  /** The pet asked about ("" = all of them). */
  pet: string
  /** That pet's daily checklist today (0/0 when no pet was named). */
  routineDone: number
  routineTotal: number
}

export async function petsDue(today: string, petName = ''): Promise<PetsAnswer> {
  const [pe, petRows, taskRows, doneRows] = await Promise.all([
    supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    supabase.from('pets').select('id, name'),
    supabase.from('pet_care_tasks').select('*'),
    supabase.from('pet_task_done').select('*').gte('done_on', addDaysISO(today, -370)),
  ])
  const pets = (petRows.data ?? []) as { id: string; name: string }[]
  const names = Object.fromEntries(pets.map((p) => [p.id, p.name]))
  const want = petName ? pets.find((p) => norm(p.name) === norm(petName)) ?? pets.find((p) => norm(p.name).startsWith(norm(petName))) : undefined
  const ids = want ? [want.id] : pets.map((p) => p.id)
  const tasks = (taskRows.data ?? []) as PetCareTask[]
  const done = (doneRows.data ?? []) as PetTaskDone[]
  const due = overdueCare(ids, tasks, done, (pe.data ?? []) as PetEvent[], today)
  const late: PetDue[] = due
    .filter((d) => d.dueIn < 0)
    .map((d) => ({ id: d.key, title: d.title, pet: names[d.petId] ?? '', status: 'overdue', late: -d.dueIn }))
  const checklist = want ? dailyChecklist(tasks, done, want.id, today) : []
  const routine: PetDue[] = ids.flatMap((id) =>
    dailyChecklist(tasks, done, id, today)
      .filter((r) => !r.done)
      .map((r) => ({ id: `daily:${r.task.id}`, title: r.task.title, pet: names[id] ?? '', status: 'routine' as const, late: 0 })),
  )
  const todayRows: PetDue[] = due
    .filter((d) => d.dueIn === 0)
    .map((d) => ({ id: d.key, title: d.title, pet: names[d.petId] ?? '', status: 'today', late: 0 }))
  return {
    rows: [...late, ...routine, ...todayRows],
    pet: want?.name ?? '',
    routineDone: checklist.filter((r) => r.done).length,
    routineTotal: checklist.length,
  }
}

/** Tick (or untick) a pet's daily task for `day`, from the assistant's
 *  answer. Same rows the Pet Care screen writes; 23505 = someone else just
 *  ticked it, which is fine. */
export async function setDailyDone(taskId: string, day: string, done: boolean): Promise<boolean> {
  if (done) {
    const { error } = await supabase.from('pet_task_done').insert({ task_id: taskId, done_on: day })
    if (error && error.code !== '23505') return false
  } else {
    const { error } = await supabase.from('pet_task_done').delete().eq('task_id', taskId).eq('done_on', day)
    if (error) return false
  }
  notifyPetCareChange()
  return true
}

export async function familyInfo(
  personName: string,
  me: Profile | null,
  profiles: Profile[],
): Promise<{ person: Profile | null; row: MemberProfile | null }> {
  const person = (personName && findMember(personName, profiles)) || me
  if (!person) return { person: null, row: null }
  const { data } = await supabase.from('member_profiles').select('*').eq('email', person.email).maybeSingle()
  return { person, row: (data as MemberProfile | null) ?? null }
}

// ── doing: agenda ────────────────────────────────────────────────────────────

export interface AgendaRow {
  key: string
  /** The day this row falls on (ranges list several days). */
  day: string
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
  /** Last day asked about; === date for a single day. */
  end: string
  /** The period in the user's words ("este mês"), from the server; "" for a day. */
  label: string
  scope: Scope
  person: Profile | null
  rows: AgendaRow[]
  /** When the asked-about list is empty: what the rest of the house has. */
  others: AgendaRow[]
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

function eventRow(o: Occurrence, day: string): AgendaRow {
  const ev = o.event
  return {
    key: `${ev.id}:${o.start}:${day}`,
    day,
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
  end: string,
  label: string,
  scope: Scope,
  personName: string,
  me: Profile | null,
  profiles: Profile[],
  today: string,
): Promise<AgendaAnswer> {
  const [{ data: ev }, petRes] = await Promise.all([
    supabase.from('calendar_events').select('*'),
    date <= today && today <= end
      ? Promise.all([
          supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
          supabase.from('pets').select('id, name'),
        ])
      : Promise.resolve(null),
  ])
  // Every day of the range, in order; within a day, by time.
  const byDay = occurrencesByDay((ev ?? []) as CalendarEvent[], date, end)
  let all: AgendaRow[] = [...byDay.keys()]
    .sort()
    .flatMap((day) => [...(byDay.get(day) ?? [])].sort(compareOccurrences).map((o) => eventRow(o, day)))
  // Pet care is the household's, so it shows for "me" and "all" alike.
  if (petRes) {
    const [pe, pets] = petRes
    const names = Object.fromEntries(((pets.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
    const due = overdueEvents((pe.data ?? []) as PetEvent[], today)
    all = all.concat(
      due.map((e) => ({
        key: `pet:${e.id}`,
        day: today,
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
  return { date, end, label, scope: effective, person: effective === 'all' ? null : person, rows, others }
}
