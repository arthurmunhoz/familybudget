// What the server understood, typed — Roof on the home device reads the same
// answer as the phone. A copy of the PURE half of mobile/src/lib/assistant.ts
// (Intent, moneyRange, fromServer, petsAsked) and mobile/src/lib/assistantGuard.ts
// (cut-off requests never write). Keep them in step when the phone's change.
import { addDays } from '../lib/calendar'
import type { EventKind, EventRecurrence, PetEventType } from '../lib/types'

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
  | { intent: 'edit_event'; title: string; date: string; newTitle: string; location: string; notes: string; reminder: number; recurrence?: EventRecurrence; ref?: string; person?: string }
  | { intent: 'find_event'; title: string; date: string; ref?: string; person?: string }
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

/** Every intent this build knows (anything else = "not sure"). */
export const KNOWN_INTENTS = new Set([
  'add_items', 'list_items', 'find_items', 'check_items', 'remove_items', 'move_items', 'clear_checked', 'uncheck_items',
  'agenda', 'add_event', 'edit_event', 'find_event', 'move_event', 'remove_event', 'birthdays', 'day_summary',
  'add_money', 'money_summary', 'list_money', 'fix_money', 'remove_money', 'split_bill', 'discount', 'better_deal',
  'send_nudge', 'nudge_seen', 'pets_due', 'pet_done', 'pet_log', 'pet_next', 'pet_weight',
  'family_info', 'family_update', 'where_is', 'weather', 'open_document', 'open_app', 'start_game', 'app_help', 'undo_last',
  'create_list', 'edit_item', 'my_nudges', 'ask_location', 'free_check', 'pet_who', 'call_member', 'days_until',
  'unknown',
])

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
      const rec = str('recurrence')
      const repeat = rec === 'daily' || rec === 'weekly' || rec === 'monthly' || rec === 'yearly' ? { recurrence: rec as EventRecurrence } : {}
      if (!str('new_title') && !str('location') && !str('notes') && reminder === -1 && !repeat.recurrence) {
        // Only a new TIME ("na verdade é às 16"): that's a move on the same day.
        const time = /^\d{2}:\d{2}$/.test(str('time')) ? str('time') : ''
        return time ? { intent: 'move_event', title: str('title'), date: isoOr('date'), newDate: '', time, ...ref, ...whose } : null
      }
      return {
        intent: 'edit_event',
        title: str('title'),
        date: isoOr('date'),
        newTitle: str('new_title'),
        location: str('location'),
        notes: str('notes'),
        reminder,
        ...repeat,
        ...ref,
        ...whose,
      }
    }
    case 'find_event':
      return str('title') || ref.ref ? { intent: 'find_event', title: str('title'), date: isoOr('date'), ...ref, ...whose } : null
    case 'move_event': {
      const newDate = /^\d{4}-\d{2}-\d{2}$/.test(str('new_date')) ? str('new_date') : ''
      // Nowhere to go and no new time: not a usable move.
      if (!newDate && !str('time')) return null
      return { intent: 'move_event', title: str('title'), date, newDate: newDate || date, time: str('time'), ...ref, ...whose }
    }
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
    case 'undo_last':
      return { intent: 'undo_last' }
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

/** Reads the pet-routine override may replace (never a write). */
export const PET_SWAPPABLE = new Set(['pets_due', 'unknown', 'family_info', 'agenda', 'day_summary', 'find_items', 'list_items', 'app_help', 'where_is'])


/** Intents that change household data (a send_nudge is only sent on a tap,
 *  but a cut-off message is still not worth offering). */
export const WRITE_INTENTS = new Set([
  'add_items',
  'check_items',
  'remove_items',
  'move_items',
  'clear_checked',
  'uncheck_items',
  'add_event',
  'move_event',
  'remove_event',
  'edit_event',
  'add_money',
  'fix_money',
  'remove_money',
  'pet_done',
  'pet_log',
  'pet_weight',
  'family_update',
  'send_nudge',
])

// Words a sentence doesn't end on: articles, prepositions, "and". A spoken
// request ending on one was cut off by the recogniser ("marca uma consulta
// da", "add milk to the") — owner report 2026-11, a wrong write ran.
const DANGLING = new Set([
  // pt
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'pro', 'na', 'no', 'nas', 'nos',
  'em', 'com', 'e', 'ou', 'que', 'pela', 'pelo', 'ao', 'à', 'meu', 'minha', 'seu', 'sua',
  // en
  'the', 'an', 'to', 'for', 'of', 'on', 'in', 'at', 'with', 'and', 'or', 'my', 'our', 'his', 'her', 'their', 'from',
  // es
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'al', 'en', 'con', 'y', 'mi', 'su', 'por',
])

/** True when the request ends mid-phrase (on an article / preposition / "and"). */
export function looksCut(text: string): boolean {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,;:]+$/u, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length < 2) return false
  return DANGLING.has(words[words.length - 1])
}

/** A write understood from a cut-off request: ask instead of doing it. */
export function cutWrite(intentName: string, text: string): boolean {
  return WRITE_INTENTS.has(intentName) && looksCut(text)
}
