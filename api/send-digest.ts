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

function overdueLabel(days: number): string {
  if (days < 0) return `overdue ${-days}d`
  if (days === 0) return 'due today'
  return `in ${days}d`
}

function dueLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days}d`
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
  const [petsRes, eventsRes, datesRes, subsRes] = await Promise.all([
    db.from('pets').select('id, name, emoji, household_id'),
    db
      .from('pet_events')
      .select('pet_id, type, title, event_date, next_due')
      .not('next_due', 'is', null)
      .order('event_date', { ascending: false }),
    db
      .from('important_dates')
      .select('household_id, title, type, event_date, repeats_annually'),
    db.from('push_subscriptions').select('endpoint, p256dh, auth, household_id'),
  ])

  const pets = (petsRes.data ?? []) as Pet[]
  const events = (eventsRes.data ?? []) as PetEvent[]
  const dates = (datesRes.data ?? []) as ImportantDate[]
  const subs = (subsRes.data ?? []) as Subscription[]

  const petById = new Map(pets.map((p) => [p.id, p]))

  // Group subscriptions by household — every member of a household gets the
  // same shared digest (pets and dates are household-wide).
  const subsByHousehold = new Map<string, Subscription[]>()
  for (const s of subs) {
    const list = subsByHousehold.get(s.household_id) ?? []
    list.push(s)
    subsByHousehold.set(s.household_id, list)
  }

  // Pet reminders due today or overdue, keyed by household.
  const petLinesByHousehold = new Map<string, string[]>()
  const dueEvents = latestPerKey(events).filter(
    (e) => e.next_due && e.next_due <= today,
  )
  for (const e of dueEvents) {
    const pet = petById.get(e.pet_id)
    if (!pet) continue
    const days = daysBetween(today, e.next_due!)
    const line = `${TYPE_ICON[e.type] ?? '📝'} ${pet.name} — ${e.title} (${overdueLabel(days)})`
    const list = petLinesByHousehold.get(pet.household_id) ?? []
    list.push(line)
    petLinesByHousehold.set(pet.household_id, list)
  }

  // Important-date reminders at the lead-day marks, keyed by household.
  const dateLinesByHousehold = new Map<string, string[]>()
  for (const d of dates) {
    const occ = nextOccurrence(d, today)
    const days = daysBetween(today, occ)
    if (!DATE_LEAD_DAYS.includes(days)) continue
    const line = `${DATE_ICON[d.type] ?? '📅'} ${d.title} (${dueLabel(days)})`
    const list = dateLinesByHousehold.get(d.household_id) ?? []
    list.push(line)
    dateLinesByHousehold.set(d.household_id, list)
  }

  let sent = 0
  let households = 0
  const stale: string[] = []

  for (const [householdId, householdSubs] of subsByHousehold) {
    const petLines = petLinesByHousehold.get(householdId) ?? []
    const dateLines = dateLinesByHousehold.get(householdId) ?? []
    const lines = [...petLines, ...dateLines]
    if (lines.length === 0) continue
    households++

    const title =
      lines.length === 1 ? '🏠 One Roof' : `🏠 ${lines.length} reminders today`
    const body = lines.join('\n')
    // Deep-link to the most relevant screen.
    const link = petLines.length && dateLines.length ? '/' : petLines.length ? '/pets' : '/dates'
    const payload = JSON.stringify({ title, body, url: link, tag: 'one-roof-digest' })

    for (const s of householdSubs) {
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
