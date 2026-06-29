// Vercel function: pull events from each linked Google Calendar into One Roof's
// calendar_events table (source='google'). Two callers:
//   • Vercel Cron (Authorization: Bearer CRON_SECRET) → syncs every connection.
//   • A signed-in user (Supabase JWT) → syncs only their own connection ("Sync now").
//
// This is the READ direction only (Google → One Roof). Pulled events are tagged
// with owner_email = the connecting user, so each member's Google events show in
// their own color, and pruning of removed events is scoped per-connection.
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
}

const MS_PER_DAY = 86_400_000

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDaysISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10)
}

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

// Map a Google event resource to our row shape. Times keep the calendar's local
// wall-clock as Google returns it (no timezone conversion) — fine for display.
function mapEvent(item: any): Mapped {
  const allDay = !!item.start?.date
  let start_date: string
  let end_date: string
  let start_time: string | null = null
  let end_time: string | null = null
  if (allDay) {
    start_date = item.start.date
    // Google's all-day end.date is EXCLUSIVE → step back a day for inclusive end.
    end_date = item.end?.date ? addDaysISO(item.end.date, -1) : start_date
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

async function getAccessToken(
  db: any,
  conn: Conn,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Date.now()
  if (conn.access_token && conn.token_expiry && Date.parse(conn.token_expiry) > now + 60_000) {
    return conn.access_token
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: conn.refresh_token,
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${await r.text()}`)
  const j = await r.json()
  const expiry = new Date(now + (j.expires_in ?? 3500) * 1000).toISOString()
  await db
    .from('google_calendar_connections')
    .update({ access_token: j.access_token, token_expiry: expiry })
    .eq('user_email', conn.user_email)
  return j.access_token
}

async function fetchEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<any[]> {
  const items: any[] = []
  let pageToken: string | undefined
  do {
    const u = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    )
    u.searchParams.set('singleEvents', 'true')
    u.searchParams.set('orderBy', 'startTime')
    u.searchParams.set('timeMin', timeMin)
    u.searchParams.set('timeMax', timeMax)
    u.searchParams.set('maxResults', '2500')
    u.searchParams.set('showDeleted', 'false')
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!r.ok) throw new Error(`events.list ${r.status}: ${await r.text()}`)
    const j = await r.json()
    for (const it of j.items ?? []) {
      if (it.status !== 'cancelled' && (it.start?.date || it.start?.dateTime)) items.push(it)
    }
    pageToken = j.nextPageToken
  } while (pageToken)
  return items
}

function changed(cur: any, m: Mapped): boolean {
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

async function syncConnection(db: any, conn: Conn, clientId: string, clientSecret: string) {
  const winStart = addDaysISO(todayUTC(), -30)
  const winEnd = addDaysISO(todayUTC(), 180)
  const access = await getAccessToken(db, conn, clientId, clientSecret)
  const mapped = (await fetchEvents(access, conn.calendar_id, `${winStart}T00:00:00Z`, `${winEnd}T23:59:59Z`)).map(
    mapEvent,
  )
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
    else if (changed(cur, m)) await db.from('calendar_events').update(row).eq('id', cur.id)
  }
  if (inserts.length) await db.from('calendar_events').insert(inserts)

  // Remove events that vanished from Google — but only within the synced window,
  // so events outside it (older/further out) aren't touched.
  const stale = (existing ?? [])
    .filter(
      (r: any) => !pulledIds.has(r.google_event_id) && r.start_date >= winStart && r.start_date <= winEnd,
    )
    .map((r: any) => r.id)
  if (stale.length) await db.from('calendar_events').delete().in('id', stale)

  await db
    .from('google_calendar_connections')
    .update({ last_synced_at: now, last_error: null })
    .eq('user_email', conn.user_email)

  return { pulled: mapped.length, inserted: inserts.length, pruned: stale.length }
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
