// Pet routine reminders (migration 098): "Nobody has marked 'Morning food'
// yet. Done it?" with a Done button that records it WITHOUT opening the app.
//
// Why local notifications: Vercel Hobby crons run once a day, so the server
// can't fire at 8:45. Each member's phone schedules its own reminders instead
// (expo-notifications DATE triggers, one per task per day, ids
// `petrem:<task>:<day>`), for today and the next two days — see
// petReminderPlan.ts for the rule. syncPetReminders() recomputes the whole set
// from the database and is idempotent; it runs:
//   • on launch / login / every return to the foreground (usePetReminders),
//   • after any pet-care change on THIS phone (notifyPetCareChange),
//   • when the silent `petcare` push says someone else changed something
//     (backgroundNotifications — background task AND foreground listener),
//   • after the Settings toggle and after a Done from the notification.
// A sync cancels reminders whose (task, day) is now done, and DISMISSES ones
// already showing — that is how the notification disappears from the other
// phones once somebody taps Done. Silent pushes are best-effort on iOS (the OS
// throttles them, and a force-quit app gets none), so the next foreground is
// the backstop.
//
// Nothing here ever prompts for permission except ensureReminderPermission(),
// which runs from a user gesture (setting a time, turning the toggle on).
// Offline or on a database without migration 098, a sync leaves what's
// scheduled alone rather than wiping it.
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'

import { addDaysISO, todayISO } from './format'
import { DICTS, detectLang, type Lang, type TKey } from './i18n'
import { ANDROID_CHANNEL, ensureAndroidChannels, refreshPushToken } from './notifications'
import { isReminderId, planPetReminders } from './petReminderPlan'
import { supabase } from './supabase'
import type { PetCareTask, PetTaskDone } from './types'

export const PET_REMINDER_CATEGORY = 'pet-reminder'
export const PET_REMINDER_DONE_ACTION = 'pet-done'
export const PET_REMINDER_TYPE = 'pet-reminder'

/** Done taps not yet confirmed by the server (written BEFORE the request, so
 *  an app the OS suspends mid-request still records it on the next sync). */
const QUEUE_KEY = 'oneroof-pet-done-queue'
const LANG_KEY = 'oneroof-lang' // same key as hooks/useI18n

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

function tr(lang: Lang, key: TKey, vars?: Record<string, string>): string {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`) : s
}

/** The Done button. Background (no app opening) on both platforms; on iOS it
 *  also works from the lock screen — the session sits in the Keychain as
 *  AFTER_FIRST_UNLOCK (secureSessionStore), so no unlock is demanded. */
async function ensureCategory(lang: Lang): Promise<void> {
  await Notifications.setNotificationCategoryAsync(PET_REMINDER_CATEGORY, [
    {
      identifier: PET_REMINDER_DONE_ACTION,
      buttonTitle: tr(lang, 'petcare.reminderDone'),
      options: { opensAppToForeground: false },
    },
  ])
}

type Queued = { taskId: string; day: string }

async function readQueue(): Promise<Queued[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as Queued[]).filter((q) => q && q.taskId && q.day) : []
  } catch {
    return []
  }
}

async function writeQueue(list: Queued[]): Promise<void> {
  try {
    if (list.length) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-50)))
    else await AsyncStorage.removeItem(QUEUE_KEY)
  } catch {
    /* ignore */
  }
}

async function insertDone(taskId: string, day: string): Promise<boolean> {
  // ON CONFLICT DO NOTHING: someone else may have marked it a second ago.
  // done_by is stamped from the JWT; RLS is the same as a tap in Pet Care.
  const { error } = await supabase
    .from('pet_task_done')
    .upsert({ task_id: taskId, done_on: day }, { onConflict: 'task_id,done_on', ignoreDuplicates: true })
  return !error
}

async function flushQueue(): Promise<void> {
  const list = await readQueue()
  if (!list.length) return
  const left: Queued[] = []
  for (const q of list) if (!(await insertDone(q.taskId, q.day))) left.push(q)
  await writeQueue(left)
}

/** The notification's Done button: record (task, day) with this member's
 *  session. Returns whether the server has it. */
export async function markPetTaskDoneFromReminder(taskId: string, day: string): Promise<boolean> {
  const queue = await readQueue()
  await writeQueue([...queue.filter((q) => !(q.taskId === taskId && q.day === day)), { taskId, day }])
  const { data } = await supabase.auth.getSession()
  if (!data.session) return false
  const ok = await insertDone(taskId, day).catch(() => false)
  if (ok) await writeQueue((await readQueue()).filter((q) => !(q.taskId === taskId && q.day === day)))
  return ok
}

async function cancelAllScheduled(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
  await Promise.all(
    all
      .filter((n) => isReminderId(n.identifier))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
  )
}

type ReminderData = { type?: unknown; taskId?: unknown; day?: unknown; fp?: unknown }

/** Dismiss reminders on screen for which `keep` says no. */
async function dismissPresented(keep: (taskId: string, day: string) => boolean): Promise<void> {
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => [])
  await Promise.all(
    shown.map((n) => {
      const d = n.request.content.data as ReminderData | undefined
      if (d?.type !== PET_REMINDER_TYPE || typeof d.taskId !== 'string' || typeof d.day !== 'string') return null
      if (keep(d.taskId, d.day)) return null
      return Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})
    }),
  )
}

async function clearEverything(): Promise<void> {
  await cancelAllScheduled()
  await dismissPresented(() => false)
}

async function run(): Promise<void> {
  if (!supported) return
  const { data: sess } = await supabase.auth.getSession()
  const email = sess.session?.user?.email
  if (!email) {
    // Signed out: a reminder for a household this phone no longer belongs to
    // must not fire.
    await clearEverything()
    return
  }
  const perm = await Notifications.getPermissionsAsync()
  if (perm.status !== 'granted') {
    await cancelAllScheduled()
    return
  }
  await flushQueue()

  const today = todayISO()
  const [settingsRes, tasksRes, petsRes] = await Promise.all([
    supabase.from('user_settings').select('notify_pets').eq('email', email).maybeSingle(),
    supabase.from('pet_care_tasks').select('*').not('remind_at', 'is', null),
    supabase.from('pets').select('id, name, emoji'),
  ])
  // Offline, or the database predates migration 098: keep what's scheduled.
  if (settingsRes.error || tasksRes.error || petsRes.error) return
  const settings = settingsRes.data as { notify_pets?: boolean | null } | null
  if (settings?.notify_pets === false) {
    await clearEverything()
    return
  }
  const tasks = (tasksRes.data ?? []) as PetCareTask[]
  let done: PetTaskDone[] = []
  if (tasks.length) {
    const doneRes = await supabase
      .from('pet_task_done')
      .select('*')
      .in(
        'task_id',
        tasks.map((tk) => tk.id),
      )
      .gte('done_on', addDaysISO(today, -370))
    if (doneRes.error) return
    done = (doneRes.data ?? []) as PetTaskDone[]
  }

  // Off the screen first: whatever someone has marked since it fired.
  const doneKeys = new Set(done.map((d) => `${d.task_id}|${d.done_on}`))
  const reminding = new Set(tasks.map((tk) => tk.id))
  await dismissPresented((taskId, day) => reminding.has(taskId) && !doneKeys.has(`${taskId}|${day}`))

  const lang = await currentLang()
  const pets = new Map(
    ((petsRes.data ?? []) as { id: string; name: string; emoji: string | null }[]).map((p) => [p.id, p]),
  )
  const plan = planPetReminders(tasks, done, new Date(), today)
  const wanted = new Map(plan.map((p) => [p.id, p]))

  const scheduled = (await Notifications.getAllScheduledNotificationsAsync().catch(() => [])).filter((n) =>
    isReminderId(n.identifier),
  )
  const have = new Map(scheduled.map((n) => [n.identifier, (n.content.data as ReminderData | undefined)?.fp]))
  for (const id of have.keys()) {
    if (!wanted.has(id)) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  }
  if (!plan.length) return

  await ensureAndroidChannels() // a local notification needs its channel too
  await ensureCategory(lang).catch(() => {})
  for (const p of plan) {
    const pet = pets.get(p.petId)
    const petName = pet?.name ?? ''
    const title = `${pet?.emoji || '🐾'} ${petName}`.trim()
    const body = tr(lang, 'petcare.reminderBody', { task: p.title })
    // Fingerprint: skip a reminder that's already scheduled exactly so.
    const fp = `${p.fireAt.getTime()}|${title}|${body}`
    if (have.get(p.id) === fp) continue
    if (have.has(p.id)) await Notifications.cancelScheduledNotificationAsync(p.id).catch(() => {})
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title,
        body,
        sound: true,
        categoryIdentifier: PET_REMINDER_CATEGORY,
        // `url` makes a plain tap open Pet Care (routeFromNotification).
        data: { type: PET_REMINDER_TYPE, taskId: p.taskId, day: p.day, url: '/pets', fp },
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

/** Recompute this phone's pet reminders. Serialized (overlapping calls run one
 *  after another) and never throws. */
export function syncPetReminders(): Promise<void> {
  chain = chain.then(() => run().catch(() => {}))
  return chain
}

/** From a user gesture only (a reminder time was set, the toggle turned on):
 *  ask for notification permission if this phone has never been asked.
 *  Channels first — Android 13+ shows no prompt until one exists. */
export async function ensureReminderPermission(): Promise<void> {
  if (!supported) return
  try {
    const perm = await Notifications.getPermissionsAsync()
    if (perm.status === 'granted' || perm.canAskAgain === false) return
    await ensureAndroidChannels()
    const req = await Notifications.requestPermissionsAsync()
    if (req.status === 'granted') await refreshPushToken()
  } catch {
    /* best effort */
  }
}

/** The notification response is a Done tap on one of our reminders. */
export function isPetReminderDone(response: Notifications.NotificationResponse | null | undefined): boolean {
  if (!response || response.actionIdentifier !== PET_REMINDER_DONE_ACTION) return false
  const d = response.notification?.request?.content?.data as ReminderData | undefined
  return d?.type === PET_REMINDER_TYPE
}

/** Taps on Done already handled in this JS context — the module-scope
 *  listener, the cold-start "last response" and Android's background task can
 *  all see the same tap. The insert is idempotent anyway; this saves the
 *  extra round trips. */
const handled = new Set<string>()

/** Handle a Done tap: take the notification down, record it, then tell the
 *  other phones (widget reload + reminder sync via the silent push). */
export async function handlePetReminderDone(
  response: Notifications.NotificationResponse,
  afterDone: () => void,
): Promise<void> {
  const req = response.notification.request
  const d = req.content.data as ReminderData
  if (typeof d.taskId !== 'string' || typeof d.day !== 'string') return
  const key = `${req.identifier}|${d.day}`
  if (handled.has(key)) return
  handled.add(key)
  await Notifications.dismissNotificationAsync(req.identifier).catch(() => {})
  await Notifications.clearLastNotificationResponseAsync().catch(() => {})
  const ok = await markPetTaskDoneFromReminder(d.taskId, d.day).catch(() => false)
  if (ok) afterDone()
  await syncPetReminders()
}
