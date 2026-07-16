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

import {
  KIND_EMOJI,
  compareOccurrences,
  formatTime,
  occurrencesByDay,
  yearsAt,
} from '../src/lib/calendar'
import { overdueEvents } from '../src/lib/petCare'
import type { CalendarEvent, PetEvent } from '../src/lib/types'
import { en } from '../src/lib/i18n/en'
import { es } from '../src/lib/i18n/es'
import { pt } from '../src/lib/i18n/pt'

const DICTS: Record<string, Record<string, string>> = { en, es, pt }
const MAX_ITEMS = 6

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
  const dict = DICTS[lang] ?? en
  let s = (dict as Record<string, string>)[key] ?? key
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
    const todaysOcc = [...(occurrencesByDay(events, day, day).get(day) ?? [])].sort(
      compareOccurrences,
    )
    const petDue = overdueEvents(petEvents, day)

    const evItems = todaysOcc.map((o) => {
      const e = o.event
      const years = e.kind === 'birthday' || e.kind === 'anniversary' ? yearsAt(e, o.start) : 0
      const time = e.all_day ? null : e.start_time ? formatTime(e.start_time, loc) : null
      const subtitle =
        e.kind === 'birthday' && years > 0
          ? tr(lang, 'home.turns', { n: years })
          : e.kind === 'anniversary' && years > 0
            ? tr(lang, 'home.years', { n: years })
            : time
      return { emoji: KIND_EMOJI[e.kind] || '📅', title: e.title, subtitle: subtitle ?? null }
    })
    const petItems = petDue.map((e) => ({
      emoji: petById[e.pet_id]?.emoji || '🐾',
      title: e.title,
      subtitle: (e.next_due ?? '') < day ? tr(lang, 'home.overdue') : tr(lang, 'home.dueToday'),
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
