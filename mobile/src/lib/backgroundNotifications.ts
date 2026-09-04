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
import { router } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'

import { reloadPetCareWidget, writeAckStatus } from './widget'
import { captureLiveFixIfSharing } from './location'
import { respondToLiveWake } from './locationTask'

const BACKGROUND_NOTIFICATION_TASK = 'oneroof-background-notification'

/** Our DATA-ONLY pushes (api/ack-ping.ts, api/widget.ts's petcare fan-out).
 *  They carry `_contentAvailable` with no title/body and exist purely to wake
 *  the app, so presenting one would show an empty banner. */
const SILENT_TYPES = new Set(['ack', 'petcare', 'live-wake'])

// How a push is presented when it arrives while the app is FOREGROUNDED.
// Without a handler expo-notifications presents NOTHING — which is why nudges
// looked like they'd stopped arriving: with the app open, only the in-app
// Realtime banner (and its high-priority Vibration) got through, while the OS
// notification was silently dropped. Backgrounded delivery was never affected,
// since iOS draws that itself from the APNs payload.
//
// Must sit at module scope: the handler has to be installed before any
// notification is delivered, not once a component mounts.
//
// `shouldShowAlert` is deprecated in expo-notifications 56 — banner (heads-up)
// and list (Notification Centre) are separate flags now.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined
    const type = typeof data?.type === 'string' ? data.type : ''
    const silent = SILENT_TYPES.has(type)
    return {
      shouldShowBanner: !silent,
      shouldShowList: !silent,
      shouldPlaySound: !silent,
      shouldSetBadge: false,
    }
  },
})

/** A live-mode wake push (someone is watching me in Whereabouts) — grab a fresh
 *  fix so their map updates even though my app was asleep. */
function isLiveWake(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as Record<string, unknown>).type === 'live-wake'
}

/** Shared by both delivery paths below — the background task (app
 *  backgrounded/killed) and the foreground listener (app open), since a
 *  background task doesn't fire while the app is in the foreground. */
function handleAckPayload(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const d = data as Record<string, unknown>
  // Someone else marked a pet task done (api/widget petcare-done/notify): the
  // widget just needs a reload — it re-fetches the fresh state itself.
  if (d.type === 'petcare') {
    reloadPetCareWidget()
    return
  }
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
  const payload = (data as { notification?: { request?: { content?: { data?: unknown } } } })
    ?.notification?.request?.content?.data
  handleAckPayload(payload)
  // Background wake: ramp the location task + stream a burst (not just one
  // fix) — the foreground listener below keeps the cheap single fix, since
  // there useLiveResponder picks up the streaming via Realtime.
  if (isLiveWake(payload)) await respondToLiveWake()
})

/** TAPPING a notification should land on the thing it is about.
 *
 *  Every push we send already carries the destination — `data.url` is
 *  '/pings' for a nudge (api/send-ping.ts, api/widget.ts), '/location' for a
 *  place alert or a Safety Radius alert — but nothing ever read it, so a tap
 *  just reopened whatever screen the app was last on. "Paty arrived at the
 *  gym" led nowhere.
 *
 *  Silent types are skipped: they are never presented, so they can't be
 *  tapped, and routing on one would yank the user somewhere they didn't ask
 *  to go if the OS ever did surface it. */
function routeFromNotification(response: Notifications.NotificationResponse | null): void {
  const data = response?.notification?.request?.content?.data as
    | Record<string, unknown>
    | undefined
  if (!data) return
  if (typeof data.type === 'string' && SILENT_TYPES.has(data.type)) return
  const url = typeof data.url === 'string' ? data.url : ''
  // Only our own in-app routes. An absolute URL from a payload is not something
  // to hand to the router.
  if (!url.startsWith('/')) return
  // A cold start routes before the first screen has mounted, so let the
  // navigator settle rather than pushing into nothing.
  setTimeout(() => {
    try {
      router.push(url as Parameters<typeof router.push>[0])
    } catch {
      /* a route that no longer exists must not crash the launch */
    }
  }, 0)
}

let registered = false

/** Call once at app startup (mobile/src/app/_layout.tsx). */
export function registerBackgroundNotifications(): void {
  if (registered) return
  registered = true
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {
    /* not supported on this platform/build (e.g. Expo Go, Android) — ignore */
  })
  Notifications.addNotificationReceivedListener((notification) => {
    const payload = notification.request.content.data
    handleAckPayload(payload)
    if (isLiveWake(payload)) void captureLiveFixIfSharing()
  })
  Notifications.addNotificationResponseReceivedListener(routeFromNotification)
  // The listener above only sees taps that happen while the app is running. A
  // tap that LAUNCHED the app was delivered before it existed, and is waiting
  // here instead.
  Notifications.getLastNotificationResponseAsync()
    .then(routeFromNotification)
    .catch(() => {})
}
