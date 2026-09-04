// Keeps this device's Expo push token fresh in `expo_push_tokens`. Fires on
// login/app launch — NOT only when the user visits Settings.
//
// Why: `registerForPush()` runs solely from the Settings notifications toggle,
// so a token that goes stale is never repaired — Expo tokens can rotate, a
// reinstall issues a new one, and a lost row leaves the user silently
// unreachable while the toggle still reads "on". `refreshPushToken()` never
// prompts (it bails unless OS permission is already granted), so a user who
// hasn't enabled notifications is left completely alone.
//
// Mounted once, globally, from mobile/src/app/_layout.tsx.
import { useEffect } from 'react'

import { useAuth } from '@/lib/auth'
import { ensurePushPermissionOnce, refreshPushToken } from '@/lib/notifications'

export function useSyncPushToken(): void {
  const { profile } = useAuth()
  const email = profile?.email

  useEffect(() => {
    // Needs a session: user_email / household_id are stamped from the JWT by
    // column defaults, and RLS scopes the row to the signed-in user.
    if (!email) return
    // Ask once if this device has never been asked, THEN refresh — a brand new
    // Android 13+ install otherwise never gets a token at all.
    void (async () => {
      await ensurePushPermissionOnce()
      await refreshPushToken()
    })()
  }, [email])
}
