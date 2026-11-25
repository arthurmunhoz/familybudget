// Keeps this phone's calendar event reminders (lib/eventReminders.ts) in step:
// on login, on sign-out (clears them) and every return to the foreground.
// Never prompts for permission. Mounted once, globally, from app/_layout.tsx.
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/lib/auth'
import { syncEventReminders } from '@/lib/eventReminders'

export function useEventReminders(): void {
  const { profile } = useAuth()
  const email = profile?.email ?? null

  useEffect(() => {
    void syncEventReminders()
    if (!email) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncEventReminders()
    })
    return () => sub.remove()
  }, [email])
}
