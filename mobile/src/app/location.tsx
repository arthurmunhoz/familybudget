// Route entry for the Whereabouts family-location app. Implementation lives in
// src/apps/location/ (mirrors how every other app route is a thin wrapper).
//
// Where Whereabouts is switched off (Android v1 — see lib/features.ts) the route
// still exists, because something can still point at it — an old notification,
// a place alert from an iPhone-side household member, a saved deep link — and
// an unmatched route is a dead end. It sends you home instead.
import { Redirect } from 'expo-router'

import Whereabouts from '@/apps/location/Whereabouts'
import { WHEREABOUTS_ENABLED } from '@/lib/features'

export default function LocationScreen() {
  if (!WHEREABOUTS_ENABLED) return <Redirect href="/" />
  return <Whereabouts />
}
