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

type Pet = { id: string; name: string; emoji: string; household_id: string }
type PetEvent = {
  pet_id: string
  type: string
  title: string
  event_date: string
  next_due: string | null
}
type ImportantDate = {
  household_id: string
  title: string
  type: string
  event_date: string
  repeats_annually: boolean
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
  other: '📅',
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

/** Next occurrence of an important date: the date itself for one-offs, or the
 *  next month/day rollover for things that repeat every year. */
function nextOccurrence(d: ImportantDate, today: string): string {
  if (!d.repeats_annually) return d.event_date
  const [, mm, dd] = d.event_date.split('-')
  const year = Number(today.slice(0, 4))
  const thisYear = `${year}-${mm}-${dd}`
  return thisYear >= today ? thisYear : `${year + 1}-${mm}-${dd}`
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
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: 'Digest is not configured (missing env).' })
  }

  webpush.setVapidDetails('mailto:arthur@peek.us', vapidPublic, vapidPrivate)
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const today = todayUTC()

  // Pull everything once, then group in memory (the data set is tiny).
  const [petsRes, eventsRes, datesRes, subsRes, settingsRes] = await Promise.all([
    db.from('pets').select('id, name, emoji, household_id'),
    db
      .from('pet_events')
      .select('pet_id, type, title, event_date, next_due')
      .not('next_due', 'is', null)
      .order('event_date', { ascending: false }),
    db
      .from('important_dates')
      .select('household_id, title, type, event_date, repeats_annually'),
    db.from('push_subscriptions').select('endpoint, p256dh, auth, household_id, user_email'),
    db.from('user_settings').select('email, language'),
  ])

  const pets = (petsRes.data ?? []) as Pet[]
  const events = (eventsRes.data ?? []) as PetEvent[]
  const dates = (datesRes.data ?? []) as ImportantDate[]
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
    const occ = nextOccurrence(d, today)
    const days = daysBetween(today, occ)
    if (!DATE_LEAD_DAYS.includes(days)) continue
    const list = dateRemindersByHousehold.get(d.household_id) ?? []
    list.push({ icon: DATE_ICON[d.type] ?? '📅', title: d.title, days })
    dateRemindersByHousehold.set(d.household_id, list)
  }

  let sent = 0
  let households = 0
  const stale: string[] = []

  for (const [householdId, householdSubs] of subsByHousehold) {
    const petR = petRemindersByHousehold.get(householdId) ?? []
    const dateR = dateRemindersByHousehold.get(householdId) ?? []
    if (petR.length + dateR.length === 0) continue
    households++

    // Deep-link to the most relevant screen (same for everyone in the household).
    const link = petR.length && dateR.length ? '/' : petR.length ? '/pets' : '/dates'

    for (const s of householdSubs) {
      const L = I18N[langByEmail.get(s.user_email) ?? 'en']
      const petLines = petR.map((r) => `${r.icon} ${r.name} — ${r.title} (${L.petLabel(r.days)})`)
      const dateLines = dateR.map((r) => `${r.icon} ${r.title} (${L.dateLabel(r.days)})`)
      const lines = [...petLines, ...dateLines]
      const title = lines.length === 1 ? '🏠 One Roof' : `🏠 ${L.remindersTitle(lines.length)}`
      const payload = JSON.stringify({
        title,
        body: lines.join('\n'),
        url: link,
        tag: 'one-roof-digest',
      })
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
  }

  if (stale.length) {
    await db.from('push_subscriptions').delete().in('endpoint', stale)
  }

  return res.status(200).json({ ok: true, households, sent, pruned: stale.length })
}
