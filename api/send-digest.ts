// Vercel Cron target: once a day it pushes each household a single "morning
// digest" notification covering pet-care items that are due/overdue and
// important dates coming up. Triggered by the cron entry in vercel.json.
//
// Env required (Vercel project settings):
//   CRON_SECRET               — Vercel sends it as `Authorization: Bearer …`;
//                               we reject anything else so the route isn't public
//   VITE_SUPABASE_URL         — already set (reused from the client)
//   SUPABASE_SERVICE_ROLE_KEY — server-only; bypasses RLS to read every household
//   VITE_VAPID_PUBLIC_KEY     — already set (reused from the client)
//   VAPID_PRIVATE_KEY         — server-only secret, pairs with the public key
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { timingSafeEqual } from 'node:crypto'

/** Constant-time string compare for shared secrets (length is not secret). */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

type ExpoMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
}

// Best-effort Expo (native) push, sent alongside web-push. Errors swallowed so
// a push failure never breaks the digest. Only well-formed Expo tokens are sent.
async function sendExpoPush(messages: ExpoMessage[]): Promise<number> {
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

type Pet = { id: string; name: string; emoji: string; household_id: string }
type PetEvent = {
  pet_id: string
  type: string
  title: string
  event_date: string
  next_due: string | null
}
type CalEvent = {
  household_id: string
  title: string
  kind: string
  start_date: string
  recurrence: string
  reminder_minutes: number | null
}
type Subscription = {
  endpoint: string
  p256dh: string
  auth: string
  household_id: string
  user_email: string
}

type Lang = 'en' | 'es' | 'pt'

// Per-language label builders for the digest — content (pet/date names) stays
// as the user typed it; only the surrounding wording is translated. Mirrors the
// app's own i18n vocabulary.
const I18N: Record<
  Lang,
  {
    petLabel: (days: number) => string
    dateLabel: (days: number) => string
    remindersTitle: (n: number) => string
  }
> = {
  en: {
    petLabel: (d) => (d < 0 ? `overdue ${-d}d` : d === 0 ? 'due today' : `in ${d}d`),
    dateLabel: (d) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`),
    remindersTitle: (n) => `${n} reminders today`,
  },
  es: {
    petLabel: (d) => (d < 0 ? `atrasado ${-d}d` : d === 0 ? 'para hoy' : `en ${d}d`),
    dateLabel: (d) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d}d`),
    remindersTitle: (n) => `${n} recordatorios hoy`,
  },
  pt: {
    petLabel: (d) => (d < 0 ? `atrasado ${-d}d` : d === 0 ? 'para hoje' : `em ${d}d`),
    dateLabel: (d) => (d === 0 ? 'hoje' : d === 1 ? 'amanhã' : `em ${d}d`),
    remindersTitle: (n) => `${n} lembretes hoje`,
  },
}

function langOf(v: unknown): Lang {
  return v === 'es' || v === 'pt' ? v : 'en'
}

const TYPE_ICON: Record<string, string> = {
  vet: '🩺',
  vaccine: '💉',
  medication: '💊',
  grooming: '✂️',
  other: '📝',
}
const DATE_ICON: Record<string, string> = {
  birthday: '🎂',
  anniversary: '💍',
  renewal: '🔁',
  other: '📌',
  event: '📅',
}

// Heads-up cadence for important dates: day-of, the day before, a week out.
const DATE_LEAD_DAYS = [0, 1, 7]

const MS_PER_DAY = 86_400_000

/** UTC date as YYYY-MM-DD. The cron fires ~8am Brazil / ~7am US, where the UTC
 *  date already matches the family's local date, so UTC "today" is correct. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`)
  const b = Date.parse(`${toISO}T00:00:00Z`)
  return Math.round((b - a) / MS_PER_DAY)
}

const pad = (n: number) => String(n).padStart(2, '0')
function addDaysUTC(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10)
}
function addMonthsUTC(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}
/** Next occurrence (>= today) of an event given its recurrence; the start date
 *  itself for one-offs (which may be in the past). */
function nextOcc(startISO: string, recurrence: string, today: string): string {
  if (recurrence === 'none' || startISO >= today) return startISO
  if (recurrence === 'daily') return today
  if (recurrence === 'weekly') {
    const rem = daysBetween(startISO, today) % 7
    return rem === 0 ? today : addDaysUTC(today, 7 - rem)
  }
  let cur = startISO
  let guard = 0
  while (cur < today && guard++ < 1000) {
    cur = recurrence === 'monthly' ? addMonthsUTC(cur, 1) : addMonthsUTC(cur, 12)
  }
  return cur
}

/** Latest event per (pet, type, title) — re-logging a treatment retires the
 *  previous due date. Events must arrive newest-first. */
function latestPerKey(events: PetEvent[]): PetEvent[] {
  const seen = new Set<string>()
  const out: PetEvent[] = []
  for (const e of events) {
    const key = `${e.pet_id}|${e.type}|${e.title.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

export default async function handler(req: any, res: any) {
  // Only Vercel Cron (which sends the secret) may run this.
  const secret = process.env.CRON_SECRET
  // Unset secret still fails closed; the compare itself is constant-time.
  if (!secret || !secretEquals(String(req.headers.authorization ?? ''), `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: 'Digest is not configured (missing env).' })
  }

  webpush.setVapidDetails('mailto:one.roof.family.organizer@gmail.com', vapidPublic, vapidPrivate)
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const today = todayUTC()

  // Pull everything once, then group in memory (the data set is tiny).
  const [petsRes, eventsRes, datesRes, subsRes, settingsRes, expoRes] = await Promise.all([
    db.from('pets').select('id, name, emoji, household_id'),
    db
      .from('pet_events')
      .select('pet_id, type, title, event_date, next_due')
      .not('next_due', 'is', null)
      .order('event_date', { ascending: false }),
    db
      .from('calendar_events')
      .select('household_id, title, kind, start_date, recurrence, reminder_minutes'),
    db.from('push_subscriptions').select('endpoint, p256dh, auth, household_id, user_email'),
    db.from('user_settings').select('email, language'),
    db.from('expo_push_tokens').select('token, household_id, user_email'),
  ])

  const pets = (petsRes.data ?? []) as Pet[]
  const events = (eventsRes.data ?? []) as PetEvent[]
  const dates = (datesRes.data ?? []) as CalEvent[]
  const subs = (subsRes.data ?? []) as Subscription[]
  // Each recipient gets the digest in their own chosen language (default en).
  const settings = (settingsRes.data ?? []) as { email: string; language: string | null }[]
  const langByEmail = new Map<string, Lang>(settings.map((r) => [r.email, langOf(r.language)]))

  const petById = new Map(pets.map((p) => [p.id, p]))

  // Group subscriptions by household — every member of a household gets the
  // same shared digest (pets and dates are household-wide).
  const subsByHousehold = new Map<string, Subscription[]>()
  for (const s of subs) {
    const list = subsByHousehold.get(s.household_id) ?? []
    list.push(s)
    subsByHousehold.set(s.household_id, list)
  }

  // Native (Expo) push tokens grouped by household, same shape as web subs.
  type ExpoTok = { token: string; household_id: string; user_email: string }
  const expoByHousehold = new Map<string, ExpoTok[]>()
  for (const t of (expoRes.data ?? []) as ExpoTok[]) {
    const list = expoByHousehold.get(t.household_id) ?? []
    list.push(t)
    expoByHousehold.set(t.household_id, list)
  }

  // Pet reminders due today or overdue, keyed by household. Stored as data so
  // each line can be rendered in the recipient's language at send time.
  type PetReminder = { icon: string; name: string; title: string; days: number }
  type DateReminder = { icon: string; title: string; days: number }
  const petRemindersByHousehold = new Map<string, PetReminder[]>()
  const dueEvents = latestPerKey(events).filter(
    (e) => e.next_due && e.next_due <= today,
  )
  for (const e of dueEvents) {
    const pet = petById.get(e.pet_id)
    if (!pet) continue
    const days = daysBetween(today, e.next_due!)
    const list = petRemindersByHousehold.get(pet.household_id) ?? []
    list.push({ icon: TYPE_ICON[e.type] ?? '📝', name: pet.name, title: e.title, days })
    petRemindersByHousehold.set(pet.household_id, list)
  }

  // Important-date reminders at the lead-day marks, keyed by household.
  const dateRemindersByHousehold = new Map<string, DateReminder[]>()
  for (const d of dates) {
    const occ = nextOcc(d.start_date, d.recurrence, today)
    const days = daysBetween(today, occ)
    // Special dates (birthdays, anniversaries, renewals) remind at 7d/1d/day-of;
    // plain events only if they carry a reminder and land today.
    const special = !!d.kind && d.kind !== 'event'
    const include = special
      ? DATE_LEAD_DAYS.includes(days)
      : d.reminder_minutes != null && days === 0
    if (!include) continue
    const list = dateRemindersByHousehold.get(d.household_id) ?? []
    list.push({ icon: DATE_ICON[d.kind] ?? '📅', title: d.title, days })
    dateRemindersByHousehold.set(d.household_id, list)
  }

  let sent = 0
  let expoSent = 0
  let households = 0
  const stale: string[] = []

  // Iterate every household that has reminders — covers households with web
  // subscriptions, native (Expo) tokens, or both.
  const householdIds = new Set<string>([
    ...petRemindersByHousehold.keys(),
    ...dateRemindersByHousehold.keys(),
  ])
  for (const householdId of householdIds) {
    const petR = petRemindersByHousehold.get(householdId) ?? []
    const dateR = dateRemindersByHousehold.get(householdId) ?? []
    if (petR.length + dateR.length === 0) continue
    households++

    // Deep-link to the most relevant screen (same for everyone in the household).
    const link = petR.length && dateR.length ? '/' : petR.length ? '/pets' : '/calendar'

    // Build the digest title/body in a given recipient's language.
    const build = (email: string) => {
      const L = I18N[langByEmail.get(email) ?? 'en']
      const petLines = petR.map((r) => `${r.icon} ${r.name} — ${r.title} (${L.petLabel(r.days)})`)
      const dateLines = dateR.map((r) => `${r.icon} ${r.title} (${L.dateLabel(r.days)})`)
      const lines = [...petLines, ...dateLines]
      const title = lines.length === 1 ? '🏠 One Roof' : `🏠 ${L.remindersTitle(lines.length)}`
      return { title, body: lines.join('\n') }
    }

    // Web push
    for (const s of subsByHousehold.get(householdId) ?? []) {
      const { title, body } = build(s.user_email)
      const payload = JSON.stringify({ title, body, url: link, tag: 'one-roof-digest' })
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (err: any) {
        // 404/410 = the browser dropped this subscription; prune it.
        if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.endpoint)
      }
    }

    // Native (Expo) push
    const expoMsgs: ExpoMessage[] = (expoByHousehold.get(householdId) ?? []).map((t) => {
      const { title, body } = build(t.user_email)
      return { to: t.token, title, body, data: { url: link }, sound: 'default' as const }
    })
    expoSent += await sendExpoPush(expoMsgs)
  }

  if (stale.length) {
    await db.from('push_subscriptions').delete().in('endpoint', stale)
  }

  return res.status(200).json({ ok: true, households, sent, expoSent, pruned: stale.length })
}
