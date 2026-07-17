// Connects analytics to auth + navigation. Mounted once in the root layout:
// identifies the signed-in user (and resets on sign-out), and logs a screen_view
// on every route change. Renders nothing.
import { useEffect } from 'react'
import { usePathname } from 'expo-router'

import { initAnalytics, resetAnalytics, trackScreen } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'

export function AnalyticsBridge() {
  const { profile } = useAuth()
  const pathname = usePathname()
  const email = profile?.email ?? null

  useEffect(() => {
    if (email) initAnalytics(email)
    else resetAnalytics()
  }, [email])

  useEffect(() => {
    if (email && pathname) trackScreen(pathname)
  }, [email, pathname])

  return null
}
