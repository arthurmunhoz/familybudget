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
  Bell,
  Bug,
  CalendarDays,
  FolderLock,
  LogIn,
  PawPrint,
  ShoppingCart,
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
  'pet.created': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `added a pet: ${quote(str(m.name))}` }),
  'pet.updated': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `edited a pet: ${quote(str(m.name))}` }),
  'pet.deleted': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `deleted a pet: ${quote(str(m.name))}` }),
  'pet.event_logged': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `logged ${quote(str(m.title))} for a pet` }),
  'pet.event_updated': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `edited ${quote(str(m.title))} for a pet` }),
  'pet.event_deleted': (m) => ({ icon: PawPrint, app: 'Pets', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))} for a pet` }),
  'nudge.sent': (m) => ({ icon: Bell, app: 'Nudges', isError: false, detail: null, predicate: `nudged the household ${quote(str(m.message))}` }),
  'doc.uploaded': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: `uploaded ${quote(str(m.title))}` }),
  'doc.opened': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: `opened ${quote(str(m.title))}` }),
  'doc.deleted': (m) => ({ icon: FolderLock, app: 'Documents', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))}` }),
  'calendar.created': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: null, predicate: `added ${quote(str(m.title))} to the calendar` }),
  'calendar.updated': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: null, predicate: `edited ${quote(str(m.title))}` }),
  'calendar.deleted': (m) => ({ icon: CalendarDays, app: 'Calendar', isError: false, detail: null, predicate: `deleted ${quote(str(m.title))}` }),
  'member.added': (m) => ({ icon: Users, app: 'Family', isError: false, detail: null, predicate: `added a member: ${quote(str(m.name) || str(m.email))}` }),
  'plan.changed': (m) => ({ icon: Award, app: 'Admin', isError: false, detail: null, predicate: `set the plan to ${str(m.plan) || 'free'}` }),
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
  return null // page_view / screen_view / unknown → not shown in the feed
}

/**
 * Interpret the raw rows and drop consecutive duplicates — the PWA's capture
 * click listener can log the same label twice for one tap. Dedupe keys on
 * household too, so identical actions from different families on the
 * cross-household feed aren't collapsed together.
 */
export function buildFeed(rows: EventRow[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const row of rows) {
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
