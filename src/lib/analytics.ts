import { supabase } from './supabase'

/**
 * Lightweight behavioral analytics. Events are buffered and flushed in
 * batches (every 10s, when the buffer fills, or when the app goes to the
 * background) so tracking costs ~zero extra requests during normal use.
 * Analytics must never break the app: every failure is swallowed.
 */

interface EventInsert {
  user_email: string
  session_id: string
  type: string
  path: string | null
  target: string | null
  meta?: Record<string, unknown>
}

let email: string | null = null
let buffer: EventInsert[] = []
let flushTimer: number | null = null
let listenersInstalled = false

/** One session per app open (survives SPA reloads via sessionStorage). */
function sessionId(): string {
  let id = sessionStorage.getItem('oneroof-session')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('oneroof-session', id)
  }
  return id
}

async function flush(useBeacon = false) {
  if (!buffer.length) return
  const batch = buffer
  buffer = []
  if (flushTimer != null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    if (useBeacon) {
      // keepalive lets the request finish while iOS suspends the PWA
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/web_events`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(batch),
      })
    } else {
      await supabase.from('web_events').insert(batch)
    }
  } catch {
    // drop the batch — analytics never interrupts the user
  }
}

export function track(
  type: string,
  fields: { path?: string; target?: string; meta?: Record<string, unknown> } = {},
) {
  if (!email) return
  buffer.push({
    user_email: email,
    session_id: sessionId(),
    type,
    path: fields.path ?? window.location.pathname,
    target: fields.target ?? null,
    meta: fields.meta,
  })
  if (buffer.length >= 20) flush()
  else if (flushTimer == null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      flush()
    }, 10_000)
  }
}

export function trackPageView(path: string) {
  track('page_view', { path })
}

/** Report a crash/error. Flushes immediately — the page may be about to die. */
export function trackError(error: unknown, extra: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  track('error', {
    target: err.message.slice(0, 200),
    meta: { stack: err.stack?.slice(0, 2000), ...extra },
  })
  flush(true)
}

export function initAnalytics(userEmail: string) {
  email = userEmail
  if (listenersInstalled) return
  listenersInstalled = true

  if (!sessionStorage.getItem('oneroof-session-started')) {
    sessionStorage.setItem('oneroof-session-started', '1')
    track('session_start', {
      meta: {
        standalone: window.matchMedia('(display-mode: standalone)').matches,
      },
    })
  }

  // Generic click capture: nearest button/link label tells us what gets used.
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button, a')
      if (!el) return
      const label = (el.getAttribute('aria-label') || el.textContent || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      if (label) track('click', { target: label })
    },
    { capture: true },
  )

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
}
