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
async function sendSilentExpoPush(
  messages: { to: string; data: Record<string, unknown> }[],
): Promise<number> {
  const valid = messages.filter((m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'))
  let sent = 0
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
      if (r.ok) sent += chunk.length
    } catch {
      /* swallow */
    }
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
  )

  return res.status(200).json({ ok: true, expoSent })
}
