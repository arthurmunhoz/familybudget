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
