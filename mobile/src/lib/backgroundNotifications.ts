// Background + foreground handling for the silent "ack" push (see
// api/ack-ping.ts): when someone acknowledges a nudge this device sent, it
// flashes "{emoji} {label} · seen by {name}" on the Nudges widget without
// opening the app. Requires app.json's `UIBackgroundModes:
// ["remote-notification"]` and the `expo-task-manager` dependency — both need
// a native rebuild (`npx expo prebuild -p ios`) to take effect.
//
// iOS background execution is best-effort, never guaranteed, and won't run at
// all if the app has been force-quit (an OS policy, not something to code
// around) — the widget will simply catch up next time it's opened.
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'

import { writeAckStatus } from './widget'

const BACKGROUND_NOTIFICATION_TASK = 'oneroof-background-notification'

/** Shared by both delivery paths below — the background task (app
 *  backgrounded/killed) and the foreground listener (app open), since a
 *  background task doesn't fire while the app is in the foreground. */
function handleAckPayload(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const d = data as Record<string, unknown>
  if (d.type !== 'ack') return
  const label = typeof d.label === 'string' ? d.label : ''
  if (!label) return
  writeAckStatus({
    emoji: typeof d.emoji === 'string' ? d.emoji : '📣',
    label,
    ackerName: typeof d.ackerName === 'string' ? d.ackerName : '',
  })
}

// Must run at module scope (not inside a component/effect) — Expo re-runs
// this definition on every JS load, background or foreground, before
// registerBackgroundNotifications() below ever gets a chance to run.
TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) return
  const notification = (data as { notification?: { request?: { content?: { data?: unknown } } } })
    ?.notification
  handleAckPayload(notification?.request?.content?.data)
})

let registered = false

/** Call once at app startup (mobile/src/app/_layout.tsx). */
export function registerBackgroundNotifications(): void {
  if (registered) return
  registered = true
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {
    /* not supported on this platform/build (e.g. Expo Go, Android) — ignore */
  })
  Notifications.addNotificationReceivedListener((notification) => {
    handleAckPayload(notification.request.content.data)
  })
}
