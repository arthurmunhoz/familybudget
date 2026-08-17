// Native push registration (APNs via Expo). Stores the device's Expo push token
// in expo_push_tokens so the server can target it. Requires a real device and an
// EAS projectId (set by `eas init`). The SEND side (digest/pings) needs a
// server change to use Expo push receipts — see ARTHUR-TODO.
import { Platform } from 'react-native'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'

import { supabase } from './supabase'

export type PushResult = { ok: boolean; reason?: 'simulator' | 'denied' | 'no-project' | 'error' }

/** Android notification channel ids. The SERVER picks one per push (`channelId`
 *  in the Expo message — see api/send-ping.ts and api/send-digest.ts), so these
 *  strings are a cross-repo contract: renaming one here silently drops pushes
 *  into the OS default channel. `DEFAULT` matches the `defaultChannel` set on
 *  the expo-notifications config plugin in app.json. */
export const ANDROID_CHANNEL = { DEFAULT: 'default', URGENT: 'urgent' } as const

/** Create the Android notification channels. No-op off Android.
 *
 *  On Android, importance is a property of the CHANNEL, not of the message — a
 *  high-priority Nudge sent into a DEFAULT-importance channel arrives with no
 *  heads-up banner and no sound, which defeats the entire point of the flag. So
 *  urgent nudges get their own MAX-importance channel.
 *
 *  Ordering matters twice over, which is why every getExpoPushTokenAsync call
 *  below is preceded by this:
 *    • On Android 13+ the OS permission prompt does not appear until at least
 *      one channel exists — so creating channels AFTER requesting permission
 *      means the user is never asked.
 *    • Expo requires a channel to exist before getExpoPushTokenAsync.
 *  Re-calling is safe and cheap: after creation only name/description can change,
 *  so this cannot clobber a user's own importance choice for the channel. */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL.DEFAULT, {
      name: 'Household updates',
      description: 'Nudges, reminders and the daily digest.',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    })
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL.URGENT, {
      name: 'Urgent nudges',
      description: 'Someone in your household needs a hand right now.',
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    })
  } catch {
    /* best effort — a channel failure must never block sign-in or a token refresh */
  }
}

function projectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId
  return fromConfig ?? fromEas
}

/** Current OS-level push permission for this device: true = notifications are
 *  allowed. Used to show the on/off status without prompting. */
export async function getPushEnabled(): Promise<boolean> {
  try {
    const perm = await Notifications.getPermissionsAsync()
    return perm.status === 'granted'
  } catch {
    return false
  }
}

export async function registerForPush(): Promise<PushResult> {
  try {
    if (!Device.isDevice) return { ok: false, reason: 'simulator' }
    // MUST precede requestPermissionsAsync: on Android 13+ the OS prompt does
    // not appear until a channel exists, so this order is what makes the toggle
    // work at all there.
    await ensureAndroidChannels()
    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync()
      status = req.status
    }
    if (status !== 'granted') return { ok: false, reason: 'denied' }
    const id = projectId()
    if (!id) return { ok: false, reason: 'no-project' }
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await supabase
      .from('expo_push_tokens')
      .upsert({ token: tokenData.data, device: Device.modelName ?? null })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Re-register this device's Expo token WITHOUT ever prompting — only when OS
 *  permission is ALREADY granted.
 *
 *  `registerForPush()` runs only when the user taps the Settings toggle, so
 *  nothing ever repairs a token that went stale: Expo tokens can rotate, a
 *  reinstall issues a new one, and a deleted row leaves the user silently
 *  unreachable with the toggle still reading "on". Called on every launch
 *  (useSyncPushToken) — idempotent upsert, no permission prompt, so a user who
 *  never enabled notifications is untouched.
 *
 *  Note: RLS is `user_email = jwt_email()`, so if this exact token row belongs
 *  to a DIFFERENT account (device handed over), the conflict update matches no
 *  row and this no-ops — same as registerForPush. */
export async function refreshPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return
    const perm = await Notifications.getPermissionsAsync()
    if (perm.status !== 'granted') return // never prompt from a background refresh
    const id = projectId()
    if (!id) return
    // Channels live in OS state, not ours: a reinstall drops them, and
    // getExpoPushTokenAsync needs one on Android. Re-assert before every token read.
    await ensureAndroidChannels()
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await supabase
      .from('expo_push_tokens')
      .upsert({ token: tokenData.data, device: Device.modelName ?? null })
  } catch {
    /* best effort — never surface a launch-time push refresh to the user */
  }
}

export async function disablePush(): Promise<void> {
  try {
    const id = projectId()
    if (!id) return
    await ensureAndroidChannels() // getExpoPushTokenAsync needs a channel on Android
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await supabase.from('expo_push_tokens').delete().eq('token', tokenData.data)
  } catch {
    /* best effort */
  }
}
