// After any pet-care change (a task ticked, a routine edited): reload this
// device's PetCare widget, and ask the server to silent-push every OTHER
// member's device so their widgets reload too. Best-effort — failures are
// ignored; widgets also catch up on their own timeline. Shared by the Pet Care
// screen and the Home's assistant (which can tick daily tasks too).
import { supabase } from './supabase'
import { reloadPetCareWidget } from './widget'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export function notifyPetCareChange(): void {
  try {
    reloadPetCareWidget()
  } catch {
    /* no widget on this platform */
  }
  void (async () => {
    try {
      const { data } = await supabase.rpc('widget_token')
      const token = typeof data === 'string' ? data : null
      if (!token || !API_BASE) return
      await fetch(`${API_BASE}/api/widget?action=petcare-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    } catch {
      /* ignore */
    }
  })()
}
