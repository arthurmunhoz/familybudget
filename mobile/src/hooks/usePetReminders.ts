// Keeps this phone's pet routine reminders (lib/petReminders.ts) in step with
// the household: on login, on sign-out (clears them) and every time the app
// comes back to the foreground — the backstop for silent pushes that iOS
// throttled or a phone that was off. Never prompts for permission.
//
// Mounted once, globally, from mobile/src/app/_layout.tsx.
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/lib/auth'
import { syncPetReminders } from '@/lib/petReminders'

export function usePetReminders(): void {
  const { profile } = useAuth()
  const email = profile?.email ?? null

  useEffect(() => {
    void syncPetReminders()
    if (!email) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPetReminders()
    })
    return () => sub.remove()
  }, [email])
}
