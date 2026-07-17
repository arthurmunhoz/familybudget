// Home-Screen widget backend — both widget actions in one function. Auth is the
// per-device WIDGET TOKEN (not a Supabase session), since the widget extension
// has no session: migration 045's widget_tokens.
//
//   ?action=nudge — send a household nudge from the Nudges widget (fans out web
//                   + Expo push to the recipients, excluding the sender).
//   ?action=today — today's agenda for the Today widget, so it can refresh
//                   itself with the app closed.
//
// MERGED from api/widget-nudge.ts + api/widget-today.ts to stay under Vercel
// Hobby's 12-function cap. /api/widget-nudge STILL WORKS — vercel.json rewrites
// it here with ?action=nudge — because the shipped App Store build's widget
// posts to that path and can't be changed. Don't remove that rewrite. The action
// also defaults to 'nudge' below as a belt-and-braces fallback for that frozen
// client.
//
// Env (Vercel): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// ── Self-contained calendar / pet-care logic ─────────────────────────────────
// COPIED from src/lib/calendar.ts + src/lib/petCare.ts rather than imported.
// package.json sets "type": "module", so Vercel transpiles api/*.ts as ESM and
// resolves ONLY node_modules — a relative import of ../src/lib/* builds and
// deploys happily, then dies at runtime with:
//   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/lib/calendar'
// (learned the hard way). This is exactly why api/send-digest.ts hand-rolls its
// own date logic too — every function under api/ must stand alone.
// KEEP IN SYNC with src/lib/calendar.ts + src/lib/petCare.ts.
type EventKind = 'event' | 'birthday' | 'anniversary' | 'renewal' | 'other'
type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
interface CalendarEvent {
  id: string
  title: string
  kind: EventKind
  all_day: boolean
  start_date: string
  end_date: string
  start_time: string | null
  recurrence: EventRecurrence
  recurrence_until: string | null
}
interface PetEvent {
  pet_id: string
  type: string
  title: string
  event_date: string
  next_due: string | null
}
interface Occurrence {
  event: CalendarEvent
  start: string
  end: string
}

const KIND_EMOJI: Record<EventKind, string> = {
  event: '',
  birthday: '🎂',
  anniversary: '💍',
  renewal: '📋',
  other: '📌',
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000)
}
/** Add n months, clamping the day to the target month's length (Jan 31 → Feb 28). */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, m - 1 + n, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  return toISO(new Date(base.getFullYear(), base.getMonth(), Math.min(d, lastDay)))
}
function nextRecurrence(iso: string, freq: EventRecurrence): string {
  switch (freq) {
    case 'daily':
      return addDays(iso, 1)
    case 'weekly':
      return addDays(iso, 7)
    case 'monthly':
      return addMonths(iso, 1)
    case 'yearly':
      return addMonths(iso, 12)
    default:
      return iso
  }
}

/** Every occurrence intersecting [rangeStart, rangeEnd] (we only ever ask for a
 *  single day). Recurrence is expanded lazily + bounded, so an old daily event
 *  doesn't blow up. */
function occurrencesInRange(
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): Occurrence[] {
  const out: Occurrence[] = []
  for (const ev of events) {
    const duration = Math.max(0, daysBetween(ev.start_date, ev.end_date))
    const target = addDays(rangeStart, -duration)

    if (ev.recurrence === 'none') {
      if (ev.start_date <= rangeEnd && ev.end_date >= rangeStart) {
        out.push({ event: ev, start: ev.start_date, end: ev.end_date })
      }
      continue
    }

    let cur = ev.start_date
    if (cur < target) {
      const gap = daysBetween(ev.start_date, target)
      if (ev.recurrence === 'daily') cur = addDays(ev.start_date, Math.max(0, gap))
      else if (ev.recurrence === 'weekly')
        cur = addDays(ev.start_date, Math.max(0, Math.floor(gap / 7)) * 7)
    }
    let guard = 0
    while (cur < target && guard++ < 2000) cur = nextRecurrence(cur, ev.recurrence)

    guard = 0
    while (cur <= rangeEnd && guard++ < 2000) {
      if (ev.recurrence_until && cur > ev.recurrence_until) break
      const occEnd = addDays(cur, duration)
      if (occEnd >= rangeStart) out.push({ event: ev, start: cur, end: occEnd })
      cur = nextRecurrence(cur, ev.recurrence)
    }
  }
  return out
}

/** Sort occurrences for an agenda: all-day first, then by start time. */
function compareOccurrences(a: Occurrence, b: Occurrence): number {
  if (a.event.all_day !== b.event.all_day) return a.event.all_day ? -1 : 1
  const at = a.event.start_time ?? ''
  const bt = b.event.start_time ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.event.title.localeCompare(b.event.title)
}

/** Years marked at an occurrence — age for a birthday, years for an anniversary. */
function yearsAt(ev: CalendarEvent, occurrenceStartISO: string): number {
  return Number(occurrenceStartISO.slice(0, 4)) - Number(ev.start_date.slice(0, 4))
}

/** "9:00 AM" from "09:00[:00]", localized. */
function formatTime(hhmm: string, locale: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Latest event per (pet, type, title) that is due today or already past.
 *  Input must be sorted newest-first (event_date desc). */
function overdueEvents(events: PetEvent[], today: string): PetEvent[] {
  const latest = new Map<string, PetEvent>()
  for (const e of events) {
    const key = `${e.pet_id}|${e.type}|${e.title.trim().toLowerCase()}`
    if (!latest.has(key)) latest.set(key, e)
  }
  return [...latest.values()]
    .filter((e) => e.next_due)
    .sort((a, b) => a.next_due!.localeCompare(b.next_due!))
    .filter((e) => e.next_due! <= today)
}

// The four agenda strings, mirrored from src/lib/i18n (same reason as above —
// the dicts can't be imported here). Keep in sync with the home.* keys.
const DICTS: Record<string, Record<string, string>> = {
  en: { turns: 'turns {n}', years: '{n} years', overdue: 'Overdue', dueToday: 'Due today' },
  es: { turns: 'cumple {n}', years: '{n} años', overdue: 'Atrasado', dueToday: 'Para hoy' },
  pt: { turns: 'faz {n}', years: '{n} anos', overdue: 'Atrasado', dueToday: 'Para hoje' },
}
const MAX_ITEMS = 6
const MAX_ENTRIES = 8

// ── Self-contained budget logic (same import constraint as above) ────────────
// COPIED from src/lib/format.ts (periodEndISO) + src/lib/categories.ts.
// KEEP IN SYNC with those.
type Period = 'daily' | 'weekly' | 'monthly'

const CATEGORY_ICON: Record<string, string> = {
  groceries: '🛒',
  dining: '🍽️',
  transport: '🚗',
  home: '🏠',
  utilities: '💡',
  health: '💊',
  entertainment: '🎬',
  shopping: '🛍️',
  travel: '✈️',
  subscriptions: '📺',
  gifts: '🎁',
  pets: '🐾',
  salary: '💼',
  other: '📦',
}
const FALLBACK_CATEGORY = 'other'

function periodEndISO(period: Period, startISO: string): string {
  if (period === 'daily') return startISO
  if (period === 'weekly') return addDays(startISO, 6)
  const d = parseISO(startISO)
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** Mirrors categoryById(): built-in (+ the household's override) → custom →
 *  'other' (so an entry still renders if its custom category was deleted).
 *  An override row with a null icon means "keep the default". */
function categoryIcon(
  id: string,
  custom: Map<string, string>,
  overrides: Map<string, string | null>,
): string {
  if (CATEGORY_ICON[id]) return overrides.get(id) ?? CATEGORY_ICON[id]
  const c = custom.get(id)
  if (c) return c
  return overrides.get(FALLBACK_CATEGORY) ?? CATEGORY_ICON[FALLBACK_CATEGORY]
}

async function sendExpoPush(
  messages: {
    to: string
    title: string
    body: string
    data?: Record<string, unknown>
    sound?: 'default'
  }[],
): Promise<number> {
  const valid = messages.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'),
  )
  let sent = 0
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (r.ok) sent += chunk.length
    } catch {
      /* swallow */
    }
  }
  return sent
}

/** Same {n} interpolation the app's t() does, for the four keys we need. */
function tr(lang: string, key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang] ?? DICTS.en
  let s = dict[key] ?? DICTS.en[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return res.status(500).json({ error: 'Not configured' })

  // Defaults to 'nudge': that's the only legacy caller (the shipped widget),
  // and it posts no action of its own.
  const action = String(req.query?.action ?? req.body?.action ?? 'nudge')

  const { token } = req.body ?? {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Resolve the widget token → sender + household. NOTE: the service role
  // bypasses RLS, so the household_id filters below ARE the tenancy boundary.
  const { data: wt } = await db
    .from('widget_tokens')
    .select('user_email, household_id')
    .eq('token', token)
    .maybeSingle()
  if (!wt) return res.status(401).json({ error: 'Invalid token' })
  const senderEmail: string = wt.user_email
  const household: string = wt.household_id

  void db.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)

  // ── budget ────────────────────────────────────────────────────────────────
  // Fresh current-period stats + latest entries for ONE budget, so the Budget
  // widget doesn't sit on whatever the app last wrote to the App Group (another
  // member adding an entry would otherwise never show up until you open Money).
  // Mirrors the maths in src/apps/budget/Budgets.tsx exactly: entries dated in
  // the FUTURE are upcoming and excluded from income/spent — and from "latest",
  // so the list never disagrees with the balance above it.
  if (action === 'budget') {
    const { budgetId, day } = req.body ?? {}
    if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'Missing day' })
    }

    const [bRes, ccRes, coRes, bmRes] = await Promise.all([
      db
        .from('budgets')
        .select('id, name, period, visibility, owner_email')
        .eq('household_id', household)
        .order('created_at'),
      db.from('custom_categories').select('id, icon').eq('household_id', household),
      db.from('category_overrides').select('base_id, icon').eq('household_id', household),
      db.from('budget_members').select('budget_id').eq('email', senderEmail),
    ])

    // PRIVATE BUDGETS (migration 058): this runs with the SERVICE ROLE, which
    // bypasses RLS entirely — so the visibility rule has to be applied by hand
    // here, or a household member's widget would happily list someone else's
    // private budget. Mirrors public.can_see_budget().
    const shared = new Set((bmRes.data ?? []).map((r: any) => r.budget_id as string))
    const budgets = ((bRes.data ?? []) as {
      id: string
      name: string
      period: Period
      visibility: string
      owner_email: string | null
    }[]).filter(
      (x) => x.visibility !== 'private' || x.owner_email === senderEmail || shared.has(x.id),
    )
    if (!budgets.length) return res.status(200).json({ budget: null })
    const b = budgets.find((x) => x.id === budgetId) ?? budgets[0]

    // months/entries are scoped through their parent budget (no household_id).
    const mRes = await db
      .from('months')
      .select('id, start_date')
      .eq('budget_id', b.id)
      .order('start_date', { ascending: false })
    const months = (mRes.data ?? []) as { id: string; start_date: string }[]

    // The current period, else the newest — same rule as the Budgets screen.
    let monthId: string | null = null
    for (const m of months) {
      if (m.start_date <= day && day <= periodEndISO(b.period, m.start_date)) {
        monthId = m.id
        break
      }
    }
    monthId = monthId ?? months[0]?.id ?? null

    const base = { id: b.id, monthId, name: b.name, period: b.period, currency: '$' }
    if (!monthId) {
      return res
        .status(200)
        .json({ budget: { ...base, balance: 0, income: 0, spent: 0, entries: [] } })
    }

    const eRes = await db
      .from('entries')
      .select('type, amount, entry_date, label, category, created_at')
      .eq('month_id', monthId)
    const rows = (eRes.data ?? []) as {
      type: string
      amount: number
      entry_date: string
      label: string
      category: string
      created_at: string
    }[]

    let income = 0
    let spent = 0
    for (const e of rows) {
      if (e.entry_date > day) continue // upcoming — not yet counted
      if (e.type === 'income') income += Number(e.amount)
      else spent += Number(e.amount)
    }

    const custom = new Map((ccRes.data ?? []).map((c: any) => [c.id as string, c.icon as string]))
    const overrides = new Map(
      (coRes.data ?? []).map((o: any) => [o.base_id as string, (o.icon ?? null) as string | null]),
    )
    const entries = rows
      .filter((e) => e.entry_date <= day)
      .sort((x, y) =>
        x.entry_date !== y.entry_date
          ? x.entry_date < y.entry_date
            ? 1
            : -1
          : String(x.created_at) < String(y.created_at)
            ? 1
            : -1,
      )
      .slice(0, MAX_ENTRIES)
      .map((e) => ({
        emoji: categoryIcon(e.category, custom, overrides),
        label: e.label,
        amount: Number(e.amount),
        type: e.type,
      }))

    return res
      .status(200)
      .json({ budget: { ...base, balance: income - spent, income, spent, entries } })
  }

  // ── today ─────────────────────────────────────────────────────────────────
  // The CLIENT sends its own local `day` rather than us guessing a timezone.
  // Reuses the PWA's calendar/pet-care logic so the widget's agenda is computed
  // identically to the Hub's Today card — no second copy of the recurrence rules.
  if (action === 'today') {
    const { day, locale } = req.body ?? {}
    if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'Missing day' })
    }
    const loc = typeof locale === 'string' && locale ? locale : 'en-US'
    const lang = loc.split('-')[0]

    const [ev, pe, petRows] = await Promise.all([
      db.from('calendar_events').select('*').eq('household_id', household),
      // pet_events has no household_id (it's scoped through pets) — hence the
      // !inner join; the rows carry an extra `pets` key we don't need.
      db
        .from('pet_events')
        .select('*, pets!inner(household_id)')
        .eq('pets.household_id', household)
        .order('event_date', { ascending: false }),
      db.from('pets').select('id, name, emoji').eq('household_id', household),
    ])

    const events = (ev.data ?? []) as CalendarEvent[]
    const petEvents = (pe.data ?? []) as unknown as PetEvent[]
    const pets = (petRows.data ?? []) as { id: string; name: string; emoji: string }[]
    const petById = Object.fromEntries(pets.map((p) => [p.id, p]))

    // Mirrors TodaySection.tsx exactly: calendar occurrences first, then pet-care.
    const todaysOcc = [...(occurrencesInRange(events, day, day))].sort(
      compareOccurrences,
    )
    const petDue = overdueEvents(petEvents, day)

    const evItems = todaysOcc.map((o) => {
      const e = o.event
      const years = e.kind === 'birthday' || e.kind === 'anniversary' ? yearsAt(e, o.start) : 0
      const time = e.all_day ? null : e.start_time ? formatTime(e.start_time, loc) : null
      const subtitle =
        e.kind === 'birthday' && years > 0
          ? tr(lang, 'turns', { n: years })
          : e.kind === 'anniversary' && years > 0
            ? tr(lang, 'years', { n: years })
            : time
      return { emoji: KIND_EMOJI[e.kind] || '📅', title: e.title, subtitle: subtitle ?? null }
    })
    const petItems = petDue.map((e) => ({
      emoji: petById[e.pet_id]?.emoji || '🐾',
      title: e.title,
      subtitle: (e.next_due ?? '') < day ? tr(lang, 'overdue') : tr(lang, 'dueToday'),
    }))

    return res.status(200).json({ day, items: [...evItems, ...petItems].slice(0, MAX_ITEMS) })
  }

  // ── nudge ─────────────────────────────────────────────────────────────────
  if (action !== 'nudge') return res.status(400).json({ error: 'Unknown action' })

  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const { kind, emoji, message, recipients, high_priority } = req.body ?? {}
  if (!kind || !message) return res.status(400).json({ error: 'Missing fields' })
  const highPriority = high_priority === true

  // High-priority nudges always go to everyone (parity with the app).
  const targetList: string[] | null =
    highPriority || !Array.isArray(recipients) || recipients.length === 0
      ? null
      : recipients.filter((r: unknown) => typeof r === 'string')

  const { data: ping, error: insErr } = await db
    .from('pings')
    .insert({
      household_id: household,
      sender_email: senderEmail,
      kind,
      emoji: typeof emoji === 'string' && emoji ? emoji : '📣',
      message,
      recipients: targetList,
      high_priority: highPriority,
    })
    .select('id')
    .single()
  if (insErr || !ping) return res.status(500).json({ error: 'Could not send' })

  // Sender name + phone for the notification + Call affordance.
  const { data: sender } = await db
    .from('allowed_users')
    .select('display_name')
    .eq('email', senderEmail)
    .maybeSingle()
  const senderName = sender?.display_name || senderEmail.split('@')[0]
  const { data: senderProfile } = await db
    .from('member_profiles')
    .select('phone')
    .eq('email', senderEmail)
    .maybeSingle()
  const tel = senderProfile?.phone || null
  const title = `${emoji || '📣'} ${senderName}`

  // Web push (best-effort; skipped if VAPID isn't configured).
  if (vapidPublic && vapidPrivate) {
    let query = db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('household_id', household)
      .neq('user_email', senderEmail)
    if (targetList) query = query.in('user_email', targetList)
    const { data: subs } = await query
    webpush.setVapidDetails('mailto:arthurmunhoz@hotmail.com', vapidPublic, vapidPrivate)
    const payload = JSON.stringify({
      title,
      body: message,
      url: '/pings',
      tag: `ping-${ping.id}`,
      tel,
      urgent: highPriority,
    })
    const stale: string[] = []
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.endpoint)
      }
    }
    if (stale.length) await db.from('push_subscriptions').delete().in('endpoint', stale)
  }

  // Native (Expo) push.
  let expoQuery = db
    .from('expo_push_tokens')
    .select('token')
    .eq('household_id', household)
    .neq('user_email', senderEmail)
  if (targetList) expoQuery = expoQuery.in('user_email', targetList)
  const { data: expoTokens } = await expoQuery
  const expoSent = await sendExpoPush(
    (expoTokens ?? []).map((tk: any) => ({
      to: tk.token,
      title,
      body: message,
      data: { url: '/pings', tel },
      sound: 'default' as const,
    })),
  )

  return res.status(200).json({ ok: true, ping: ping.id, expoSent })
}
