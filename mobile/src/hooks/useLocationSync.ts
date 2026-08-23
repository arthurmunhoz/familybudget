// Keeps this device's background location updates alive across app restarts.
//
// The sibling of useGeofenceSync, and it exists for the same class of reason.
// Geofences were only registered when someone opened Whereabouts; background
// LOCATION UPDATES were only started when someone toggled the sharing switch.
// Both left the feature silently dead in between.
//
// What makes this Android's problem specifically (Expo 56 docs on
// startLocationUpdatesAsync): "A terminated app will not automatically restart
// when a location or geofencing event occurs due to platform limitations",
// while on iOS "the system will restart the terminated app". So an Android
// force-stop, reboot, or OEM battery optimiser killing the foreground service
// stops the fixes for good — the user's own pin freezes on the family map while
// everyone else's moves, and no place crossings are recorded for them, so their
// household never gets an arrival or departure alert about them again. Nothing
// in the UI shows a problem: `sharing` is still true in the database.
//
// Mounted once, globally, from mobile/src/app/_layout.tsx.
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { captureAndUpload } from '@/lib/location'
import { resumeBackgroundUpdatesIfSharing } from '@/lib/locationTask'

export function useLocationSync(): void {
  const { profile } = useAuth()
  const { t } = useI18n()
  const email = profile?.email

  useEffect(() => {
    // Wait for auth: the check reads this member's own row, and signed out
    // there isn't one to read.
    if (!email) return
    const labels = { title: t('location.fg.title'), body: t('location.fg.body') }

    const resume = async () => {
      try {
        const restarted = await resumeBackgroundUpdatesIfSharing(labels)
        // Only after an actual restart: the pin is stale by definition at that
        // point, and the task's own first report can be a cadence away.
        if (restarted) await captureAndUpload().catch(() => {})
      } catch {
        // Never let this throw into the app — it runs on every foreground.
      }
    }

    void resume()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void resume()
    })
    return () => sub.remove()
  }, [email, t])
}
