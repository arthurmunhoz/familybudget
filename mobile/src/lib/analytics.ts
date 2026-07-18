// Centralized, typed event logging for the native app. Events are buffered and
// flushed in batches (every 10s, when the buffer fills, or when the app is
// backgrounded) into the shared `web_events` table — the same store the PWA
// used, so the admin activity feed sees native users too. Analytics must NEVER
// break the app: every failure is swallowed.
//
// Two kinds of events share the pipe:
//  • behavioral — session_start / screen_view / error (funnel + usage analytics)
//  • semantic   — typed domain actions (entry.created, nudge.sent, …) that say
//    precisely what the user did. These are what the activity feed renders; the
//    payload travels in `meta` (see lib/activityFeed.ts for the render catalog).
import { AppState, type AppStateStatus } from 'react-native'

import { supabase } from './supabase'

export type EventName =
  // behavioral
  | 'session_start'
  | 'screen_view'
  | 'error'
  // Money
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'budget.created'
  | 'budget.visibility_changed'
  | 'period.deleted'
  // Shopping
  | 'shopping.added'
  | 'shopping.checked'
  | 'shopping.removed'
  | 'shopping.cleared'
  // Pets
  | 'pet.created'
  | 'pet.updated'
  | 'pet.deleted'
  | 'pet.event_logged'
  | 'pet.event_updated'
  | 'pet.event_deleted'
  | 'petcare.task_done'
  | 'petcare.task_added'
  | 'petcare.task_deleted'
  | 'pet.weight_logged'
  // Nudges
  | 'nudge.sent'
  // Documents
  | 'doc.uploaded'
  | 'doc.opened'
  | 'doc.deleted'
  // Calendar
  | 'calendar.created'
  | 'calendar.updated'
  | 'calendar.deleted'
  // Family / admin
  | 'member.added'
  | 'plan.changed'

/**
 * Every semantic (non-behavioral) event, in display order. The admin "Feature
 * usage" view lists all of these with their counts — including zeros — so you
 * can see at a glance what's used and what isn't. Keep in sync with EventName
 * and the render CATALOG in lib/activityFeed.ts.
 */
export const SEMANTIC_EVENTS: EventName[] = [
  'entry.created',
  'entry.updated',
  'entry.deleted',
  'budget.created',
  'budget.visibility_changed',
  'period.deleted',
  'shopping.added',
  'shopping.checked',
  'shopping.removed',
  'shopping.cleared',
  'pet.created',
  'pet.updated',
  'pet.deleted',
  'pet.event_logged',
  'pet.event_updated',
  'pet.event_deleted',
  'petcare.task_done',
  'petcare.task_added',
  'petcare.task_deleted',
  'pet.weight_logged',
  'nudge.sent',
  'doc.uploaded',
  'doc.opened',
  'doc.deleted',
  'calendar.created',
  'calendar.updated',
  'calendar.deleted',
  'member.added',
  'plan.changed',
]

interface EventInsert {
  user_email: string
  session_id: string
  type: string
  path: string | null
  target: string | null
  meta?: Record<string, unknown> | null
}

let email: string | null = null
let session: string | null = null
let buffer: EventInsert[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let installed = false

/** One session per cold start (the JS context lives across screen navigations). */
function sessionId(): string {
  if (!session) session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return session
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, 10_000)
}

async function flush(): Promise<void> {
  if (!buffer.length) return
  const batch = buffer
  buffer = []
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    // household_id + created_at are stamped by column defaults; RLS checks that
    // user_email matches the caller's JWT, so we pass it explicitly.
    await supabase.from('web_events').insert(batch)
  } catch {
    // drop the batch — analytics never interrupts the user
  }
}

function push(type: string, fields: Partial<EventInsert> = {}): void {
  if (!email) return
  buffer.push({
    user_email: email,
    session_id: sessionId(),
    type,
    path: fields.path ?? null,
    target: fields.target ?? null,
    meta: fields.meta ?? null,
  })
}

/** Log a semantic or behavioral event. No-op until initAnalytics sets the user. */
export function track(type: EventName, meta?: Record<string, unknown>): void {
  push(type, { meta })
  if (buffer.length >= 20) void flush()
  else scheduleFlush()
}

/** Behavioral: a screen was viewed (feeds usage analytics, not the activity feed). */
export function trackScreen(path: string): void {
  push('screen_view', { path })
  scheduleFlush()
}

/** Report a caught/fatal error. Flushes immediately — the app may be dying. */
export function trackError(error: unknown, extra: Record<string, unknown> = {}): void {
  const err = error instanceof Error ? error : new Error(String(error))
  push('error', { target: err.message.slice(0, 200), meta: { stack: err.stack?.slice(0, 2000), ...extra } })
  void flush()
}

type RNErrorUtils = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void
}

/** Wire up the signed-in user. Safe to call repeatedly (e.g. on profile change);
 *  listeners + the session_start event install only once per cold start. */
export function initAnalytics(userEmail: string): void {
  email = userEmail
  if (installed) return
  installed = true

  track('session_start', { platform: 'ios' })

  // Flush when the app leaves the foreground — iOS may suspend it.
  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'background' || next === 'inactive') void flush()
  })

  // Capture fatal JS errors, then defer to the previous handler.
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils
  if (errorUtils) {
    const prev = errorUtils.getGlobalHandler()
    errorUtils.setGlobalHandler((e, isFatal) => {
      trackError(e, { fatal: !!isFatal, source: 'global' })
      prev(e, isFatal)
    })
  }
}

/** On sign-out: flush what we have and forget the user so the next account
 *  signing in on the same JS context isn't attributed the previous one's events. */
export function resetAnalytics(): void {
  void flush()
  email = null
}
