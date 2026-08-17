// Landing route for `oneroof://auth-callback` — the redirect target of BOTH
// Google sign-in (lib/auth.tsx) and the Google Calendar connect flow
// (lib/googleCalendar.ts).
//
// Why it has to exist as a ROUTE, not just as the promise those two await:
// the platforms deliver the redirect differently. On iOS the in-app browser is
// an ASWebAuthenticationSession, which swallows the redirect and hands the URL
// straight back to `openAuthSessionAsync` — the app is never reopened, so no
// route is involved. On ANDROID it's a Chrome Custom Tab: the `oneroof://`
// redirect fires an Intent that reopens the app, expo-router tries to render
// `/auth-callback`, and with no file here it rendered expo-router's "Unmatched
// Route — Page could not be found" screen with the `?code=` in plain sight.
// Sign-in on Android could not complete at all.
//
// Both deliveries can happen for one redirect, so the exchange in
// lib/oauthRedirect.ts is idempotent — see the comment on `exchanging` there.
import { useEffect } from 'react'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'

import BrandSplash from '@/components/BrandSplash'
import { completeOAuthRedirect } from '@/lib/oauthRedirect'

export default function AuthCallback() {
  // The URL that opened (or re-opened) the app — carries `?code=` for PKCE, or
  // legacy tokens in the fragment, which expo-router's params wouldn't expose.
  const url = Linking.useURL()

  useEffect(() => {
    if (!url) return
    let active = true
    void (async () => {
      try {
        await completeOAuthRedirect(url)
      } catch {
        // Nothing to show here: leaving lands on the root route, which renders
        // Login again when the session didn't take, so the user can retry.
      }
      if (!active) return
      // Back to wherever the flow started — the Calendar connect screen keeps
      // its place, and a sign-in returns to the root, which now has a session
      // and renders the Hub instead of Login.
      if (router.canGoBack()) router.back()
      else router.replace('/')
    })()
    return () => {
      active = false
    }
  }, [url])

  return <BrandSplash />
}
