import { useEffect, useState } from 'react'
import { isSubscribed, pushState } from '../lib/push'

/** Whether THIS device can currently receive push notifications (permission
 *  granted AND an active subscription). Returns `null` while checking, so the UI
 *  can avoid flashing an "off" state before the async check resolves. */
export function useNotificationsActive(): boolean | null {
  const [active, setActive] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = pushState() === 'granted' && (await isSubscribed())
      if (!cancelled) setActive(ok)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return active
}
