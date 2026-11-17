// The Home's "ask anything" bar. Two halves, deliberately split:
//  - UNDERSTANDING: `/api/suggest-ping?action=assistant` turns free text into an
//    intent (Claude Haiku, structured output). When that's unreachable (offline,
//    not deployed, AI paused) `localParse` covers the everyday phrasings.
//  - DOING: everything below runs with the user's OWN Supabase session, so RLS
//    stays the boundary — the server never writes household data for this.
// Anything that reaches OTHER people (a nudge) is never done straight away: the
// sheet shows it and waits for a tap. Writes come back with what Undo needs.
import { isUndoAsk } from './assistantTalk'
import { supabase } from './supabase'
import { STORE_CATALOG } from './stores'
import { compareOccurrences, occurrencesByDay, occurrencesInRange, upcomingOccurrences, type Occurrence } from './calendar'
import { dailyChecklist, overdueCare, overdueEvents } from './petCare'
import { suggestCategory } from './categories'
import { addDaysISO, periodEndISO } from './format'
import { notifyPetCareChange } from './petCareNotify'
import { cutWrite } from './assistantGuard'
import type {
  Budget,
  CalendarEvent,
  CategoryRule,
  Entry,
  EventKind,
  EventRecurrence,
  MemberProfile,
  Month,
  PetCareTask,
  PetEvent,
  PetEventType,
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
  | { intent: 'add_event'; title: string; date: string; time: string; person: string; opts?: EventOpts }
  /** `person` (move / remove / edit / find): whose event was named ("o dentista
   *  do Pedro") — narrows locateEvent; absent = anyone's. */
  | { intent: 'edit_event'; title: string; date: string; newTitle: string; location: string; notes: string; reminder: number; ref?: string; person?: string }
  | { intent: 'find_event'; title: string; date: string; ref?: string; person?: string }
  /** `date` / `newDate` are "" when not said: the coming occurrence / its own day. */
  | { intent: 'move_event'; title: string; date: string; newDate: string; time: string; ref?: string; person?: string }
  /** `date` is "" when no day was said: the coming weeks are searched. */
  | { intent: 'remove_event'; title: string; date: string; ref?: string; person?: string }
  | { intent: 'add_money'; title: string; amount: number; type: 'expense' | 'income'; date: string; budget: string }
  /** `at`: a day inside an EARLIER period asked about ("last month"); absent = the current one. */
  /** `kind`: only expenses or only income ("meus gastos"); absent = both. */
  /** `range`: an explicit day / week / month asked about ("hoje"), inclusive ISO days. */
  | { intent: 'money_summary'; budget: string; category?: string; title?: string; at?: string; person?: string; kind?: 'expense' | 'income'; range?: MoneyRange }
  | { intent: 'list_money'; budget: string; category: string; title: string; at?: string; person?: string; kind?: 'expense' | 'income'; range?: MoneyRange }
  | { intent: 'fix_money'; title: string; amount: number; newTitle: string; delta: number; tipPct: number; ref?: string }
  | { intent: 'remove_money'; title: string; ref?: string }
  /** The server knew what was meant but a detail was missing: ask, never guess. */
  | { intent: 'need_detail'; about: string }
  /** The server answered with something this app version can't do yet. */
  | { intent: 'needs_update'; about: string }
  /** Free plan: this member's monthly assistant allowance is used up. */
  | { intent: 'limit_reached'; cap: number }
  | { intent: 'send_nudge'; message: string; person: string; urgent?: boolean }
  | { intent: 'nudge_seen' }
  | { intent: 'pet_done'; pet: string; tasks: string[] }
  | { intent: 'pet_log'; pet: string; type: PetEventType; title: string; date: string; next: string }
  | { intent: 'pet_next'; pet: string; type: PetEventType | '' }
  | { intent: 'pet_weight'; pet: string; weight: number }
  | { intent: 'family_update'; person: string; field: FamilyField | ''; value: string }
  | { intent: 'birthdays' }
  | { intent: 'where_is'; person: string; place: string }
  | { intent: 'move_items'; items: string[]; store: string }
  | { intent: 'clear_checked'; store: string }
  | { intent: 'uncheck_items'; items: string[] }
  | { intent: 'weather'; date: string }
  | { intent: 'better_deal'; deals: Deal[] }
  | { intent: 'open_document'; title: string; person: string }
  | { intent: 'day_summary'; date: string }
  /** `view`: the whole routine, or only what's late; absent = what's left today. */
  | { intent: 'pets_due'; pet: string; view?: 'routine' | 'overdue' }
  | { intent: 'family_info'; person: string; field: FamilyField | '' }
  | { intent: 'open_app'; app: string }
  | { intent: 'start_game'; game: string }
  | { intent: 'split_bill'; amount: number; people: number; mode: 'even' | 'items' | ''; tip: number }
  | { intent: 'discount'; amount: number; percent: number }
  /** About One Roof itself (what it does, the games and their rules). */
  | { intent: 'app_help'; topic: string; reply: string }
  /** "desfaz isso" / "undo that": undo the previous answer's change (its
   *  Undo button, by voice). Recognised on the phone (localParse) and from a
   *  server that knows it; an older server never sends it. */
  | { intent: 'undo_last' }
  /** A new, empty list. */
  | { intent: 'create_list'; name: string }
  /** Relabel an item already on a list ("muda o leite para 2 leites"). */
  | { intent: 'edit_item'; item: string; label: string }
  /** Nudges sent TO the asker that they haven't seen. */
  | { intent: 'my_nudges' }
  /** Ask a member to share / refresh where they are (a location-request nudge). */
  | { intent: 'ask_location'; person: string }
  /** Free or busy on `date`, in the window `from`–`to` (HH:MM, "" = the whole day). */
  | { intent: 'free_check'; scope: Scope; person: string; date: string; from: string; to: string }
  /** Who ticked a pet's routine task today. */
  | { intent: 'pet_who'; pet: string; tasks: string[] }
  | { intent: 'call_member'; person: string }
  /** Days until a date that isn't a calendar event ("Natal"). */
  | { intent: 'days_until'; date: string; title: string }
  | { intent: 'unknown'; reply: string }

/** add_event's extras beyond title/day/time (all optional). */
export interface EventOpts {
  /** Last day of a multi-day event (> date). */
  end?: string
  endTime?: string
  recurrence?: EventRecurrence
  kind?: EventKind
  location?: string
  notes?: string
  /** Minutes before; null/undefined = none. */
  reminder?: number | null
}

/** One option of a "which is cheaper?" comparison. */
export interface Deal {
  price: number
  size: number
  label: string
}

export interface MoneyRange {
  span: 'day' | 'week' | 'month'
  from: string
  to: string
}

/** The inclusive days of the day / week (Mon–Sun) / calendar month around `date`. */
export function moneyRange(span: MoneyRange['span'], date: string): MoneyRange {
  if (span === 'day') return { span, from: date, to: date }
  if (span === 'week') {
    const dow = (new Date(date + 'T12:00:00').getDay() + 6) % 7 // Monday = 0
    const from = addDays(date, -dow)
    return { span, from, to: addDays(from, 6) }
  }
  const [y, m] = date.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  return { span, from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

export interface AskContext {
  today: string
  weekday: string
  lang: string
  stores: string[]
  members: string[]
  budgets: string[]
  pets: string[]
  /** Each pet's species, "Lola = dog" — "as cachorras" = every dog. */
  petKinds?: string[]
  /** Each pet's routine, "Lola: Comida, Passeio". */
  petTasks?: string[]
  /** Spending categories, "groceries = Groceries". */
  categories?: string[]
  /** The family's document titles — open_document returns one of them. */
  documents?: string[]
  /** What's still to buy, "label @ store" — Claude matches questions to it. */
  openItems: string[]
  /** Latest money entries, "e1 = Ford's Garage · 54.20 · expense · 2026-11-08 · Arthur". */
  recentEntries?: string[]
  /** Coming events, "v1 = Unha · 2026-11-10 14:00 · Ana". */
  events?: string[]
  me: string
  /** This conversation so far, oldest first: what was asked and a one-line
   *  account of what the app answered — so "remove the milk" / "and for
   *  Lola?" resolve against the previous turn. */
  history?: { q: string; a: string }[]
}

// ── understanding ────────────────────────────────────────────────────────────

/** Ask the server; fall back to the local parser when it can't answer. Returns
 *  null only when neither understood the request. */
/** Every intent this app version can carry out (what fromServer handles). */
const KNOWN_INTENTS = new Set([
  'add_items', 'list_items', 'find_items', 'check_items', 'remove_items', 'move_items', 'clear_checked', 'uncheck_items',
  'agenda', 'add_event', 'edit_event', 'find_event', 'move_event', 'remove_event', 'birthdays', 'day_summary',
  'add_money', 'money_summary', 'list_money', 'fix_money', 'remove_money', 'split_bill', 'discount', 'better_deal',
  'send_nudge', 'nudge_seen', 'pets_due', 'pet_done', 'pet_log', 'pet_next', 'pet_weight',
  'family_info', 'family_update', 'where_is', 'weather', 'open_document', 'open_app', 'start_game', 'app_help', 'undo_last',
  'create_list', 'edit_item', 'my_nudges', 'ask_location', 'free_check', 'pet_who', 'call_member', 'days_until',
  'unknown',
])

/** What the server said: an intent, an intent with a detail missing, an
 *  intent newer than this app, or nothing (offline / old deploy / error). */
/** Where the member stands on the free plan's monthly allowance. */
export type Quota = { plus: true } | { used: number; cap: number }

type ServerReply =
  | { kind: 'ok'; intent: Intent; quota?: Quota; then?: string }
  | { kind: 'limit'; used: number; cap: number }
  | { kind: 'incomplete'; name: string }
  | { kind: 'unsupported'; name: string }
  | { kind: 'offline' }

export type Source = 'server' | 'local' | 'asked' | 'none'

/** understand() plus where the answer came from (for gap logging). */
export async function understandWithSource(
  text: string,
  ctx: AskContext,
): Promise<{ intent: Intent | null; source: Source; quota?: Quota; then?: string }> {
  // "Desfaz isso" is answered here, before the server: an older server filed
  // it as remove_items — a WRITE (review M9). Instant and nothing spent.
  if (isUndoAsk(text)) return { intent: { intent: 'undo_last' }, source: 'local' }
  const r = await askServer(text, ctx)
  // Out of free requests this month: say so (with the way to Plus) — the
  // local regexes don't stand in for the assistant.
  if (r.kind === 'limit') return { intent: { intent: 'limit_reached', cap: r.cap }, source: 'asked', quota: { used: r.used, cap: r.cap } }
  const quota = r.kind === 'ok' ? r.quota : undefined
  const res = await pick()
  const then = r.kind === 'ok' && r.then && res.source === 'server' && res.intent?.intent === r.intent.intent ? { then: r.then } : {}
  return { ...res, ...(quota ? { quota } : {}), ...then }
  async function pick(): Promise<{ intent: Intent | null; source: Source }> {
    const remote = r.kind === 'ok' ? r.intent : null
    const local = localParse(text, ctx.today)
    // A server that answered a single day to "this month" (an older deploy, or a
    // miss) loses to a period the local parser can see in the words.
    if (remote?.intent === 'agenda' && remote.end === remote.date && local?.intent === 'agenda' && local.end > local.date) {
      return { intent: { ...remote, date: local.date, end: local.end }, source: 'server' }
    }
    // The utilities are clear-cut phrasings; an older server that doesn't know
    // them yet would file "divide 58,71 em 3" as an expense.
    if ((local?.intent === 'split_bill' || local?.intent === 'discount') && remote?.intent !== local.intent) return { intent: local, source: 'local' }
    // A pet of THIS household named next to "need / next / routine…" is a
    // routine question, whatever an older server made of it ("what does Lola
    // need next today?" came back as family_info / unknown — owner, 2026-11).
    // A request cut off mid-phrase ("marca uma consulta da") never writes:
    // the recogniser stopped early and the guess filled the gap (owner, 2026-11).
    if (remote && cutWrite(remote.intent, text)) return { intent: { intent: 'need_detail', about: remote.intent }, source: 'asked' }
    // Only a READ answer may be swapped for the routine question — never a
    // pet write ("a Chloe tomou a vacina hoje, próxima em 1 ano" says "próxima",
    // and became a "what does Chloe need?" — owner, 2026-11).
    const swappable = !remote || PET_SWAPPABLE.has(remote.intent)
    const asked = swappable ? petsAsked(text, ctx.pets, ctx.members) : []
    // Several pets named: all of them, whatever single one the server kept.
    if (asked.length > 1) {
      const view = remote?.intent === 'pets_due' && remote.view ? { view: remote.view } : {}
      return { intent: { intent: 'pets_due', pet: asked.join(', '), ...view }, source: remote ? 'server' : 'local' }
    }
    const pet = asked[0] ?? ''
    if (pet && (remote?.intent !== 'pets_due' || !remote.pet)) return { intent: { intent: 'pets_due', pet, ...(remote?.intent === 'pets_due' && remote.view ? { view: remote.view } : {}) }, source: 'local' }
    if (remote && remote.intent !== 'unknown') return { intent: remote, source: 'server' }
    // The server UNDERSTOOD the request but a detail was missing. The local
    // regexes are far dumber ("apaga o gasto do X" reads as a list item), so
    // never let them guess here: ask for what's missing (owner, 2026-11).
    if (r.kind === 'incomplete') return { intent: { intent: 'need_detail', about: r.name }, source: 'asked' }
    if (r.kind === 'unsupported') return { intent: { intent: 'needs_update', about: r.name }, source: 'asked' }
    // Offline, or the server said "unknown": the local parser is the fallback
    // — with the same cut-off guard (it would write "marca o dentista amanhã
    // às" just as readily).
    if (local && cutWrite(local.intent, text)) return { intent: { intent: 'need_detail', about: local.intent }, source: 'asked' }
    if (local) return { intent: local, source: 'local' }
    return { intent: remote, source: remote ? 'server' : 'none' }
  }
}

/** Server answers the pet-routine override may replace: reads that an older
 *  server filed a routine question under. Writes and the other pet intents
 *  are never replaced. */
const PET_SWAPPABLE = new Set(['pets_due', 'unknown', 'family_info', 'agenda', 'day_summary', 'find_items', 'list_items', 'app_help', 'where_is'])

export async function understand(text: string, ctx: AskContext): Promise<Intent | null> {
  return (await understandWithSource(text, ctx)).intent
}

/** The server's JSON → a typed intent (null when it isn't usable). */
export function fromServer(j: Record<string, unknown> | null, today: string): Intent | null {
  if (!j || typeof j.intent !== 'string') return null
  const str = (k: string) => (typeof j[k] === 'string' ? (j[k] as string) : '')
  const items = Array.isArray(j.items) ? (j.items as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str('date')) ? str('date') : today
  /** A YYYY-MM-DD field, or "" when not given. */
  const isoOr = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(str(k)) ? str(k) : '')
  const num = (k: string) => (typeof j[k] === 'number' && isFinite(j[k] as number) ? (j[k] as number) : 0)
  /** The row the model pointed at ("e1", "v3") — only when given. */
  const ref = /^[ev]\d{1,2}$/.test(str('ref')) ? { ref: str('ref') } : {}
  /** Whose event (move / remove / edit / find) — only when named. */
  const whose = str('person').trim() ? { person: str('person').trim() } : {}
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
    case 'add_event': {
      if (!str('title')) return null
      const end = isoOr('date_end')
      const rec = str('recurrence') as EventRecurrence
      const kind = str('event_kind') as EventKind
      const opts: EventOpts = {
        end: end && end > date ? end : undefined,
        endTime: str('end_time'),
        recurrence: ['daily', 'weekly', 'monthly', 'yearly'].includes(rec) ? rec : kind === 'birthday' || kind === 'anniversary' ? 'yearly' : 'none',
        kind: ['birthday', 'anniversary', 'renewal', 'other'].includes(kind) ? kind : 'event',
        location: str('location'),
        notes: str('notes'),
        // Absent or -1 = no reminder (0 is a real "at the time").
        reminder: typeof j.reminder === 'number' && (j.reminder as number) >= 0 ? (j.reminder as number) : null,
      }
      const plain =
        !opts.end && !opts.endTime && opts.recurrence === 'none' && opts.kind === 'event' && !opts.location && !opts.notes && opts.reminder == null
      return { intent: 'add_event', title: str('title'), date, time: str('time'), person: str('person'), ...(plain ? {} : { opts }) }
    }
    case 'edit_event': {
      const reminder = typeof j.reminder === 'number' ? (j.reminder as number) : -1
      if (!str('new_title') && !str('location') && !str('notes') && reminder === -1) return null
      return {
        intent: 'edit_event',
        title: str('title'),
        date: isoOr('date'),
        newTitle: str('new_title'),
        location: str('location'),
        notes: str('notes'),
        reminder,
        ...ref,
        ...whose,
      }
    }
    case 'find_event':
      return str('title') || ref.ref ? { intent: 'find_event', title: str('title'), date: isoOr('date'), ...ref, ...whose } : null
    case 'move_event': {
      const newDate = isoOr('new_date')
      // Nowhere to go and no new time: not a usable move.
      if (!newDate && !str('time')) return null
      // No day said = NOT today: locateEvent finds the coming one (or the
      // ref'd row, or asks which). No new day = only the time changes, on the
      // occurrence's own day (moveOccurrence fills it in). Review H3.
      return { intent: 'move_event', title: str('title'), date: isoOr('date'), newDate, time: str('time'), ...ref, ...whose }
    }
    case 'undo_last':
      return { intent: 'undo_last' }
    case 'remove_event': {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(str('date')) ? str('date') : ''
      // Neither a name nor a day: nothing to go on.
      if (!str('title') && !day && !ref.ref) return null
      return { intent: 'remove_event', title: str('title'), date: day, ...ref, ...whose }
    }
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
    case 'list_money': {
      // A past day = an earlier period ("mês passado"); today / future = the current one.
      const at = date < today ? { at: date } : {}
      // `person`: whose money ("meus gastos" = the asker); absent = the household.
      const who = str('person') ? { person: str('person') } : {}
      const mt = str('money_type')
      // A plain summary (no filter) stays the income/spent overview; a list
      // or a narrowed summary takes the kind the words said.
      const kind = mt === 'income' || mt === 'expense' ? { kind: mt as 'income' | 'expense' } : {}
      // An explicit span ("gastos de hoje", "essa semana") filters by date
      // instead of the budget's whole period (owner report 2026-11).
      const span = str('money_range')
      const range = span === 'day' || span === 'week' || span === 'month' ? { range: moneyRange(span, date) } : {}
      const base = { budget: str('budget'), category: str('category'), title: str('title'), ...(range.range ? {} : at), ...who, ...kind, ...range }
      return j.intent === 'money_summary' ? { intent: 'money_summary', ...base } : { intent: 'list_money', ...base }
    }
    case 'fix_money':
    {
      // A new total, a new description, or something to add / take off
      // ("forgot the tip": a delta or a tip percent on top of what was logged).
      const delta = num('delta')
      const tipPct = num('tip_pct') > 0 ? num('tip_pct') : 0
      return num('amount') > 0 || str('new_title') || delta !== 0 || tipPct > 0
        ? { intent: 'fix_money', title: str('title'), amount: num('amount'), newTitle: str('new_title'), delta, tipPct, ...ref }
        : null
    }
    case 'remove_money':
      return { intent: 'remove_money', title: str('title'), ...ref }
    case 'send_nudge':
      return str('title') ? { intent: 'send_nudge', message: str('title'), person: str('person'), ...(j.urgent === true ? { urgent: true } : {}) } : null
    case 'nudge_seen':
      return { intent: 'nudge_seen' }
    case 'pet_done':
      return items.length ? { intent: 'pet_done', pet: str('pet'), tasks: items } : null
    case 'pet_log': {
      const type = str('pet_event_type') as PetEventType
      if (!str('title') && !type) return null
      return {
        intent: 'pet_log',
        pet: str('pet'),
        type: ['vet', 'vaccine', 'medication', 'grooming'].includes(type) ? type : 'other',
        title: str('title'),
        date,
        next: isoOr('new_date'),
      }
    }
    case 'pet_next': {
      const type = str('pet_event_type') as PetEventType | ''
      return { intent: 'pet_next', pet: str('pet'), type: ['vet', 'vaccine', 'medication', 'grooming', 'other'].includes(type) ? type : '' }
    }
    case 'pet_weight':
      return num('amount') > 0 ? { intent: 'pet_weight', pet: str('pet'), weight: num('amount') } : null
    case 'family_update':
      return str('field') && str('value')
        ? { intent: 'family_update', person: str('person'), field: str('field') as FamilyField, value: str('value') }
        : null
    case 'birthdays':
      return { intent: 'birthdays' }
    case 'where_is':
      return { intent: 'where_is', person: str('person'), place: str('title') }
    case 'move_items':
      return items.length && str('store') ? { intent: 'move_items', items, store: str('store') } : null
    case 'clear_checked':
      return { intent: 'clear_checked', store: str('store') }
    case 'uncheck_items':
      return items.length ? { intent: 'uncheck_items', items } : null
    case 'weather':
      return { intent: 'weather', date }
    case 'better_deal': {
      const deals = (Array.isArray(j.deals) ? (j.deals as Record<string, unknown>[]) : [])
        .filter((d) => typeof d?.price === 'number' && typeof d?.size === 'number' && (d.price as number) > 0 && (d.size as number) > 0)
        .map((d) => ({ price: d.price as number, size: d.size as number, label: typeof d.label === 'string' ? d.label : '' }))
      return deals.length >= 2 ? { intent: 'better_deal', deals } : null
    }
    case 'open_document':
      return str('title') ? { intent: 'open_document', title: str('title'), person: str('person') } : null
    case 'day_summary':
      return { intent: 'day_summary', date }
    case 'pets_due': {
      const view = str('pet_view')
      return { intent: 'pets_due', pet: str('pet'), ...(view === 'routine' || view === 'overdue' ? { view } : {}) }
    }
    case 'family_info':
      return { intent: 'family_info', person: str('person'), field: str('field') as FamilyField | '' }
    case 'open_app':
      return str('app') ? { intent: 'open_app', app: str('app') } : null
    case 'start_game':
      return { intent: 'start_game', game: str('game') }
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
    case 'app_help':
      return { intent: 'app_help', topic: str('topic'), reply: str('reply') }
    case 'create_list':
      return str('store').trim() ? { intent: 'create_list', name: str('store').trim() } : null
    case 'edit_item':
      return items[0] && str('title').trim() ? { intent: 'edit_item', item: items[0], label: str('title').trim() } : null
    case 'my_nudges':
      return { intent: 'my_nudges' }
    case 'ask_location':
      return str('person').trim() ? { intent: 'ask_location', person: str('person').trim() } : null
    case 'free_check': {
      const hm = (k: string) => (/^\d{2}:\d{2}$/.test(str(k)) ? str(k) : '')
      return { intent: 'free_check', scope: (str('scope') as Scope) || 'me', person: str('person'), date, from: hm('time'), to: hm('end_time') }
    }
    case 'pet_who':
      return { intent: 'pet_who', pet: str('pet'), tasks: items }
    case 'call_member':
      return str('person').trim() ? { intent: 'call_member', person: str('person').trim() } : null
    case 'days_until':
      return isoOr('date') ? { intent: 'days_until', date: isoOr('date'), title: str('title') } : null
    case 'unknown':
      return { intent: 'unknown', reply: str('reply') }
    default:
      return null
  }
}

async function askServer(text: string, ctx: AskContext): Promise<ServerReply> {
  if (!API_BASE) return { kind: 'offline' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { kind: 'offline' }
    const res = await fetch(`${API_BASE}/api/suggest-ping?action=assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, ...ctx }),
    })
    if (res.status === 402) {
      const j = (await res.json().catch(() => null)) as { error?: string; used?: number; cap?: number } | null
      if (j?.error === 'assistant_limit') return { kind: 'limit', used: j.used ?? 0, cap: j.cap ?? 5 }
    }
    if (!res.ok) return { kind: 'offline' }
    // An older deploy answers this URL as a plain nudge ({kind, emoji, message}),
    // which has no `intent` — treated like no answer.
    const j = (await res.json()) as Record<string, unknown> | null
    if (!j || typeof j.intent !== 'string') return { kind: 'offline' }
    const intent = fromServer(j, ctx.today)
    const q = j.quota as Quota | undefined
    const quota = q && ('plus' in q || (typeof q.used === 'number' && typeof q.cap === 'number')) ? q : undefined
    // A second task said in the same breath: the sheet asks it next.
    const then = typeof j.then === 'string' ? j.then.trim().slice(0, 200) : ''
    if (intent) return { kind: 'ok', intent, ...(quota ? { quota } : {}), ...(then ? { then } : {}) }
    return KNOWN_INTENTS.has(j.intent) ? { kind: 'incomplete', name: j.intent } : { kind: 'unsupported', name: j.intent }
  } catch {
    return { kind: 'offline' }
  }
}

/** Tell the server the app understood a request but couldn't carry it out —
 *  the intent and a reason CODE only, never what was said (migration 088).
 *  Fire-and-forget. */
export function reportGap(intent: string, reason: string, lang: string): void {
  if (!API_BASE) return
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      await fetch(`${API_BASE}/api/suggest-ping?action=assistant-gap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ intent, reason, lang }),
      })
    } catch {
      /* best-effort */
    }
  })()
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
  return petsAsked(raw, pets, members)[0] ?? ''
}

/** Every pet of the household named in a routine question, in the order they
 *  appear in `pets` ("a rotina da Lola e da Aninha" → both, owner 2026-11). */
export function petsAsked(raw: string, pets: string[], members: string[] = []): string[] {
  const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const lw = fold(raw)
  if (!PET_NEED.test(lw)) return []
  const words = lw.split(/[^a-z0-9]+/).filter(Boolean)
  const firsts = pets.map((name) => ({ name, n: fold(name).trim(), first: fold(name).trim().split(/\s+/)[0] }))
  // the whole name, or its first word ("Lola" for "Lola Bean")
  const exact = firsts.filter((p) => p.n && (lw.includes(p.n) || words.includes(p.first))).map((p) => p.name)
  // One slip away — autocorrect and dictation turn "Cloe" into "Cole" — as
  // long as the word isn't a family member's name.
  const people = new Set(members.map((m) => fold(m).split(/\s+/)[0]))
  const slips = firsts
    .filter((p) => !exact.includes(p.name) && p.first.length >= 4)
    .filter((p) => words.some((w) => w.length >= 4 && !people.has(w) && oneSlip(w, p.first)))
    .map((p) => p.name)
  return pets.filter((name) => exact.includes(name) || slips.includes(name))
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

/** Words that put a request in money or the calendar — never the shopping
 *  list ("apaga o gasto do Ford's Garage" is not a list item, owner 2026-11). */
const NOT_LIST = /\b(gastos?|despesas?|lan[cç]amentos?|expenses?|charges?|gast[eé]|calend[aá]rio|calendar|eventos?|events?|compromissos?|agenda|or[cç]amento|budget|presupuesto)\b/i
const LIST_INTENTS = new Set(['add_items', 'check_items', 'remove_items', 'move_items', 'uncheck_items'])

export { isUndoAsk } from './assistantTalk'

export function localParse(raw: string, today: string): Intent | null {
  const r = parseLocal(raw, today)
  return r && LIST_INTENTS.has(r.intent) && NOT_LIST.test(raw) ? null : r
}

function parseLocal(raw: string, today: string): Intent | null {
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

export const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

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
  await checkItemIds(r.hits.map((i) => i.id))
  return r
}

/** Tick these items off (bought) — the same write as ticking them on the list,
 *  so Realtime moves them on every phone. `uncheckItems` is its Undo. Also used
 *  by Money's receipt scan ("remove them from the lists?"). */
export async function checkItemIds(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase
    .from('shopping_items')
    .update({ checked: true, checked_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

/** The household's open list items + its stores (RLS-scoped) — what a receipt
 *  scan sends so the model can say which ones the purchase covered. */
export async function fetchOpenList(): Promise<{ open: ShoppingItem[]; stores: ShoppingStore[] }> {
  const [stores, { data }] = await Promise.all([
    fetchStores(),
    supabase.from('shopping_items').select('*').eq('checked', false).order('created_at').limit(300),
  ])
  return { open: (data ?? []) as ShoppingItem[], stores }
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
  opts: EventOpts = {},
): Promise<CalendarEvent> {
  const timed = /^\d{2}:\d{2}$/.test(time)
  const [h, m] = timed ? time.split(':').map(Number) : [0, 0]
  const endH = Math.min(23, h + 1)
  const defaultEnd = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
  // A said end time only counts when it's after the start (else 1 h).
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
      owner_email: owner?.email ?? null,
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

// ── refs: the rows the model can point at ────────────────────────────────────

/** "e1" → an entry, "v3" → one occurrence of an event. Rebuilt with every
 *  context (recentContext), so a ref always means what the model was shown. */
export type Ref = { kind: 'entry'; id: string } | { kind: 'event'; id: string; start: string }
let refs = new Map<string, Ref>()
export const refTo = (ref?: string): Ref | undefined => (ref ? refs.get(ref) : undefined)

const shortTime = (t: string | null) => (t ? ` ${t.slice(0, 5)}` : '')

/** The latest money entries and the coming events as numbered lines for the
 *  model, and the ref map that resolves its answer back to the exact row. */
export async function recentContext(
  today: string,
  nameOf: (email: string | null) => string,
): Promise<{ entries: string[]; events: string[] }> {
  const [e, v] = await Promise.all([
    supabase.from('entries').select('id, label, amount, type, entry_date, person_email').order('created_at', { ascending: false }).limit(8),
    supabase.from('calendar_events').select('*'),
  ])
  const next = new Map<string, Ref>()
  const entries = ((e.data ?? []) as Entry[]).map((x, i) => {
    next.set(`e${i + 1}`, { kind: 'entry', id: x.id })
    return `e${i + 1} = ${x.label} · ${Number(x.amount).toFixed(2)} · ${x.type} · ${x.entry_date} · ${nameOf(x.person_email)}`
  })
  // A few days back too ("remove yesterday's dentist"), then what's coming.
  const occ = upcomingOccurrences((v.data ?? []) as CalendarEvent[], addDays(today, -3), 45).slice(0, 40)
  const events = occ.map((o, i) => {
    next.set(`v${i + 1}`, { kind: 'event', id: o.event.id, start: o.start })
    const who = nameOf(o.event.owner_email)
    return `v${i + 1} = ${o.event.title} · ${o.start}${shortTime(o.event.start_time)}${who ? ` · ${who}` : ''}`
  })
  refs = next
  return { entries, events }
}

export type Located =
  | { ok: true; occ: Occurrence }
  | { ok: false; reason: 'not_found' | 'ambiguous'; options: Occurrence[] }

/** Whose event the request named: a first name, and their email when that
 *  name is a member (a child without an account matches by title only). */
export interface EventWho {
  name: string
  email?: string | null
}

const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean)
/** Words that only tie a title to a name ("dentista DO Pedro", "Sam'S dentist"). */
const CONNECTORS = new Set(['o', 'a', 'do', 'da', 'de', 'dos', 'das', 'del', 'el', 'la', 'the', 'of', 'for', 's', 'para', 'pra'])

/** The event is this person's: they own it, or their name is in its title
 *  ("Dentista Pedro", "Pedro - dentista"). */
export function isTheirs(ev: CalendarEvent, who: EventWho): boolean {
  if (who.email && ev.owner_email === who.email) return true
  const first = words(who.name)[0]
  return !!first && words(ev.title).includes(first)
}

/** The title said, without the person's name and the "do/da/de/'s" that tied
 *  it ("dentista do Pedro" → "dentista"). */
function titleWithout(title: string, who: EventWho | undefined): string {
  if (!who) return norm(title)
  const name = words(who.name)[0]
  if (!name) return norm(title)
  return words(title)
    .filter((w, i, all) => w !== name && !(all[i + 1] === name && ['do', 'da', 'de', 'dos', 'das', 'del', 'of', 'for'].includes(w)) && w !== 's')
    .join(' ')
}

/** Pick the occurrence meant from `pool` (sorted soonest first) — pure, so it
 *  can be tested. A person (owner, or a name in the title) and a day narrow
 *  it; two DIFFERENT events still left (two kids' "Dentista") are ambiguous:
 *  the caller asks which, never takes the first (owner 2026-11). */
export function pickOccurrence(pool: Occurrence[], title: string, hasDate: boolean, who?: EventWho): Located {
  const n = titleWithout(title, who)
  const full = norm(title)
  const exact = (o: Occurrence) => {
    const t = norm(o.event.title)
    return !!n && (t === n || t === full)
  }
  // Every word said is in the title ("Dentista Pedro" for "dentista", or for
  // "dentista do Pedro"): as good as the exact name — both are asked about.
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
    // Named someone none of them belongs to: show what there is and ask.
    if (!theirs.length) return { ok: false, reason: 'ambiguous', options: dedupe(hits) }
    hits = theirs
  }
  if (!hits.length) return { ok: false, reason: 'not_found', options: hasDate ? pool : [] }
  // Two different events fit (two kids' "Dentista", "Dentista" and "Dentista
  // Pedro") and nothing said tells them apart: ask. The occurrences of ONE
  // series are not a question — the soonest (the pool is sorted).
  const options = dedupe(hits)
  if (options.length > 1) return { ok: false, reason: 'ambiguous', options }
  return { ok: true, occ: hits[0] }
}

/** One option per event (its soonest occurrence) — a weekly series must not
 *  fill the "which one?" list on its own. */
function dedupe(hits: Occurrence[]): Occurrence[] {
  const seen = new Set<string>()
  return hits.filter((o) => (seen.has(o.event.id) ? false : (seen.add(o.event.id), true)))
}

/** Find the event the user means, by (loose) title: on `date` when given, else
 *  its NEXT occurrence from `today` within `withinDays` ("remove unha" = the
 *  coming one). Recurring series are expanded, so "the swimming on Tuesday"
 *  finds that week's occurrence. With no title, the only event that day. */
export async function locateEvent(
  title: string,
  date: string,
  today: string,
  withinDays = 92,
  ref?: string,
  who?: EventWho,
): Promise<Located> {
  const { data } = await supabase.from('calendar_events').select('*')
  const events = (data ?? []) as CalendarEvent[]
  // The model pointed at a row it was shown: that exact occurrence — unless
  // it isn't the person named, or the words fit several people's events and
  // say nothing to tell them apart (the model picked one; the app asks).
  const r = refTo(ref)
  const byRef = r?.kind === 'event' ? events.find((ev) => ev.id === r.id) : undefined
  return locateIn(events, title, date, today, withinDays, byRef && r?.kind === 'event' ? { event: byRef, start: r.start } : undefined, who)
}

/** locateEvent over loaded events, pure (tested). A day that has nothing
 *  matching falls back to the coming weeks, as if no day were said: the
 *  model still sends date = TODAY for "muda o dentista para sexta" (the
 *  day it's moving TO is the only day said — verified live, 2026-11-14), and
 *  "nothing on today" must not end the search. The forward result still
 *  goes through the person / "which one?" checks. */
export function locateIn(
  events: CalendarEvent[],
  title: string,
  date: string,
  today: string,
  withinDays: number,
  ref?: { event: CalendarEvent; start: string },
  who?: EventWho,
): Located {
  const pool = date ? occurrencesInRange(events, date, date) : upcomingOccurrences(events, today, withinDays)
  const onDay = pickWithRef(pool, ref, title, date, who)
  if (!date || onDay.ok || onDay.reason !== 'not_found' || !(title.trim() || who)) return onDay
  const ahead = pickWithRef(upcomingOccurrences(events, today, withinDays), ref, title, '', who)
  return ahead.ok || ahead.reason === 'ambiguous' ? ahead : onDay
}

/** locateEvent's choice, pure (tested): the row the model pointed at, unless
 *  it isn't the person named or the words fit several people's events; on
 *  the DAY said when one was said — the context lists only a series' next
 *  occurrence, so "cancela a natação do dia 17" pointed at the 10th (review
 *  M4). A ref'd series that doesn't happen that day is ignored. */
export function pickWithRef(
  pool: Occurrence[],
  ref: { event: CalendarEvent; start: string } | undefined,
  title: string,
  date: string,
  who?: EventWho,
): Located {
  if (ref && (!who || isTheirs(ref.event, who))) {
    const byRef = ref.event
    const check = title && !who && !date ? pickOccurrence(pool, title, false) : null
    if (!(check && !check.ok && check.reason === 'ambiguous' && check.options.some((o) => o.event.id === byRef.id))) {
      if (date) {
        const onDay = occurrencesInRange([byRef], date, date)[0]
        if (onDay) return { ok: true, occ: onDay }
      } else {
        const occ = occurrencesInRange([byRef], ref.start, ref.start)[0] ?? { event: byRef, start: byRef.start_date, end: byRef.end_date }
        return { ok: true, occ }
      }
    }
  }
  return pickOccurrence(pool, title, !!date, who)
}

/** Pulled from a connected Apple/Google calendar: read-only here (the next
 *  sync would undo any change), so it has to be changed at the source. */
export const isExternal = (ev: CalendarEvent) => !!ev.source && ev.source !== 'oneroof'

export type MoveResult =
  | { ok: true; ev: CalendarEvent; before: CalendarEvent }
  /** `occs`: the occurrences behind `options` (when the search found any). */
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'external'; options: CalendarEvent[]; occs?: Occurrence[] }
  | { ok: false; reason: 'recurring'; options: CalendarEvent[]; occ: Occurrence }

const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00`

/** The date/time patch that moves `ev` from its occurrence on `occStart` to
 *  `to` (and `time` when given), keeping its length. For a series this shifts
 *  the whole series by the same number of days. */
function movePatch(ev: CalendarEvent, occStart: string, to: string, time: string) {
  const shift = Math.round((new Date(to + 'T12:00:00').getTime() - new Date(occStart + 'T12:00:00').getTime()) / 86_400_000)
  const patch: Partial<CalendarEvent> & { updated_at: string } = {
    start_date: addDays(ev.start_date, shift),
    end_date: addDays(ev.end_date, shift),
    updated_at: new Date().toISOString(),
  }
  if (/^\d{2}:\d{2}$/.test(time)) {
    // Keep the same duration (1 h when it was all-day).
    const [h, m] = time.split(':').map(Number)
    const len = ev.start_time && ev.end_time ? Math.max(15, (toMin(ev.end_time) ?? 0) - (toMin(ev.start_time) ?? 0)) : 60
    patch.all_day = false
    patch.start_time = `${time}:00`
    patch.end_time = fromMin(Math.min(23 * 60 + 59, h * 60 + m + len))
  }
  return patch
}

/** Move an existing event on `from` to `to` (and to `time` when given),
 *  keeping its length. A recurring one is NOT moved here: the caller asks
 *  whether to move the whole series (moveSeries). */
export async function moveEvent(
  title: string,
  from: string,
  to: string,
  time: string,
  today = from,
  ref?: string,
  who?: EventWho,
): Promise<MoveResult> {
  const r = await locateEvent(title, from, today, 92, ref, who)
  if (!r.ok) return { ok: false, reason: r.reason, options: r.options.map((o) => o.event), occs: r.options }
  return moveOccurrence(r.occ, to, time)
}

/** Move the occurrence the user picked (or locateEvent found). */
export async function moveOccurrence(occ: Occurrence, to: string, time: string): Promise<MoveResult> {
  const before = occ.event
  if (isExternal(before)) return { ok: false, reason: 'external', options: [before] }
  if (before.recurrence && before.recurrence !== 'none') return { ok: false, reason: 'recurring', options: [before], occ }
  return applyMove(before, occ.start, to, time)
}

/** Shift a whole series so the occurrence on `occStart` lands on `to`. */
export async function moveSeries(ev: CalendarEvent, occStart: string, to: string, time: string): Promise<MoveResult> {
  return applyMove(ev, occStart, to, time)
}

async function applyMove(before: CalendarEvent, occStart: string, to: string, time: string): Promise<MoveResult> {
  const { data: updated, error } = await supabase
    .from('calendar_events')
    // No new day said ("muda pra 15h"): it stays on the occurrence's day.
    .update(movePatch(before, occStart, to || occStart, time))
    .eq('id', before.id)
    .select('*')
    .single()
  if (error || !updated) return { ok: false, reason: 'not_found', options: [] }
  return { ok: true, ev: updated as CalendarEvent, before }
}

/** Undo a move or an edit: put the event's fields back as they were. */
export async function restoreEvent(before: CalendarEvent): Promise<void> {
  // Everything but the keys (the row's id and household never change).
  const fields: Partial<CalendarEvent> = { ...before }
  delete fields.id
  delete fields.household_id
  await supabase
    .from('calendar_events')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', before.id)
}

export type RemoveResult =
  | { ok: true; ev: CalendarEvent }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'external'; options: CalendarEvent[]; occs?: Occurrence[] }
  | { ok: false; reason: 'recurring'; options: CalendarEvent[]; occ: Occurrence }

/** Delete an existing event by (loose) title — on `date` when given, else the
 *  NEXT one. Anyone in the household may delete any event (RLS), whoever owns
 *  it. A recurring series is left for the caller to confirm (removeSeries /
 *  endSeries); a connected-calendar event must be deleted at its source. */
export async function removeEvent(title: string, date: string, today: string, ref?: string, who?: EventWho): Promise<RemoveResult> {
  const r = await locateEvent(title, date, today, 92, ref, who)
  if (!r.ok) return { ok: false, reason: r.reason, options: r.options.map((o) => o.event), occs: r.options }
  return removeOccurrence(r.occ)
}

/** Delete the occurrence's event (a series is left for the caller to confirm). */
export async function removeOccurrence(occ: Occurrence): Promise<RemoveResult> {
  const ev = occ.event
  if (isExternal(ev)) return { ok: false, reason: 'external', options: [ev] }
  if (ev.recurrence && ev.recurrence !== 'none') return { ok: false, reason: 'recurring', options: [ev], occ }
  const { error } = await supabase.from('calendar_events').delete().eq('id', ev.id)
  if (error) return { ok: false, reason: 'not_found', options: [] }
  return { ok: true, ev }
}

/** Delete a whole recurring series. */
export async function removeSeries(ev: CalendarEvent): Promise<boolean> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', ev.id)
  return !error
}

/** Stop a series before the occurrence on `occStart` (that one and all later
 *  ones go; earlier ones stay). On the first occurrence that's the series. */
export async function endSeries(ev: CalendarEvent, occStart: string): Promise<boolean> {
  if (occStart <= ev.start_date) return removeSeries(ev)
  const { error } = await supabase
    .from('calendar_events')
    .update({ recurrence_until: addDays(occStart, -1), updated_at: new Date().toISOString() })
    .eq('id', ev.id)
  return !error
}

/** Undo a removal: put the same row (same id) back. */
export async function unremoveEvent(ev: CalendarEvent): Promise<void> {
  await supabase.from('calendar_events').insert({ ...ev, updated_at: new Date().toISOString() })
}

export async function deleteEvent(id: string): Promise<void> {
  await supabase.from('calendar_events').delete().eq('id', id)
}

// ── doing: money ─────────────────────────────────────────────────────────────

export async function budgetsWithMonths(): Promise<{ budgets: Budget[]; months: Month[] }> {
  const [b, m] = await Promise.all([
    supabase.from('budgets').select('*').order('created_at'),
    supabase.from('months').select('*').order('start_date', { ascending: false }),
  ])
  return { budgets: (b.data ?? []) as Budget[], months: (m.data ?? []) as Month[] }
}

/** The period of `budget` that holds `date`; failing that, its LATEST period
 *  (owner, 2026-11: "add it to the last month/week/day") so a request on a day
 *  whose period hasn't been opened yet still lands somewhere sensible. */
export function periodForBudget(budget: Budget, months: Month[], date: string, strict = false): Month | null {
  const mine = months.filter((m) => m.budget_id === budget.id)
  const hit = mine.find((m) => m.start_date <= date && date <= periodEndISO(budget.period, m.start_date))
  // strict: an earlier period asked about by date — no "latest one" stand-in.
  if (hit || strict) return hit ?? null
  return [...mine].sort((x, y) => y.start_date.localeCompare(x.start_date))[0] ?? null
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
export async function moneySummary(budgetName: string, today: string, at?: string): Promise<MoneyLine[]> {
  const { budgets, months } = await budgetsWithMonths()
  const pick = budgetName ? budgets.filter((b) => norm(b.name) === norm(budgetName)) : budgets
  const lines: MoneyLine[] = []
  for (const b of pick.length ? pick : budgets) {
    const month = periodForBudget(b, months, at ?? today, !!at)
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
  /** Only overdue care was asked for. */
  view?: 'overdue'
}

export async function petsDue(today: string, petName = '', view?: 'overdue'): Promise<PetsAnswer> {
  const [pe, petRows, taskRows, doneRows] = await Promise.all([
    supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    supabase.from('pets').select('id, name'),
    supabase.from('pet_care_tasks').select('*'),
    supabase.from('pet_task_done').select('*').gte('done_on', addDaysISO(today, -370)),
  ])
  const pets = (petRows.data ?? []) as { id: string; name: string }[]
  const names = Object.fromEntries(pets.map((p) => [p.id, p.name]))
  // One name, or several ("Lola, Aninha"); "" = every pet.
  const asked = petName.split(',').map((x) => x.trim()).filter(Boolean)
  const wanted = asked
    .map((n) => pets.find((p) => norm(p.name) === norm(n)) ?? pets.find((p) => norm(p.name).startsWith(norm(n))))
    .filter((p): p is { id: string; name: string } => !!p)
  const ids = wanted.length ? wanted.map((p) => p.id) : pets.map((p) => p.id)
  const tasks = (taskRows.data ?? []) as PetCareTask[]
  const done = (doneRows.data ?? []) as PetTaskDone[]
  const due = overdueCare(ids, tasks, done, (pe.data ?? []) as PetEvent[], today)
  const late: PetDue[] = due
    .filter((d) => d.dueIn < 0)
    .map((d) => ({ id: d.key, title: d.title, pet: names[d.petId] ?? '', status: 'overdue', late: -d.dueIn }))
  // The checklist count covers every pet asked about (one or several).
  const checklist = wanted.flatMap((w) => dailyChecklist(tasks, done, w.id, today))
  const routine: PetDue[] = ids.flatMap((id) =>
    dailyChecklist(tasks, done, id, today)
      .filter((r) => !r.done)
      .map((r) => ({ id: `daily:${r.task.id}`, title: r.task.title, pet: names[id] ?? '', status: 'routine' as const, late: 0 })),
  )
  const todayRows: PetDue[] = due
    .filter((d) => d.dueIn === 0)
    .map((d) => ({ id: d.key, title: d.title, pet: names[d.petId] ?? '', status: 'today', late: 0 }))
  // Only what's late ("algum cuidado atrasado?"): no checklist, no progress.
  if (view === 'overdue') return { rows: late, pet: wanted.map((w) => w.name).join(', '), routineDone: 0, routineTotal: 0, view }
  // Every pet (or several): grouped by pet, in the household's pet order, so
  // the answer reads pet by pet (owner, 2026-11).
  const order = new Map(ids.map((id, i) => [names[id] ?? '', i]))
  const all = [...late, ...routine, ...todayRows]
  const rows = ids.length > 1 ? all.map((r, i) => ({ r, i })).sort((a, b) => (order.get(a.r.pet) ?? 0) - (order.get(b.r.pet) ?? 0) || a.i - b.i).map((x) => x.r) : all
  return {
    rows,
    pet: wanted.map((w) => w.name).join(', '),
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
