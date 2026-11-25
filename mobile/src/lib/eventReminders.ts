// Calendar event reminders ("Remind me" → 10 min before, 1 hour before, …).
//
// Why local notifications: Vercel Hobby crons run once a day, so the server
// can't fire at 14:50. Each phone schedules its OWN events' reminders (and the
// whole household's) as expo-notifications DATE triggers, ids
// `evrem:<event>:<day>`, for the next two weeks — see eventReminderPlan.ts.
// syncEventReminders() recomputes the set from the database and is
// idempotent; it runs on launch / login / every foreground (useEventReminders)
// and after any calendar change seen on this phone (Calendar).
//
// The morning digest (api/send-digest) still lists the day's events with a
// reminder — that's the day's summary; this is the "it's about to start" one.
//
// Never prompts for permission (ensureReminderPermission does, from the form).
// Offline, a sync leaves what's scheduled alone rather than wiping it.
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'

import { KIND_EMOJI, formatTime } from './calendar'
import { isEventReminderId, planEventReminders, type PlannedEventReminder } from './eventReminderPlan'
import { todayISO } from './format'
import { DICTS, detectLang, type Lang, type TKey } from './i18n'
import { ANDROID_CHANNEL, ensureAndroidChannels } from './notifications'
import { supabase } from './supabase'
import type { CalendarEvent } from './types'

const LANG_KEY = 'oneroof-lang' // same key as hooks/useI18n
const LOCALES: Record<Lang, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const supported = Platform.OS === 'ios' || Platform.OS === 'android'

async function currentLang(): Promise<Lang> {
  try {
    const v = await AsyncStorage.getItem(LANG_KEY)
    if (v === 'en' || v === 'es' || v === 'pt') return v
  } catch {
    /* fall through */
  }
  return detectLang()
}

function tr(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s
}

/** "In 10 min · 3:00 PM" / "Tomorrow" — what the notification says under the title. */
function bodyFor(p: PlannedEventReminder, lang: Lang): string {
  const ev = p.event
  const m = p.minutes
  let when: string
  if (ev.all_day || !ev.start_time) {
    // all-day: counted from 9:00 on the day
    const days = Math.round(m / 1440)
    when = days <= 0 ? tr(lang, 'calendar.rem.today') : days === 1 ? tr(lang, 'calendar.rem.tomorrow') : tr(lang, 'calendar.rem.inDays', { n: days })
  } else {
    const time = formatTime(ev.start_time, LOCALES[lang])
    if (m <= 0) when = tr(lang, 'calendar.rem.now', { time })
    else if (m < 60) when = tr(lang, 'calendar.rem.min', { n: m, time })
    else if (m < 1440) when = tr(lang, 'calendar.rem.hours', { n: Math.round(m / 60), time })
    else {
      const days = Math.round(m / 1440)
      when = days === 1 ? tr(lang, 'calendar.rem.tomorrowAt', { time }) : tr(lang, 'calendar.rem.daysAt', { n: days, time })
    }
  }
  return ev.location ? `${when} · ${ev.location}` : when
}

async function cancelAll(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
  await Promise.all(
    all
      .filter((n) => isEventReminderId(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
  )
}

async function run(): Promise<void> {
  if (!supported) return
  const { data: sess } = await supabase.auth.getSession()
  const email = sess.session?.user?.email
  if (!email) {
    await cancelAll()
    return
  }
  const perm = await Notifications.getPermissionsAsync()
  if (perm.status !== 'granted') {
    await cancelAll()
    return
  }
  const res = await supabase.from('calendar_events').select('*').not('reminder_minutes', 'is', null)
  if (res.error) return // offline: keep what's scheduled
  const events = (res.data ?? []) as CalendarEvent[]
  const lang = await currentLang()
  const plan = planEventReminders(events, email, new Date(), todayISO())
  const wanted = new Map(plan.map((p) => [p.id, p]))

  const scheduled = (await Notifications.getAllScheduledNotificationsAsync().catch(() => [])).filter((n) =>
    isEventReminderId(n.identifier),
  )
  const have = new Map(
    scheduled.map((n) => [n.identifier, (n.content.data as { fp?: unknown } | undefined)?.fp]),
  )
  for (const id of have.keys()) {
    if (!wanted.has(id)) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  }
  if (!plan.length) return

  await ensureAndroidChannels()
  for (const p of plan) {
    const emoji = KIND_EMOJI[p.event.kind]
    const title = emoji ? `${emoji} ${p.event.title}` : p.event.title
    const body = bodyFor(p, lang)
    // Fingerprint: skip one that's already scheduled exactly so.
    const fp = `${p.fireAt.getTime()}|${title}|${body}`
    if (have.get(p.id) === fp) continue
    if (have.has(p.id)) await Notifications.cancelScheduledNotificationAsync(p.id).catch(() => {})
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title,
        body,
        sound: true,
        // `url` makes a tap open that day in the Calendar (routeFromNotification).
        data: { type: 'event-reminder', url: `/calendar?date=${p.day}`, fp },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.fireAt,
        channelId: ANDROID_CHANNEL.DEFAULT,
      },
    }).catch(() => {})
  }
}

let chain: Promise<void> = Promise.resolve()

/** Recompute this phone's event reminders. Serialized and never throws. */
export function syncEventReminders(): Promise<void> {
  chain = chain.then(() => run().catch(() => {}))
  return chain
}
