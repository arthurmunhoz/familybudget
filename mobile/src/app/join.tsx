// oneroof://join?code=K7P4QXAB — what "Open in the app" on the invite page
// (public/join.html) opens. Someone with no household yet lands on the join
// step with the code filled in (Onboarding reads it); someone who already has
// one goes to "Add another family", where joining by code lives.
import { useEffect, useState } from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'

import BrandSplash from '@/components/BrandSplash'
import { useAuth } from '@/lib/auth'
import { setPendingJoinCode } from '@/lib/invite'

export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code?: string }>()
  const { loading, session, profileLoaded, profile } = useAuth()
  const [stored, setStored] = useState(false)
  const ready = !loading && (!session || profileLoaded)
  const hasHome = !!profile

  useEffect(() => {
    if (!ready || stored) return
    // Only worth keeping for someone who will see the join step.
    void (typeof code === 'string' && !hasHome ? setPendingJoinCode(code) : Promise.resolve()).then(() => setStored(true))
  }, [ready, stored, code, hasHome])

  if (!ready || !stored) return <BrandSplash />
  return <Redirect href={hasHome ? '/families' : '/'} />
}
