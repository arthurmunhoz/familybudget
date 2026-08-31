// Vercel serverless: silent/background push fan-out. Two actions on one endpoint
// (kept together because api/ is at Vercel's 12-function cap):
//   • default (body has ping_id): notify a ping's sender when someone acks it, so
//     their iOS Nudges widget can flash "{emoji} {label} · seen by {name}".
//   • action:'live-wake' (body has target_email): a watcher opened a member's
//     Whereabouts detail — wake that member's device to refresh its location
//     (live mode). See mobile/src/lib/backgroundNotifications.ts for the receiving
//     side of BOTH. Auth: caller must send a valid Supabase JWT and share the
//     relevant household — same pattern as send-ping.ts.
import { createClient } from '@supabase/supabase-js'

// Silent/background push only: no title/body/sound, so it never shows a
// visible banner — it exists purely to wake the app and update the widget.
/** Ticket errors that mean the token is permanently unusable. Anything else
 *  (rate limits, a message too big) is transient or our fault, not the token's,
 *  so it must NOT cost the user their registration. */
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials'])
/** Receipts are not instant. Wait once, read what is ready, and leave the rest —
 *  the next send gets another chance, so the token list still heals. */
const RECEIPT_DELAY_MS = 2000
/** getReceipts takes at most 1000 ids per call; stay well under. */
const RECEIPT_CHUNK = 300

interface Ticket {
  status?: string
  id?: string
  details?: { error?: string }
}

interface Receipt {
  status?: string
  details?: { error?: string }
}

/** ticket id -> the error its receipt reported. Absent means ok OR not ready
 *  yet; the two are deliberately not distinguished, because both mean "do
 *  nothing". See api/send-ping.ts for why receipts matter at all: exp.host
 *  answers a send with a ticket that says `ok` even for a device that can
 *  receive nothing — DeviceNotRegistered only ever shows up in the receipt. */
async function fetchReceiptErrors(ticketIds: string[]): Promise<Map<string, string>> {
  const errors = new Map<string, string>()
  if (!ticketIds.length) return errors
  await new Promise((resolve) => setTimeout(resolve, RECEIPT_DELAY_MS))

  for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: ticketIds.slice(i, i + RECEIPT_CHUNK) }),
      })
      if (!r.ok) continue
      const body = (await r.json().catch(() => null)) as { data?: Record<string, Receipt> } | null
      for (const [id, receipt] of Object.entries(body?.data ?? {})) {
        if (receipt?.status === 'error') errors.set(id, receipt?.details?.error ?? 'Unknown')
      }
    } catch {
      // A receipt we could not read is not evidence of anything — leave it.
    }
  }
  return errors
}

/** Delete tokens Expo told us are permanently unusable. */
function pruneDeadTokens(db: any) {
  return async (tokens: string[]) => {
    await db.from('expo_push_tokens').delete().in('token', tokens)
  }
}

async function sendSilentExpoPush(
  messages: { to: string; data: Record<string, unknown> }[],
  /** Called with tokens Expo says are permanently unusable, so they can be
   *  deleted. Optional so a caller with no database handle can still send. */
  onDeadTokens?: (tokens: string[]) => Promise<void>,
): Promise<number> {
  const valid = messages.filter((m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'))
  let sent = 0
  const dead: string[] = []
  /** Accepted ticket id -> the token it was for, so a receipt can be traced
   *  back to the registration that has to be pruned. */
  const pending = new Map<string, string>()
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100).map((m) => ({
      to: m.to,
      data: m.data,
      _contentAvailable: true,
      priority: 'high' as const,
    }))
    try {
      const r = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      })
      // HTTP 200 means Expo took the batch, NOT that any message was accepted:
      // the per-message outcome is in `tickets`. `if (r.ok) sent += chunk.length`
      // counted dead tokens as delivered and never pruned them.
      if (!r.ok) continue
      const body = (await r.json().catch(() => null)) as { data?: Ticket[] } | null
      const tickets = body?.data
      if (!Array.isArray(tickets)) continue
      tickets.forEach((ticket, idx) => {
        const tok = chunk[idx]?.to
        if (ticket?.status === 'ok') {
          sent += 1
          // Provisionally sent. The receipt below is what settles it.
          if (ticket.id && tok) pending.set(ticket.id, tok)
          return
        }
        const err = ticket?.details?.error
        if (tok && err && DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
      })
    } catch {
      /* swallow */
    }
  }

  // A ticket only says Expo took the message. Drop every send the receipt
  // rejects, and prune the tokens that failed permanently.
  for (const [id, err] of await fetchReceiptErrors(Array.from(pending.keys()))) {
    const tok = pending.get(id)
    if (!tok) continue
    sent -= 1
    if (DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
  }
  if (dead.length && onDeadTokens) {
    // Pruning is best-effort: failing to clean up must never fail a send.
    await onDeadTokens(Array.from(new Set(dead))).catch(() => {})
  }
  return sent
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!url || !anonKey || !token) return res.status(401).json({ error: 'Unauthorized' })
  if (!serviceKey) return res.status(500).json({ error: 'Not configured' })

  // Identify the caller (the acker) from their JWT.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const callerEmail = (await userRes.json())?.email
  if (!callerEmail) return res.status(401).json({ error: 'Unauthorized' })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── Live-mode wake: nudge a member's device (silently) to wake + refresh its
  //    location because someone is watching them in Whereabouts.
  if ((req.body?.action ?? '') === 'live-wake') {
    const target = req.body?.target_email
    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: 'Missing target_email' })
    }
    const { data: me } = await db
      .from('allowed_users')
      .select('household_id, display_name')
      .eq('email', callerEmail)
      .single()
    const { data: tgt } = await db
      .from('allowed_users')
      .select('household_id')
      .eq('email', target)
      .single()
    if (!me || !tgt || me.household_id !== tgt.household_id) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { data: tokens } = await db
      .from('expo_push_tokens')
      .select('token')
      .eq('user_email', target)
    const expoSent = await sendSilentExpoPush(
      (tokens ?? []).map((t: any) => ({
        to: t.token,
        data: { type: 'live-wake', by: me.display_name || callerEmail.split('@')[0] },
      })),
      pruneDeadTokens(db),
    )
    return res.status(200).json({ ok: true, expoSent })
  }

  const { ping_id } = req.body ?? {}
  if (!ping_id) return res.status(400).json({ error: 'Missing ping_id' })

  const { data: ping } = await db
    .from('pings')
    .select('id, household_id, sender_email, emoji, message')
    .eq('id', ping_id)
    .single()
  if (!ping) return res.status(404).json({ error: 'Ping not found' })

  // The caller must be a member of the ping's household.
  const { data: caller } = await db
    .from('allowed_users')
    .select('household_id, display_name')
    .eq('email', callerEmail)
    .single()
  if (!caller || caller.household_id !== ping.household_id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // No-op if the sender acked their own nudge — nothing useful to tell them.
  if (ping.sender_email === callerEmail) return res.status(200).json({ ok: true, expoSent: 0 })

  // The ack must actually exist. ackPing() inserts the ping_acks row (under RLS)
  // and only then calls this endpoint, so a legitimate call always finds it —
  // but without this check anyone in the household could spam a sender's device
  // with "seen by" pushes for acks that never happened.
  const { data: ack } = await db
    .from('ping_acks')
    .select('ping_id')
    .eq('ping_id', ping.id)
    .eq('user_email', callerEmail)
    .maybeSingle()
  if (!ack) return res.status(403).json({ error: 'No ack recorded' })

  const ackerName = caller.display_name || callerEmail.split('@')[0]

  const { data: senderTokens } = await db
    .from('expo_push_tokens')
    .select('token')
    .eq('user_email', ping.sender_email)
  const expoSent = await sendSilentExpoPush(
    (senderTokens ?? []).map((t: any) => ({
      to: t.token,
      data: { type: 'ack', pingId: ping.id, emoji: ping.emoji, label: ping.message, ackerName },
    })),
    pruneDeadTokens(db),
  )

  return res.status(200).json({ ok: true, expoSent })
}
