// Vercel Cron target: once a day it pushes each household a single "morning
// digest" notification covering pet-care items that are due/overdue (event
// reminders AND every-N-days routines) and important dates coming up.
// Triggered by the cron entry in vercel.json. A digest with pet items links to
// '/pets?overdue=1', which opens the app's overdue sheet (Done on each item).
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
  /** ANDROID ONLY: routes the notification to a channel we created on the device.
   *  Without it Android drops the digest into an OS-named default channel the
   *  user can't recognise in Settings. Must match ANDROID_CHANNEL in
   *  mobile/src/lib/notifications.ts. */
  channelId?: 'household' | 'urgent'
}

// Best-effort Expo (native) push, sent alongside web-push. Errors swallowed so
// a push failure never breaks the digest. Only well-formed Expo tokens are sent.
/** Ticket errors that mean the token is permanently unusable. Anything else
 *  (rate limits, a message too big) is transient or our fault, not the token's,
 *  so it must NOT cost the user their registration. */
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials'])
/** Receipts are not instant. Wait once, read what is ready, and leave the rest —
 *  the next send gets another chance, so the token list still heals. */
const RECEIPT_DELAY_MS = 2000
/** getReceipts takes at most 1000 ids per call; stay well under. */
const RECEIPT_CHUNK = 300

interface Ticket {
  status?: string
  id?: string
  details?: { error?: string }
}

interface Receipt {
  status?: string
  details?: { error?: string }
}

/** ticket id -> the error its receipt reported. Absent means ok OR not ready
 *  yet; the two are deliberately not distinguished, because both mean "do
 *  nothing". See api/send-ping.ts for why receipts matter at all: exp.host
 *  answers a send with a ticket that says `ok` even for a device that can
 *  receive nothing — DeviceNotRegistered only ever shows up in the receipt. */
async function fetchReceiptErrors(ticketIds: string[]): Promise<Map<string, string>> {
  const errors = new Map<string, string>()
  if (!ticketIds.length) return errors
  await new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS))

  for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: ticketIds.slice(i, i + RECEIPT_CHUNK) }),
      })
      if (!r.ok) continue
      const body = (await r.json().catch(() => null)) as { data?: Record<string, Receipt> } | null
      for (const [id, receipt] of Object.entries(body?.data ?? {})) {
        if (receipt?.status === 'error') errors.set(id, receipt?.details?.error ?? 'Unknown')
      }
    } catch {
      // A receipt we could not read is not evidence of anything — leave it.
    }
  }
  return errors
}

/** Delete tokens Expo told us are permanently unusable. */
function pruneDeadTokens(db: any) {
  return async (tokens: string[]) => {
    await db.from('expo_push_tokens').delete().in('token', tokens)
  }
}

async function sendExpoPush(
  messages: ExpoMessage[],
  /** Called with tokens Expo says are permanently unusable, so they can be
   *  deleted. Optional so a caller with no database handle can still send. */
  onDeadTokens?: (tokens: string[]) => Promise<void>,
): Promise<number> {
  const valid = messages.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'),
  )
  let sent = 0
  const dead: string[] = []
  /** Accepted ticket id -> the token it was for, so a receipt can be traced
   *  back to the registration that has to be pruned. */
  const pending = new Map<string, string>()
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      })
      // HTTP 200 means Expo took the batch, NOT that any message was accepted:
      // the per-message outcome is in `tickets`. `if (r.ok) sent += chunk.length`
      // counted dead tokens as delivered and never pruned them.
      if (!r.ok) continue
      const body = (await r.json().catch(() => null)) as { data?: Ticket[] } | null
      const tickets = body?.data
      if (!Array.isArray(tickets)) continue
      tickets.forEach((ticket, idx) => {
        const tok = chunk[idx]?.to
        if (ticket?.status === 'ok') {
          sent += 1
          // Provisionally sent. The receipt below is what settles it.
          if (ticket.id && tok) pending.set(ticket.id, tok)
          return
        }
        const err = ticket?.details?.error
        if (tok && err && DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
      })
    } catch {
      /* swallow */
    }
  }

  // A ticket only says Expo took the message. Drop every send the receipt
  // rejects, and prune the tokens that failed permanently.
  for (const [id, err] of await fetchReceiptErrors(Array.from(pending.keys()))) {
    const tok = pending.get(id)
    if (!tok) continue
    sent -= 1
    if (DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
  }
  if (dead.length && onDeadTokens) {
    // Pruning is best-effort: failing to clean up must never fail a send.
    await onDeadTokens(Array.from(new Set(dead))).catch(() => {})
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
type PetTask = { id: string; pet_id: string; title: string; icon: string; interval_days: number | null }
type PetTaskDone = { task_id: string; done_on: string }
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
// Routine icons (mobile/src/apps/pets/petUi.tsx CARE_ICONS ids).
const TASK_ICON: Record<string, string> = {
  bowl: '🦴',
  walk: '🐾',
  treat: '🍪',
  pill: '💊',
  bath: '🛁',
  nails: '✂️',
  teeth: '🦷',
  paw: '🐾',
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

/** Latest event per (pet, title) — re-logging a treatment retires the previous
 *  due date. Same rule as mobile/src/lib/petCare.ts latestPerKey: type is NOT in
 *  the key (one treatment gets saved as a vaccine once and a medication the
 *  next) and titles match ignoring case and whitespace runs. Events must arrive
 *  newest-first. */
function latestPerKey(events: PetEvent[]): PetEvent[] {
  const seen = new Set<string>()
  const out: PetEvent[] = []
  for (const e of events) {
    const key = `${e.pet_id}|${e.title.trim().replace(/\s+/g, ' ').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

// ?action=doc-thumb — a picture of a PDF document's first page (owner,
// 2026-11-13: a PDF picked from Files had no thumbnail, only a placeholder —
// the phones have no PDF renderer). Called by the app after a PDF upload and
// to backfill older PDFs. Runs entirely as the CALLER (their JWT): RLS decides
// whether they can see the documents row and read the file, and the storage
// policy whether they can write under that household's prefix — no service
// role. Writes the same two objects the phone writes for an image:
// <household>/thumbs/<uuid>.jpg (320 px) and <household>/previews/<uuid>.jpg
// (1240 px). Lives here only because Hobby caps us at 12 functions; the
// renderer (pdfjs + @napi-rs/canvas) is imported lazily so the cron path
// never loads it.
async function docThumb(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const jwt = String(req.headers?.authorization ?? '').replace(/^Bearer /, '')
  if (!url || !anon || !jwt) return res.status(401).json({ error: 'auth' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const path = String(body.path ?? '')
  const m = /^([0-9a-f-]{36})\/(?:.+\/)?([^/]+)\.pdf$/i.exec(path)
  if (!m) return res.status(400).json({ error: 'path' })
  const db = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: row } = await db.from('documents').select('id').eq('file_path', path).maybeSingle()
  if (!row) return res.status(404).json({ error: 'not_found' })
  const { data: file, error: dlErr } = await db.storage.from('documents').download(path)
  if (dlErr || !file) return res.status(404).json({ error: 'not_found' })
  if (file.size > 20 * 1024 * 1024) return res.status(413).json({ error: 'too_big' })

  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    // Import the worker up front so the bundler ships it (pdfjs otherwise
    // loads it by a path the file tracer can't see).
    // @ts-expect-error -- the worker ships no type declarations
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as any).pdfjsWorker = worker
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const render = async (width: number, quality: number) => {
      const vp = page.getViewport({ scale: width / base.width })
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
      return canvas.encode('jpeg', quality)
    }
    const household = m[1]
    const name = m[2]
    const opts = { contentType: 'image/jpeg', cacheControl: '604800', upsert: true }
    const preview = await render(1240, 72)
    const thumb = await render(320, 60)
    const up = await Promise.all([
      db.storage.from('documents').upload(`${household}/thumbs/${name}.jpg`, thumb, opts),
      db.storage.from('documents').upload(`${household}/previews/${name}.jpg`, preview, opts),
    ])
    await doc.destroy()
    if (up.some((u) => u.error)) return res.status(500).json({ error: 'upload' })
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('doc-thumb', e)
    return res.status(422).json({ error: 'render' })
  }
}

/** Hand-drawn notes (migrations 112/113): a note nobody kept with a heart is
 *  deleted NOTE_KEEP_DAYS after it was sent, in households WITHOUT Plus — the
 *  row and its PNG. Plus households keep everything. Capped per run; the next
 *  day picks up the rest. Any doubt (a failed lookup) keeps the note. */
const NOTE_KEEP_DAYS = 30
async function purgeOldNotes(db: any): Promise<number> {
  const cutoff = new Date(Date.now() - NOTE_KEEP_DAYS * 86_400_000).toISOString()
  const { data: old, error } = await db
    .from('pings')
    .select('id, household_id, image_path')
    .not('image_path', 'is', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(300)
  if (error || !old?.length) return 0
  const rows = old as { id: string; household_id: string; image_path: string }[]

  const { data: favs, error: favErr } = await db
    .from('note_favorites')
    .select('ping_id')
    .in('ping_id', rows.map((r) => r.id))
  if (favErr) return 0 // table missing or unreadable: keep everything
  const kept = new Set(((favs ?? []) as { ping_id: string }[]).map((f) => f.ping_id))

  const plus = new Map<string, boolean>()
  for (const hh of new Set(rows.map((r) => r.household_id))) {
    const { data, error: plusErr } = await db.rpc('household_is_plus', { p_household: hh })
    plus.set(hh, plusErr ? true : data === true) // unknown counts as Plus: keep
  }

  // The path must be the note's own (the CHECK guarantees it; belt and braces
  // before a storage delete).
  const gone = rows.filter(
    (r) => !kept.has(r.id) && plus.get(r.household_id) === false && r.image_path.startsWith(`${r.household_id}/notes/`),
  )
  if (!gone.length) return 0
  const { error: delErr } = await db.from('pings').delete().in('id', gone.map((r) => r.id))
  if (delErr) return 0
  await db.storage.from('documents').remove(gone.map((r) => r.image_path))
  return gone.length
}

export default async function handler(req: any, res: any) {
  if (String(req.query?.action ?? '') === 'doc-thumb') return docThumb(req, res)
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
  const [petsRes, eventsRes, tasksRes, doneRes, datesRes, subsRes, settingsRes, expoRes] = await Promise.all([
    db.from('pets').select('id, name, emoji, household_id'),
    db
      .from('pet_events')
      .select('pet_id, type, title, event_date, next_due')
      // ALL events, not just those with a next_due: the latest log of a
      // treatment decides whether it's still due, and a final dose logged with
      // no next date must retire the series. Filtering here hid that dose and
      // kept pushing the previous one's stale reminder.
      .order('event_date', { ascending: false }),
    // Every-N-days routines (bath, nails…). Due = latest completion + interval;
    // 400 days of completions covers the longest sane (yearly) interval.
    db.from('pet_care_tasks').select('id, pet_id, title, icon, interval_days').eq('kind', 'interval'),
    db.from('pet_task_done').select('task_id, done_on').gte('done_on', addDaysUTC(today, -400)),
    db
      .from('calendar_events')
      .select('household_id, title, kind, start_date, recurrence, reminder_minutes'),
    db.from('push_subscriptions').select('endpoint, p256dh, auth, household_id, user_email'),
    db.from('user_settings').select('email, language'),
    db.from('expo_push_tokens').select('token, household_id, user_email'),
  ])
  // Who is in which household (several per person since migration 099).
  // Registrations are per PERSON, stamped with whichever household is active,
  // so the digest is addressed by membership, not by the token's household_id.
  // Before 099 is applied this falls back to allowed_users (one each).
  const [membersRes, householdsRes] = await Promise.all([
    db.from('household_members').select('household_id, email'),
    db.from('households').select('id, name'),
  ])
  let memberships = (membersRes.data ?? []) as { household_id: string; email: string }[]
  if (membersRes.error) {
    const { data: legacy } = await db.from('allowed_users').select('household_id, email')
    memberships = (legacy ?? []) as { household_id: string; email: string }[]
  }
  const householdNameById = new Map<string, string>(
    ((householdsRes.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h.name]),
  )

  const pets = (petsRes.data ?? []) as Pet[]
  const events = (eventsRes.data ?? []) as PetEvent[]
  const tasks = (tasksRes.data ?? []) as PetTask[]
  const lastDone = new Map<string, string>()
  for (const d of (doneRes.data ?? []) as PetTaskDone[]) {
    const prev = lastDone.get(d.task_id)
    if (!prev || d.done_on > prev) lastDone.set(d.task_id, d.done_on)
  }
  const dates = (datesRes.data ?? []) as CalEvent[]
  const subs = (subsRes.data ?? []) as Subscription[]
  // Each recipient gets the digest in their own chosen language (default en).
  const settings = (settingsRes.data ?? []) as { email: string; language: string | null }[]
  const langByEmail = new Map<string, Lang>(settings.map((r) => [r.email, langOf(r.language)]))

  const petById = new Map(pets.map((p) => [p.id, p]))

  // Every member of a household gets the same shared digest (pets and dates
  // are household-wide) on each of their devices. Someone in several
  // households gets one digest PER household, titled with its name.
  const membersByHousehold = new Map<string, string[]>()
  const householdCount = new Map<string, number>()
  for (const m of memberships) {
    const list = membersByHousehold.get(m.household_id) ?? []
    list.push(m.email)
    membersByHousehold.set(m.household_id, list)
    householdCount.set(m.email, (householdCount.get(m.email) ?? 0) + 1)
  }
  const subsByEmail = new Map<string, Subscription[]>()
  for (const s of subs) {
    const list = subsByEmail.get(s.user_email) ?? []
    list.push(s)
    subsByEmail.set(s.user_email, list)
  }
  type ExpoTok = { token: string; household_id: string; user_email: string }
  const expoByEmail = new Map<string, ExpoTok[]>()
  for (const t of (expoRes.data ?? []) as ExpoTok[]) {
    const list = expoByEmail.get(t.user_email) ?? []
    list.push(t)
    expoByEmail.set(t.user_email, list)
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
  // Routines due today or overdue. Same rule as the app (routineStatus): a
  // routine that was never completed has no due date yet, so it's left out
  // rather than announced as due on day one.
  for (const task of tasks) {
    const last = lastDone.get(task.id)
    const pet = petById.get(task.pet_id)
    if (!last || !pet || !task.interval_days) continue
    const days = daysBetween(today, addDaysUTC(last, task.interval_days))
    if (days > 0) continue
    const list = petRemindersByHousehold.get(pet.household_id) ?? []
    list.push({ icon: TASK_ICON[task.icon] ?? '🐾', name: pet.name, title: task.title, days })
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
    // Pet items win: '/pets?overdue=1' opens the overdue sheet, where each one
    // can be marked done from the notification tap. Builds that predate the
    // sheet ignore the query and just open Pet Care.
    const link = petR.length ? '/pets?overdue=1' : '/calendar'

    const members = membersByHousehold.get(householdId) ?? []
    const hhName = householdNameById.get(householdId) ?? null
    const isMulti = (email: string) => (householdCount.get(email) ?? 0) > 1

    // Build the digest title/body in a given recipient's language. For someone
    // in several households the title names this one ("🏠 Souza · 2 reminders").
    const build = (email: string) => {
      const L = I18N[langByEmail.get(email) ?? 'en']
      const petLines = petR.map((r) => `${r.icon} ${r.name} — ${r.title} (${L.petLabel(r.days)})`)
      const dateLines = dateR.map((r) => `${r.icon} ${r.title} (${L.dateLabel(r.days)})`)
      const lines = [...petLines, ...dateLines]
      const multi = isMulti(email) && !!hhName
      const title =
        lines.length === 1
          ? multi ? `🏠 ${hhName}` : '🏠 One Roof'
          : multi ? `🏠 ${hhName} · ${L.remindersTitle(lines.length)}` : `🏠 ${L.remindersTitle(lines.length)}`
      return { title, body: lines.join('\n') }
    }

    // Web push
    for (const s of members.flatMap((e) => subsByEmail.get(e) ?? [])) {
      const { title, body } = build(s.user_email)
      // One tag per household for multi-household people, or the second
      // digest would REPLACE the first on the lock screen.
      const tag = isMulti(s.user_email) ? `one-roof-digest-${householdId}` : 'one-roof-digest'
      const payload = JSON.stringify({ title, body, url: link, tag })
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
    const expoMsgs: ExpoMessage[] = members.flatMap((e) => expoByEmail.get(e) ?? []).map((t) => {
      const { title, body } = build(t.user_email)
      return {
        to: t.token,
        title,
        body,
        // `household` lets a tap switch the app to the household it's about.
        data: { url: link, household: householdId },
        sound: 'default' as const,
        channelId: 'household' as const,
      }
    })
    expoSent += await sendExpoPush(expoMsgs, pruneDeadTokens(db))
  }

  if (stale.length) {
    await db.from('push_subscriptions').delete().in('endpoint', stale)
  }

  // Housekeeping rides on the daily cron (Hobby: one cron, 12 functions).
  let notesPurged = 0
  try {
    notesPurged = await purgeOldNotes(db)
  } catch {
    /* never fail the digest over housekeeping */
  }

  return res.status(200).json({ ok: true, households, sent, expoSent, pruned: stale.length, notesPurged })
}
