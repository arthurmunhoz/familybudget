// Vercel function: two-way sync between One Roof's calendar_events and each
// linked Google Calendar. Two callers:
//   • Vercel Cron (Authorization: Bearer CRON_SECRET) → syncs every connection.
//   • A signed-in user (Supabase JWT) → syncs only their own connection.
//
// Per connection we PUSH first, then PULL:
//   PUSH  One Roof events the connecting user created (source='oneroof',
//         created_by = user) → Google: create/update by google_event_id, and
//         delete anything in calendar_deletions. Timed events use the calendar's
//         time zone; simple recurrence maps to an RRULE.
//   PULL  Google events → calendar_events (source='google', owner_email = the
//         connecting user so they show in that member's color), within a
//         -30d..+180d window, pruning events removed from Google. Our own pushed
//         events (and their recurring instances) are skipped to avoid echo.
//
// Env (Vercel): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET.
import { createClient } from '@supabase/supabase-js'

type Conn = {
  user_email: string
  household_id: string
  access_token: string | null
  refresh_token: string
  token_expiry: string | null
  calendar_id: string
  time_zone: string | null
}

const MS_PER_DAY = 86_400_000
const API = 'https://www.googleapis.com/calendar/v3'
const enc = encodeURIComponent

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDaysISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10)
}

// --- Google event ⇄ our row mapping -----------------------------------------

type Mapped = {
  google_event_id: string
  title: string
  start_date: string
  end_date: string
  all_day: boolean
  start_time: string | null
  end_time: string | null
  location: string | null
  notes: string | null
}

function mapFromGoogle(item: any): Mapped {
  const allDay = !!item.start?.date
  let start_date: string
  let end_date: string
  let start_time: string | null = null
  let end_time: string | null = null
  if (allDay) {
    start_date = item.start.date
    end_date = item.end?.date ? addDaysISO(item.end.date, -1) : start_date // end.date is exclusive
    if (end_date < start_date) end_date = start_date
  } else {
    const sdt: string = item.start.dateTime
    const edt: string | undefined = item.end?.dateTime
    start_date = sdt.slice(0, 10)
    start_time = sdt.slice(11, 19)
    end_date = edt ? edt.slice(0, 10) : start_date
    end_time = edt ? edt.slice(11, 19) : null
  }
  return {
    google_event_id: item.id,
    title: item.summary || '(no title)',
    start_date,
    end_date,
    all_day: allDay,
    start_time,
    end_time,
    location: item.location ?? null,
    notes: item.description ?? null,
  }
}

function rrule(ev: any): string | null {
  const freq: Record<string, string> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
  }
  const f = freq[ev.recurrence]
  if (!f) return null
  let r = `RRULE:FREQ=${f}`
  if (ev.recurrence_until) r += `;UNTIL=${ev.recurrence_until.replace(/-/g, '')}`
  return r
}

function mapToGoogle(ev: any, tz: string | null): any {
  const body: any = {
    summary: ev.title,
    location: ev.location || undefined,
    description: ev.notes || undefined,
  }
  if (ev.all_day) {
    body.start = { date: ev.start_date }
    body.end = { date: addDaysISO(ev.end_date || ev.start_date, 1) } // exclusive
  } else {
    const st = (ev.start_time || '09:00:00').slice(0, 8)
    const et = (ev.end_time || ev.start_time || '10:00:00').slice(0, 8)
    body.start = { dateTime: `${ev.start_date}T${st}`, timeZone: tz || undefined }
    body.end = { dateTime: `${ev.end_date || ev.start_date}T${et}`, timeZone: tz || undefined }
  }
  const r = rrule(ev)
  if (r) body.recurrence = [r]
  return body
}

// --- Google API helpers ------------------------------------------------------

async function getAccessToken(db: any, conn: Conn, id: string, secret: string): Promise<string> {
  const now = Date.now()
  if (conn.access_token && conn.token_expiry && Date.parse(conn.token_expiry) > now + 60_000) {
    return conn.access_token
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${await r.text()}`)
  const j = await r.json()
  await db
    .from('google_calendar_connections')
    .update({
      access_token: j.access_token,
      token_expiry: new Date(now + (j.expires_in ?? 3500) * 1000).toISOString(),
    })
    .eq('user_email', conn.user_email)
  return j.access_token
}

async function listEvents(access: string, calendarId: string, timeMin: string, timeMax: string) {
  const items: any[] = []
  let pageToken: string | undefined
  let timeZone: string | null = null
  do {
    const u = new URL(`${API}/calendars/${enc(calendarId)}/events`)
    u.searchParams.set('singleEvents', 'true')
    u.searchParams.set('orderBy', 'startTime')
    u.searchParams.set('timeMin', timeMin)
    u.searchParams.set('timeMax', timeMax)
    u.searchParams.set('maxResults', '2500')
    u.searchParams.set('showDeleted', 'false')
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${access}` } })
    if (!r.ok) throw new Error(`events.list ${r.status}: ${await r.text()}`)
    const j = await r.json()
    timeZone = j.timeZone ?? timeZone
    for (const it of j.items ?? []) {
      if (it.status !== 'cancelled' && (it.start?.date || it.start?.dateTime)) items.push(it)
    }
    pageToken = j.nextPageToken
  } while (pageToken)
  return { items, timeZone }
}

async function insertEvent(access: string, calendarId: string, body: any): Promise<string> {
  const r = await fetch(`${API}/calendars/${enc(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`events.insert ${r.status}: ${await r.text()}`)
  return (await r.json()).id
}

async function patchEvent(
  access: string,
  calendarId: string,
  eventId: string,
  body: any,
): Promise<string> {
  const r = await fetch(`${API}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // Event was deleted on Google's side → recreate it so the edit isn't lost.
  if (r.status === 404 || r.status === 410) return insertEvent(access, calendarId, body)
  if (!r.ok) throw new Error(`events.patch ${r.status}: ${await r.text()}`)
  return (await r.json()).id
}

async function deleteEvent(access: string, calendarId: string, eventId: string): Promise<void> {
  const r = await fetch(`${API}/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access}` },
  })
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    throw new Error(`events.delete ${r.status}: ${await r.text()}`)
  }
}

function pullChanged(cur: any, m: Mapped): boolean {
  const t = (v: string | null) => (v ? v.slice(0, 8) : null)
  return (
    cur.title !== m.title ||
    cur.start_date !== m.start_date ||
    cur.end_date !== m.end_date ||
    cur.all_day !== m.all_day ||
    t(cur.start_time) !== m.start_time ||
    t(cur.end_time) !== m.end_time ||
    (cur.location ?? null) !== m.location ||
    (cur.notes ?? null) !== m.notes
  )
}

// --- one connection ----------------------------------------------------------

async function syncConnection(db: any, conn: Conn, clientId: string, clientSecret: string) {
  const winStart = addDaysISO(todayUTC(), -30)
  const winEnd = addDaysISO(todayUTC(), 180)
  const access = await getAccessToken(db, conn, clientId, clientSecret)

  // Read Google's current state (also tells us the calendar's time zone).
  const { items: rawItems, timeZone } = await listEvents(
    access,
    conn.calendar_id,
    `${winStart}T00:00:00Z`,
    `${winEnd}T23:59:59Z`,
  )
  const tz = timeZone || conn.time_zone

  // ---- PUSH: One Roof → Google -------------------------------------------
  const { data: mine } = await db
    .from('calendar_events')
    .select(
      'id, title, start_date, end_date, all_day, start_time, end_time, location, notes, recurrence, recurrence_until, google_event_id, synced_at, updated_at',
    )
    .eq('household_id', conn.household_id)
    .eq('source', 'oneroof')
    .eq('created_by', conn.user_email)
  let pushed = 0
  for (const ev of mine ?? []) {
    const needs =
      !ev.google_event_id ||
      !ev.synced_at ||
      (ev.updated_at && Date.parse(ev.updated_at) > Date.parse(ev.synced_at))
    if (!needs) continue
    const body = mapToGoogle(ev, tz)
    const gid = ev.google_event_id
      ? await patchEvent(access, conn.calendar_id, ev.google_event_id, body)
      : await insertEvent(access, conn.calendar_id, body)
    await db
      .from('calendar_events')
      .update({
        google_event_id: gid,
        google_calendar_id: conn.calendar_id,
        synced_at: new Date().toISOString(),
      })
      .eq('id', ev.id)
    pushed++
  }

  // Deletions tombstoned by this user → remove from Google, then clear.
  const { data: tombs } = await db
    .from('calendar_deletions')
    .select('id, google_event_id, google_calendar_id')
    .eq('household_id', conn.household_id)
    .eq('user_email', conn.user_email)
  let deleted = 0
  const deletedGids = new Set<string>()
  for (const t of tombs ?? []) {
    await deleteEvent(access, t.google_calendar_id || conn.calendar_id, t.google_event_id).catch(
      () => {},
    )
    await db.from('calendar_deletions').delete().eq('id', t.id)
    deletedGids.add(t.google_event_id)
    deleted++
  }

  // ---- PULL: Google → One Roof -------------------------------------------
  // Skip our own pushed events (and their recurring instances) to avoid echo.
  const { data: ownPushed } = await db
    .from('calendar_events')
    .select('google_event_id')
    .eq('household_id', conn.household_id)
    .eq('source', 'oneroof')
    .not('google_event_id', 'is', null)
  const ownIds = new Set((ownPushed ?? []).map((r: any) => r.google_event_id))
  // Also skip anything we deleted this run — rawItems was fetched before the
  // delete, so without this the just-deleted event would re-import as "new".
  const mapped = rawItems
    .filter(
      (it) =>
        !ownIds.has(it.id) &&
        !deletedGids.has(it.id) &&
        !(
          it.recurringEventId &&
          (ownIds.has(it.recurringEventId) || deletedGids.has(it.recurringEventId))
        ),
    )
    .map(mapFromGoogle)
  const pulledIds = new Set(mapped.map((m) => m.google_event_id))

  const { data: existing } = await db
    .from('calendar_events')
    .select('id, google_event_id, title, start_date, end_date, all_day, start_time, end_time, location, notes')
    .eq('household_id', conn.household_id)
    .eq('source', 'google')
    .eq('owner_email', conn.user_email)
  const byGid = new Map<string, any>((existing ?? []).map((r: any) => [r.google_event_id, r]))

  const now = new Date().toISOString()
  const inserts: any[] = []
  for (const m of mapped) {
    const cur = byGid.get(m.google_event_id)
    const row = {
      ...m,
      owner_email: conn.user_email,
      source: 'google',
      google_calendar_id: conn.calendar_id,
      synced_at: now,
    }
    if (!cur) inserts.push({ household_id: conn.household_id, ...row })
    else if (pullChanged(cur, m)) await db.from('calendar_events').update(row).eq('id', cur.id)
  }
  if (inserts.length) await db.from('calendar_events').insert(inserts)

  const stale = (existing ?? [])
    .filter(
      (r: any) => !pulledIds.has(r.google_event_id) && r.start_date >= winStart && r.start_date <= winEnd,
    )
    .map((r: any) => r.id)
  if (stale.length) await db.from('calendar_events').delete().in('id', stale)

  await db
    .from('google_calendar_connections')
    .update({ last_synced_at: now, last_error: null, time_zone: tz })
    .eq('user_email', conn.user_email)

  return { pushed, deleted, pulled: mapped.length, inserted: inserts.length, pruned: stale.length }
}

export default async function handler(req: any, res: any) {
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!url || !serviceKey) return res.status(500).json({ error: 'Not configured (missing Supabase env).' })
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Google sync not configured (missing GOOGLE_CLIENT_ID/SECRET).' })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const authHeader = req.headers.authorization ?? ''
  const cronSecret = process.env.CRON_SECRET

  let connections: Conn[] = []
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    const { data } = await db.from('google_calendar_connections').select('*')
    connections = (data ?? []) as Conn[]
  } else {
    const jwt = authHeader.replace(/^Bearer /, '')
    if (!anonKey || !jwt) return res.status(401).json({ error: 'Unauthorized' })
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` },
    })
    if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
    const email = (await userRes.json())?.email
    if (!email) return res.status(401).json({ error: 'Unauthorized' })
    const { data } = await db.from('google_calendar_connections').select('*').eq('user_email', email)
    connections = (data ?? []) as Conn[]
  }

  const results: any[] = []
  for (const conn of connections) {
    try {
      results.push({ user: conn.user_email, ...(await syncConnection(db, conn, clientId, clientSecret)) })
    } catch (e: any) {
      await db
        .from('google_calendar_connections')
        .update({ last_error: String(e?.message ?? e).slice(0, 500) })
        .eq('user_email', conn.user_email)
      results.push({ user: conn.user_email, error: String(e?.message ?? e).slice(0, 200) })
    }
  }
  return res.status(200).json({ ok: true, synced: results.length, results })
}
