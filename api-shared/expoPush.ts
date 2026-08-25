// Expo push, with the response actually read.
//
// exp.host returns HTTP 200 even when every message in the batch failed: the
// real outcome is per-message, in the "tickets" array it returns. All four
// senders in api/ did `if (r.ok) sent += chunk.length`, so a totally broken
// push was indistinguishable from a working one, and dead tokens were never
// cleaned up.
//
// Measured on this project's own data (2026-08-25), one phone had three token
// rows and only one of them worked:
//   • DeviceNotRegistered — app uninstalled, data cleared, or token rotated.
//   • InvalidCredentials  — Expo holds no FCM credentials for THAT token's app.
//     Real cause here: tokens minted by the old `com.oneroof.app` build, whose
//     credentials live under a different application identifier entirely.
// Both mean "never send here again", so both are reported for pruning and the
// token list heals itself instead of silently eating a share of every send.
//
// NOTE: this file lives OUTSIDE api/ on purpose. Vercel turns every file in
// api/ into a serverless function and the Hobby plan caps that at 12 — which
// this project is exactly at. Shared code must not live there.
export interface ExpoMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
  priority?: 'default' | 'normal' | 'high'
  /** ANDROID ONLY: importance lives on the channel, not the message. Must match
   *  ANDROID_CHANNEL in mobile/src/lib/notifications.ts. */
  channelId?: 'default' | 'urgent'
}

interface Ticket {
  status?: string
  id?: string
  message?: string
  details?: { error?: string }
}

/** Ticket errors that mean the token is permanently unusable. Anything else
 *  (rate limits, a message too big) is transient or our fault, not the token's,
 *  so it must NOT cost the user their registration. */
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials'])

export async function sendExpoPush(
  messages: ExpoMessage[],
  /** Called with tokens that should be deleted. Optional so callers that have
   *  no database handle can still send. */
  onDeadTokens?: (tokens: string[]) => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  const valid = messages.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'),
  )
  let sent = 0
  let failed = 0
  const dead: string[] = []

  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      })
      if (!r.ok) {
        failed += chunk.length
        continue
      }
      const body = (await r.json().catch(() => null)) as { data?: Ticket[] } | null
      const tickets = body?.data
      if (!Array.isArray(tickets)) {
        // Shouldn't happen, but an unreadable body is not proof of delivery.
        failed += chunk.length
        continue
      }
      tickets.forEach((ticket, idx) => {
        if (ticket?.status === 'ok') {
          sent += 1
          return
        }
        failed += 1
        const err = ticket?.details?.error
        const token = chunk[idx]?.to
        if (token && err && DEAD_TOKEN_ERRORS.has(err)) dead.push(token)
      })
    } catch {
      failed += chunk.length
    }
  }

  if (dead.length && onDeadTokens) {
    // Pruning is best-effort: failing to clean up must never fail a send.
    await onDeadTokens(Array.from(new Set(dead))).catch(() => {})
  }
  return { sent, failed }
}
