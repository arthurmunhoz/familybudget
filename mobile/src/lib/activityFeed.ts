// Interprets raw web_events rows (from admin_household_events / admin_recent_events)
// into readable activity-feed lines for the Admin screens.
//
// Semantic events (entry.created, nudge.sent, …) are rendered PRECISELY from
// their structured `meta` payload via CATALOG below — language-independent and
// exact. Legacy behavioral rows (web page clicks, session starts, errors) fall
// back to the older heuristic so historical + PWA data still reads. page_view /
// screen_view are filtered out server-side and skipped here.
import {
  Award,
  LayoutGrid,
  Bell,
  Bug,
  CalendarDays,
  Eye,
  FolderLock,
  LogIn,
  PawPrint,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native'

import { appForPath } from './appRoutes'
import { formatMoney } from './format'

/** Raw row from admin_household_events (059) / admin_recent_events (061/062). */
export interface EventRow {
  id: number
  household_id?: string // present only on the cross-household feed
  user_email: string
  type: string
  path: string | null
  target: string | null
  meta?: Record<string, unknown> | null
  created_at: string
}

/** An interpreted, ready-to-render line in the activity feed. */
export interface FeedItem {
  id: number
  household_id?: string
  user_email: string
  icon: LucideIcon
  predicate: string // reads after the actor's name: 'added “Groceries” −$84.20'
  app: string | null // app context for the sub-line, if any
  detail: string | null // extra sub-line (e.g. an error message)
  isError: boolean
  created_at: string
}

type Described = Pick<FeedItem, 'id' | 'icon' | 'predicate' | 'app' | 'detail' | 'isError'>
type Rendered = Omit<Described, 'id'>

const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const quote = (s: string) => (s ? `“${s}”` : 'an item')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
/** "filled photo, birthday · left breed, weight empty" from fieldsUsed() meta. */
function fieldsLine(m: Record<string, unknown>): string | null {
  const f = list(m.filled)
  const e = list(m.empty)
  if (!f.length && !e.length) return null
  return [f.length ? `filled ${f.join(', ')}` : 'filled nothing', e.length ? `left ${e.join(', ')} empty` : 'every field filled'].join(' · ')
}
/** Who a nudge went to. */
function profileLine(verb: string, m: Record<string, unknown>): string {
  const bits = [m.shoeSystem ? `shoe size in ${str(m.shoeSystem)}` : '', m.phoneCode ? `phone +${str(m.phoneCode)}` : '', m.renamed ? 'changed their name' : '']
    .filter(Boolean)
    .join(', ')
  return bits ? `${verb} (${bits})` : verb
}
function nudgeTo(m: Record<string, unknown>): string {
  if (m.urgent) return 'everyone, as urgent'
  const n = m.recipients == null ? 0 : num(m.recipients)
  return n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'everyone'
}
function nudgeLine(m: Record<string, unknown>): string {
  const source = str(m.source) || (m.drawing ? 'drawing' : str(m.kind) === 'custom' ? 'typed' : '')
  const to = nudgeTo(m)
  switch (source) {
    case 'preset':
      return `sent the ready-made nudge “${str(m.kind)}” to ${to}`
    case 'custom_preset':
      return `sent one of the family's own saved nudges to ${to}`
    case 'typed':
      return `typed a nudge (${num(m.messageLength)} chars) to ${to}`
    case 'ai':
      return `sent a nudge written from free text (AI) to ${to}`
    case 'assistant':
      return `had Roof send a nudge to ${to}`
    case 'drawing':
      return `sent a hand-drawn note to ${to}`
    case 'location':
      return `asked ${to} to share their location`
    default:
      return `sent a nudge (${str(m.kind) || 'unknown kind'}) to ${to}`
  }
}
function taskAdded(m: Record<string, unknown>): string {
  const pet = str(m.pet) || 'a pet'
  if (str(m.source) === 'template' || str(m.title) === 'template')
    return `added the suggested routine${m.count ? ` (${num(m.count)} tasks)` : ''} to ${pet}`
  const how = str(m.kind) === 'interval' ? `every ${num(m.everyDays)} days` : str(m.kind) === 'daily' ? 'daily' : ''
  const extras = [how, m.atTime ? 'with a time' : '', m.reminder ? 'with a reminder' : ''].filter(Boolean).join(', ')
  return `added a task to ${pet}'s routine${extras ? ` (${extras})` : ''}`
}
function calendarLine(verb: string, m: Record<string, unknown>): string {
  const kind = str(m.kind) || 'event'
  if (m.allDay === undefined) return `${verb} ${quote(str(m.title)) === 'an item' ? `a ${kind}` : quote(str(m.title))}`
  const bits = [
    m.allDay ? 'all-day' : 'timed',
    m.multiDay ? 'multi-day' : '',
    str(m.repeat) && str(m.repeat) !== 'none' ? `repeats ${str(m.repeat)}` : '',
    str(m.forWhom) === 'household' ? 'for the whole family' : 'for one member',
  ].filter(Boolean)
  return `${verb} a ${kind} (${bits.join(', ')})`
}

/** Signed money for a Money event: income shows +, expense shows −. */
function signed(m: Record<string, unknown>): string {
  const sign = str(m.kind) === 'income' ? '+' : '−'
  return `${sign}${formatMoney(num(m.amount))}`
}

/**
 * Renderers for each semantic event type. Each maps the event's `meta` payload
 * to a feed line. Keep in sync with the EventName union in lib/analytics.ts.
 */
const CATALOG: Record<string, (m: Record<string, unknown>) => Rendered> = {
  'entry.created': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: `added ${quote(str(m.label))} ${signed(m)}` }),
  'entry.updated': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: `edited ${quote(str(m.label))}` }),
  'entry.deleted': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: `deleted ${quote(str(m.label))}` }),
  'budget.created': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: `created a budget: ${quote(str(m.name))}` }),
  'budget.visibility_changed': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: str(m.to) === 'private' ? `made ${quote(str(m.name))} private` : `shared ${quote(str(m.name))} with the household` }),
  'period.deleted': (m) => ({ icon: Wallet, app: 'Money', isError: false, detail: null, predicate: `deleted a budget period${m.label ? `: ${quote(str(m.label))}` : ''}` }),
  'shopping.added': (m) => ({ icon: ShoppingCart, app: 'Shopping', isError: false, detail: null, predicate: `added ${quote(str(m.item))} to the list` }),
  'shopping.checked': (m) => ({ icon: ShoppingCart, app: 'Shopping', isError: false, detail: null, predicate: `checked off ${quote(str(m.item))}` }),
  'shopping.removed': (m) => ({ icon: ShoppingCart, app: 'Shopping', isError: false, detail: null, predicate: `removed ${quote(str(m.item))} from the list` }),
  'shopping.cleared': (m) => ({ icon: ShoppingCart, app: 'Shopping', isError: false, detail: null, predicate: `cleared ${num(m.count)} checked item${num(m.count) === 1 ? '' : 's'}` }),
  'pet.created': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: fieldsLine(m), predicate: m.name ? `added a pet: ${quote(str(m.name))}` : `added a pet${m.species ? ` (${str(m.species)})` : ''}` }),
  'pet.updated': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: fieldsLine(m), predicate: m.name ? `edited a pet: ${quote(str(m.name))}` : `edited a pet${m.species ? ` (${str(m.species)})` : ''}` }),
  'pet.deleted': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `deleted a pet: ${quote(str(m.name))}` }),
  'pet.event_logged': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `logged ${quote(str(m.title))} for a pet` }),
  'pet.event_updated': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `edited ${quote(str(m.title))} for a pet` }),
  'pet.event_deleted': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))} for a pet` }),
  'petcare.task_done': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `did ${quote(str(m.title))} for ${str(m.pet) || 'a pet'}` }),
  'petcare.task_added': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: taskAdded(m) }),
  'petcare.task_deleted': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `removed ${quote(str(m.title))} from ${str(m.pet) || 'a pet'}'s routine` }),
  'pet.weight_logged': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `logged ${str(m.pet) || 'a pet'}'s weight: ${str(m.weight)}` }),
  'roof.asked': (m) => ({
    icon: Sparkles,
    app: 'Roof',
    isError: m.ok === false,
    detail: null,
    predicate: `asked Roof${m.where === 'casa' ? ' on the home device' : ''} (${m.via === 'voice' ? 'by voice' : 'typed'}) → ${str(m.intent).replace(/_/g, ' ') || '?'}${m.ok === false ? ' — not done' : ''}`,
  }),
  'nudge.sent': (m) => ({ icon: Bell, app: 'Nudges', isError: false, detail: null, predicate: nudgeLine(m) }),
  'doc.uploaded': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: m.fileType ? `uploaded a ${str(m.fileType)} to ${str(m.category)} (${num(m.sizeKb)} KB, ${str(m.forWhom) === 'household' ? 'shared' : str(m.forWhom) === 'self' ? 'their own' : 'for a member'})` : `uploaded ${quote(str(m.title))}` }),
  'doc.opened': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: `opened ${quote(str(m.title))}` }),
  'doc.deleted': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))}` }),
  'calendar.created': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: fieldsLine(m), predicate: calendarLine('added', m) }),
  'calendar.updated': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: fieldsLine(m), predicate: calendarLine('edited', m) }),
  'calendar.deleted': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))}` }),
  'profile.created': (m) => ({ icon: Users, app: 'Family', isError: false, detail: fieldsLine(m), predicate: profileLine('filled in their profile', m) }),
  'profile.updated': (m) => ({ icon: Users, app: 'Family', isError: false, detail: fieldsLine(m), predicate: profileLine('edited their profile', m) }),
  'member.added': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `added a member: ${quote(str(m.name) || str(m.email))}` }),
  'household.created': () => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: 'created the household' }),
  'household.joined': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `joined the household (${str(m.via) || 'code'})` }),
  'invite.shown': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `saw the invite (${str(m.source)})` }),
  'invite.shared': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `shared the invite (${str(m.source)})` }),
  'invite.skipped': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `skipped the invite (${str(m.source)})` }),
  'plan.changed': (m) => ({ icon: Award, app: 'Admin', isError: false, detail: null, predicate: `set the plan to ${str(m.plan) || 'free'}` }),
  'apps.customized': (m) => ({ icon: LayoutGrid, app: 'Settings', isError: false, detail: null, predicate: `customized their app list (${num(m.hidden)} hidden)` }),
}

/** Turn a raw web_event into a readable line, or null to skip it as noise. */
function describe(row: EventRow): Described | null {
  const render = CATALOG[row.type]
  if (render) {
    const m = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {}
    return { id: row.id, ...render(m) }
  }
  // Legacy behavioral fallbacks (PWA history + generic native events).
  if (row.type === 'session_start')
    return { id: row.id, icon: LogIn, predicate: 'opened the app', app: null, detail: null, isError: false }
  if (row.type === 'error')
    return { id: row.id, icon: Bug, predicate: 'hit an error', app: null, detail: clean(row.target) || null, isError: true }
  if (row.type === 'click') {
    const label = clean(row.target)
    // Skip chrome (back chevrons, ✕, bare arrows): require at least one letter/number.
    if (label.length < 2 || !/[a-z0-9]/i.test(label)) return null
    const app = appForPath(row.path)
    return { id: row.id, icon: app.icon, predicate: `tapped ${quote(label)}`, app: app.name, detail: null, isError: false }
  }
  return null // page_view / unknown → not shown in the feed
}

// ── Screens visited (2026-11-16) ────────────────────────────────────────────
// Opening a feature says someone was curious about it even if they never used
// it, so screen_view rows show up — folded into one "looked at A → B → C" line
// per run of consecutive screens, so they don't drown the actions.
const SCREEN_NAMES: Record<string, string> = {
  '/': 'Home',
  '/calc': 'Utilities',
  '/calc/even': 'Utilities › Split evenly',
  '/calc/items': 'Utilities › Split by item',
  '/calc/deal': 'Utilities › Better deal',
  '/calc/discount': 'Utilities › Discount',
  '/calc/tag': 'Utilities › Luggage tag',
  '/calc/frame': 'Utilities › Photo frame',
  '/calc/frame-show': 'Utilities › Photo frame (showing)',
  '/games/send': 'Games › Send a word',
  '/family/birthday': 'Family › Birthday',
  '/pings': 'Nudges',
  '/notes': 'Notes wall',
  '/draw-note': 'Draw a note',
  '/shopping': 'Lists',
  '/settings': 'Settings',
  '/paywall': 'Plus (paywall)',
  '/casa-mode': 'Modo Casa',
  '/casa': 'Modo Casa',
  '/families': 'My households',
  '/google-calendar': 'Google Calendar',
  '/apple-calendar': 'Apple Calendar',
  '/location': 'Whereabouts',
}
export function screenName(path: string | null): string {
  const p = (path ?? '/').split('?')[0].replace(/\/+$/, '') || '/'
  if (SCREEN_NAMES[p]) return SCREEN_NAMES[p]
  const parts = p.split('/').filter(Boolean)
  if (parts[0] === 'games' && parts[1]) return 'Games › a game room'
  if (parts[0] === 'pets' && parts[1]) return 'Pets › a pet'
  if (parts[0] === 'budget' && parts.length >= 3) return 'Money › a period'
  if (parts[0] === 'budget' && parts[1]) return 'Money › a budget'
  if (parts[0] === 'admin') return 'Admin'
  return appForPath(p).name
}
const SCREEN_RUN_MAX = 8

/**
 * Interpret the raw rows and drop consecutive duplicates — the PWA's capture
 * click listener can log the same label twice for one tap. Dedupe keys on
 * household too, so identical actions from different families on the
 * cross-household feed aren't collapsed together.
 */
function browsed(screens: string[]): string {
  const shown = screens.length > SCREEN_RUN_MAX ? ['…', ...screens.slice(-SCREEN_RUN_MAX)] : screens
  return `looked at ${shown.join(' → ')}`
}

export function buildFeed(rows: EventRow[]): FeedItem[] {
  const out: FeedItem[] = []
  // Rows come newest first; a run of screen views is built backwards, then
  // read forwards (oldest → newest) when printed.
  let run: { item: FeedItem; screens: string[] } | null = null
  for (const row of rows) {
    if (row.type === 'screen_view') {
      const name = screenName(row.path)
      if (run && run.item.user_email === row.user_email && run.item.household_id === row.household_id) {
        if (run.screens[0] !== name) run.screens.unshift(name)
        run.item.predicate = browsed(run.screens)
        continue
      }
      const item: FeedItem = {
        id: row.id,
        icon: Eye,
        predicate: browsed([name]),
        app: null,
        detail: null,
        isError: false,
        user_email: row.user_email,
        created_at: row.created_at,
        household_id: row.household_id,
      }
      run = { item, screens: [name] }
      out.push(item)
      continue
    }
    run = null
    const d = describe(row)
    if (!d) continue
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.user_email === row.user_email &&
      prev.predicate === d.predicate &&
      prev.household_id === row.household_id
    )
      continue
    out.push({
      ...d,
      user_email: row.user_email,
      created_at: row.created_at,
      household_id: row.household_id,
    })
  }
  return out
}
