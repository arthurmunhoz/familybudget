// Native push registration (APNs via Expo). Stores the device's Expo push token
// in expo_push_tokens so the server can target it. Requires a real device and an
// EAS projectId (set by `eas init`). The SEND side (digest/pings) needs a
// server change to use Expo push receipts — see ARTHUR-TODO.
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'

import { supabase } from './supabase'

export type PushResult = { ok: boolean; reason?: 'simulator' | 'denied' | 'no-project' | 'error' }

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
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await supabase.from('expo_push_tokens').delete().eq('token', tokenData.data)
  } catch {
    /* best effort */
  }
}
