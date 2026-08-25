// Asking the server to fan a freshly-inserted row out as a push.
//
// Nudges (lib/pings.ts) and place alerts (lib/places.ts) both work the same
// way: INSERT the row under RLS, then make a second, authenticated call so the
// server can push it to the right people. Both used to wrap that call in
// `try { ... } catch { /* best-effort */ }` with no logging and no retry.
//
// That hid a total outage. Measured on 2026-08-25: 100 nudges since June, and
// `pings.pushed_at` — which the endpoint sets the moment it accepts one — was
// NULL on every single row, on both platforms. So no nudge had ever been
// pushed, while the app looked healthy the whole time, because the nudge still
// appears instantly for everyone over Realtime. The push is the only part that
// was missing, and it is the only part with no UI.
//
// So: same best-effort contract (never throw into a send), but the outcome is
// recorded through `track()`, which lands in `web_events` where it can actually
// be read, and a transport failure gets one retry. If this ever goes quiet
// again, `select * from web_events where type = 'push.fanout.failed'` says why.
import { track } from './analytics'
import { supabase } from './supabase'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''
/** A phone on a dying connection must not hold a send open indefinitely. */
const TIMEOUT_MS = 12_000

async function post(body: unknown, token: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}/api/send-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Fire the server-side push fan-out. Never throws — the row is already saved
 *  and visible over Realtime; this only decides whether phones buzz.
 *  `what` labels the analytics event ('nudge' | 'place-event'). */
export async function requestPushFanout(body: unknown, what: string): Promise<void> {
  // getSession(), never getUser(): the latter round-trips to the Auth server and
  // resolves null on any hiccup, which would look exactly like being signed out.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  if (!API_BASE) {
    track('push.fanout.failed', { what, reason: 'no-api-base' })
    return
  }
  if (!token) {
    track('push.fanout.failed', { what, reason: 'no-token' })
    return
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post(body, token)
      if (res.ok) {
        if (attempt > 0) track('push.fanout.retried', { what })
        return
      }
      // A 4xx is a real answer — retrying it would only repeat the rejection.
      // Record the status so the reason is visible instead of guessed at.
      const detail = await res.text().catch(() => '')
      if (res.status < 500) {
        track('push.fanout.failed', { what, status: res.status, detail: detail.slice(0, 120) })
        return
      }
      if (attempt === 1) {
        track('push.fanout.failed', { what, status: res.status, detail: detail.slice(0, 120) })
      }
    } catch (e: unknown) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 120) : 'unknown'
      if (attempt === 1) track('push.fanout.failed', { what, reason })
    }
  }
}
