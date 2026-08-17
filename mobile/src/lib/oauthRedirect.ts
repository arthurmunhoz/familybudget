// Finishing an OAuth redirect from the in-app browser.
//
// The client runs the authorization-code + PKCE flow (see lib/supabase.ts), so
// Supabase hands back `?code=` and we exchange it for a session. The older
// implicit flow returned `access_token`/`refresh_token` in the URL fragment;
// that path is kept so a redirect already in flight during an app upgrade — or
// any provider that still answers that way — completes instead of dead-ending.
import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'

/** Merge the query string and the fragment of a callback URL into one bag.
 *  Supabase puts the PKCE `code` in the query and implicit tokens in the
 *  fragment, so we read both rather than guessing which shape arrived. */
function callbackParams(url: string): URLSearchParams {
  const out = new URLSearchParams()
  const [head, hash] = url.split('#')
  const query = head.includes('?') ? head.slice(head.indexOf('?') + 1) : ''
  for (const src of [query, hash ?? '']) {
    if (!src) continue
    for (const [k, v] of new URLSearchParams(src)) out.set(k, v)
  }
  return out
}

/** The exchange in flight (or the last one done), kept so a redirect delivered
 *  TWICE is only exchanged once.
 *
 *  Android delivers it twice: the `oneroof://auth-callback` intent reopens the
 *  app — which `app/auth-callback.tsx` handles — AND `openAuthSessionAsync`
 *  resolves with the same URL. A PKCE code is single-use, so whichever caller
 *  lost that race would get "invalid request" and report a failed sign-in.
 *  Sharing one promise also keeps `provider_refresh_token` reachable for the
 *  Google Calendar connect flow: those tokens exist only on the session the one
 *  exchange returned, so a second caller must get that same session back rather
 *  than a fresh `getSession()` (which has no provider tokens). */
let exchanging: { code: string; session: Promise<Session | null> } | null = null

async function exchange(code: string): Promise<Session | null> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) throw error
  return data.session
}

/** Complete the redirect and return the resulting session (null if the URL
 *  carried neither a code nor tokens). Throws if the provider reported an
 *  error or the exchange failed. Safe to call twice with the same URL. */
export async function completeOAuthRedirect(url: string): Promise<Session | null> {
  const params = callbackParams(url)

  const code = params.get('code')
  if (code) {
    if (exchanging?.code !== code) exchanging = { code, session: exchange(code) }
    return exchanging.session
  }

  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (access_token && refresh_token) {
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) throw error
    return data.session
  }

  const failure = params.get('error_description') ?? params.get('error')
  if (failure) throw new Error(failure)
  return null
}
