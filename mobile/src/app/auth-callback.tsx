// Landing route for `oneroof://auth-callback` — the redirect target of BOTH
// Google sign-in (lib/auth.tsx) and the Google Calendar connect flow
// (lib/googleCalendar.ts).
//
// Why it has to exist as a ROUTE, not just as the promise those two await:
// the platforms deliver the redirect differently. On iOS the in-app browser is
// an ASWebAuthenticationSession, which swallows the redirect and hands the URL
// straight back to `openAuthSessionAsync` — the app is never reopened, so no
// route is involved. On ANDROID it's a Chrome Custom Tab: the `oneroof://`
// redirect fires an Intent that reopens the app and expo-router resolves
// `/auth-callback`. With no file here it rendered "Unmatched Route".
//
// Both deliveries can happen for one redirect, so the exchange in
// lib/oauthRedirect.ts is idempotent — see the comment on `exchanging` there.
import { useEffect, useRef } from 'react'
import * as Linking from 'expo-linking'
import { router, useLocalSearchParams } from 'expo-router'

import BrandSplash from '@/components/BrandSplash'
import { completeOAuthRedirect } from '@/lib/oauthRedirect'

/** Leave this screen no matter how it went: back to where the flow started, or
 *  to the root, which decides Login vs Hub from the session. */
function leave() {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

export default function AuthCallback() {
  // The ROUTER's parsed params, not Linking.useURL(), are the reliable source.
  // `useURL()` resolves getInitialURL(), which only reports the URL that
  // COLD-STARTED the app — on the warm start that Android's OAuth return
  // actually produces it is null, because the 'url' event fired before this
  // screen mounted to hear it. Reading it left the app parked on this splash
  // until the user pressed the system Back button.
  const params = useLocalSearchParams<{
    code?: string
    access_token?: string
    refresh_token?: string
    error?: string
    error_description?: string
  }>()
  const { code, access_token, refresh_token, error, error_description } = params
  // Kept only for the legacy implicit flow, where the tokens arrive in the URL
  // FRAGMENT and never become route params.
  const url = Linking.useURL()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries({
      code,
      access_token,
      refresh_token,
      error,
      error_description,
    })) {
      if (typeof v === 'string' && v) query.set(k, v)
    }
    const target = query.toString() ? `oneroof://auth-callback?${query.toString()}` : url
    if (!target) return
    handled.current = true
    void (async () => {
      try {
        await completeOAuthRedirect(target)
      } catch {
        // Leaving lands on the root route, which renders Login again when the
        // session didn't take, so the user can simply retry.
      }
      leave()
    })()
  }, [code, access_token, refresh_token, error, error_description, url])

  // This screen must never be terminal. If no code ever arrives — a malformed
  // redirect, or a warm start where the params didn't survive — go home rather
  // than leaving a spinner the only way out of which is the system Back button.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!handled.current) leave()
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  return <BrandSplash />
}
