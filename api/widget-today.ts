// Vercel serverless: today's agenda for the iOS "Today" Home-Screen widget.
//
// The widget extension has no Supabase session, so — exactly like
// api/widget-nudge.ts — it authenticates with the per-device WIDGET TOKEN
// (migration 045's widget_tokens). That's what lets the widget refresh itself
// while the app is closed; weather it fetches straight from Open-Meteo, but the
// agenda has to come from us.
//
// The CLIENT sends its own local `day` (YYYY-MM-DD) rather than us guessing a
// timezone server-side, and its `locale` so times/labels match the app.
//
// Reuses the PWA's own calendar/pet-care logic (src/lib/*) so the widget's
// agenda is computed identically to the Hub's Today card — no second copy of
// the recurrence rules to drift.
//
// Env required (Vercel project settings):
//   VITE_SUPABASE_URL         — already set (reused from the client)
//   SUPABASE_SERVICE_ROLE_KEY — server-only; bypasses RLS
import { createClient } from '@supabase/supabase-js'

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

  const { token, day, locale } = req.body ?? {}
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' })
  if (!day || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return res.status(400).json({ error: 'Missing day' })
  }
  const loc = typeof locale === 'string' && locale ? locale : 'en-US'
  const lang = loc.split('-')[0]

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Resolve the widget token → household. NOTE: the service role bypasses RLS,
  // so the household_id filters below ARE the tenancy boundary here.
  const { data: wt } = await db
    .from('widget_tokens')
    .select('household_id')
    .eq('token', token)
    .maybeSingle()
  if (!wt) return res.status(401).json({ error: 'Invalid token' })
  const household: string = wt.household_id

  const [ev, pe, pt_] = await Promise.all([
    db.from('calendar_events').select('*').eq('household_id', household),
    db
      .from('pet_events')
      .select('*, pets!inner(household_id)')
      .eq('pets.household_id', household)
      .order('event_date', { ascending: false }),
    db.from('pets').select('id, name, emoji').eq('household_id', household),
  ])

  const events = (ev.data ?? []) as CalendarEvent[]
  // pet_events has no household_id (it's scoped through pets) — hence the
  // !inner join above; the rows carry an extra `pets` key we don't need.
  const petEvents = (pe.data ?? []) as unknown as PetEvent[]
  const pets = (pt_.data ?? []) as { id: string; name: string; emoji: string }[]
  const petById = Object.fromEntries(pets.map((p) => [p.id, p]))

  // Mirrors TodaySection.tsx exactly: calendar occurrences first, then pet-care.
  const todaysOcc = [...(occurrencesByDay(events, day, day).get(day) ?? [])].sort(compareOccurrences)
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

  void db.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)

  return res.status(200).json({ day, items: [...evItems, ...petItems].slice(0, MAX_ITEMS) })
}
