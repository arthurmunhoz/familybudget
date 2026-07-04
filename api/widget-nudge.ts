// Vercel serverless: send a household nudge from the Home-Screen widget. Auth is
// the per-device WIDGET TOKEN (not a Supabase session) — see migration 045's
// widget_tokens + widget_token() RPC. Resolves the token → sender + household,
// inserts the ping (service role), then fans out web + Expo push to the chosen
// recipients (or the whole household), excluding the sender. Mirrors send-ping.
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

async function sendExpoPush(
  messages: { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: 'default' }[],
): Promise<number> {
  const valid = messages.filter((m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'))
  let sent = 0
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100)
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!url || !serviceKey) return res.status(500).json({ error: 'Not configured' })

  const { token, kind, emoji, message, recipients } = req.body ?? {}
  if (!token || typeof token !== 'string' || !kind || !message) {
    return res.status(400).json({ error: 'Missing fields' })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Resolve the widget token → sender + household.
  const { data: wt } = await db
    .from('widget_tokens')
    .select('user_email, household_id')
    .eq('token', token)
    .maybeSingle()
  if (!wt) return res.status(401).json({ error: 'Invalid token' })
  const senderEmail: string = wt.user_email
  const household: string = wt.household_id

  // "Need help" always goes to everyone (parity with the app).
  const targetList: string[] | null =
    kind === 'help' || !Array.isArray(recipients) || recipients.length === 0
      ? null
      : recipients.filter((r: unknown) => typeof r === 'string')

  const { data: ping, error: insErr } = await db
    .from('pings')
    .insert({
      household_id: household,
      sender_email: senderEmail,
      kind,
      emoji: typeof emoji === 'string' && emoji ? emoji : '📣',
      message,
      recipients: targetList,
    })
    .select('id')
    .single()
  if (insErr || !ping) return res.status(500).json({ error: 'Could not send' })

  void db.from('widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token', token)

  // Sender name + phone for the notification + Call affordance.
  const { data: sender } = await db
    .from('allowed_users')
    .select('display_name')
    .eq('email', senderEmail)
    .maybeSingle()
  const senderName = sender?.display_name || senderEmail.split('@')[0]
  const { data: senderProfile } = await db
    .from('member_profiles')
    .select('phone')
    .eq('email', senderEmail)
    .maybeSingle()
  const tel = senderProfile?.phone || null
  const title = `${emoji || '📣'} ${senderName}`

  // Web push (best-effort; skipped if VAPID isn't configured).
  if (vapidPublic && vapidPrivate) {
    let query = db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('household_id', household)
      .neq('user_email', senderEmail)
    if (targetList) query = query.in('user_email', targetList)
    const { data: subs } = await query
    webpush.setVapidDetails('mailto:arthurmunhoz@hotmail.com', vapidPublic, vapidPrivate)
    const payload = JSON.stringify({
      title,
      body: message,
      url: '/pings',
      tag: `ping-${ping.id}`,
      tel,
      urgent: kind === 'help',
    })
    const stale: string[] = []
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.endpoint)
      }
    }
    if (stale.length) await db.from('push_subscriptions').delete().in('endpoint', stale)
  }

  // Native (Expo) push.
  let expoQuery = db
    .from('expo_push_tokens')
    .select('token')
    .eq('household_id', household)
    .neq('user_email', senderEmail)
  if (targetList) expoQuery = expoQuery.in('user_email', targetList)
  const { data: expoTokens } = await expoQuery
  const expoSent = await sendExpoPush(
    (expoTokens ?? []).map((tk: any) => ({
      to: tk.token,
      title,
      body: message,
      data: { url: '/pings', tel },
      sound: 'default' as const,
    })),
  )

  return res.status(200).json({ ok: true, ping: ping.id, expoSent })
}
