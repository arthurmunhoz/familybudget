// Interprets raw web_events rows (from admin_household_events / admin_recent_events)
// into readable activity-feed lines for the Admin screens. Clicks become the
// button label they carry (the closest thing to an "action"), session starts and
// errors get their own phrasing; page views are already filtered server-side.
import { Bug, LogIn, type LucideIcon } from 'lucide-react-native'

import { appForPath } from './appRoutes'

/** Raw row from admin_household_events (059) / admin_recent_events (061). */
export interface EventRow {
  id: number
  household_id?: string // present only on the cross-household feed
  user_email: string
  type: string
  path: string | null
  target: string | null
  created_at: string
}

/** An interpreted, ready-to-render line in the activity feed. */
export interface FeedItem {
  id: number
  household_id?: string
  user_email: string
  icon: LucideIcon
  predicate: string // reads after the actor's name: 'tapped “Save”'
  app: string | null // app context for the sub-line, if any
  detail: string | null // extra sub-line (e.g. an error message)
  isError: boolean
  created_at: string
}

const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

type Described = Pick<FeedItem, 'id' | 'icon' | 'predicate' | 'app' | 'detail' | 'isError'>

/** Turn a raw web_event into a readable line, or null to skip it as noise. */
function describe(row: EventRow): Described | null {
  if (row.type === 'session_start')
    return { id: row.id, icon: LogIn, predicate: 'opened the app', app: null, detail: null, isError: false }
  if (row.type === 'error')
    return { id: row.id, icon: Bug, predicate: 'hit an error', app: null, detail: clean(row.target) || null, isError: true }
  // click — the button label is the closest thing we have to an "action".
  const label = clean(row.target)
  // Skip chrome (back chevrons, ✕, bare arrows): require at least one letter/number.
  if (label.length < 2 || !/[a-z0-9]/i.test(label)) return null
  const app = appForPath(row.path)
  return { id: row.id, icon: app.icon, predicate: `tapped “${label}”`, app: app.name, detail: null, isError: false }
}

/**
 * Interpret the raw rows and drop consecutive duplicates — the capture-phase
 * click listener can log the same label twice for one tap (nested button/link).
 * Dedupe keys on household too, so identical actions from different families on
 * the cross-household feed aren't collapsed together.
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
