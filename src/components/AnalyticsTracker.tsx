import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { initAnalytics, trackPageView } from '../lib/analytics'

/** Renders nothing; wires route changes and clicks into the analytics buffer. */
export default function AnalyticsTracker() {
  const { profile } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (profile) initAnalytics(profile.email)
  }, [profile])

  useEffect(() => {
    if (profile) trackPageView(location.pathname)
  }, [profile, location.pathname])

  return null
}
