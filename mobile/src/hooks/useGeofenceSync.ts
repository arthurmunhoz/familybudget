// Keeps this device's OS geofence registration in step with the household's
// places. Fires on login/app launch and on every foreground — NOT only when the
// user happens to open Whereabouts.
//
// That was a real bug: `syncGeofences()` was called ONLY from the Whereabouts
// screen, but places are household-shared while geofences are per-device, and a
// crossing is recorded by the MOVER's device. So a place one member added was
// never monitored on anyone else's phone until they personally visited that
// screen — their arrivals/departures were never recorded, and nobody was ever
// alerted. (Observed: "Home" fired for both members, but a gym and a gym added
// later never fired once, for anyone.)
//
// Mounted once, globally, from mobile/src/app/_layout.tsx.
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { useAuth } from '@/lib/auth'
import { syncGeofences } from '@/lib/placesTask'

export function useGeofenceSync(): void {
  const { profile } = useAuth()
  const email = profile?.email

  useEffect(() => {
    // Wait for auth. Signed out, syncGeofences reads a null member_locations row,
    // reads that as "not sharing", and TEARS DOWN the existing regions — so
    // calling it during a cold start would unregister everything.
    if (!email) return
    void syncGeofences()
    // Re-sync on foreground so places added by another member are picked up the
    // next time this person opens the app, whatever screen they land on.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncGeofences()
    })
    return () => sub.remove()
  }, [email])
}
