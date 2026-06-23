// Vercel serverless: push a freshly-created household signal to everyone in the
// household EXCEPT the sender. The signal row is already inserted client-side
// under RLS; this just fans out the web-push. Auth: caller must send a valid
// Supabase JWT and belong to the signal's household.
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!url || !anonKey || !token) return res.status(401).json({ error: 'Unauthorized' })
  if (!serviceKey || !vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: 'Signals are not configured (missing env).' })
  }

  // Identify the caller from their JWT.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const callerEmail = (await userRes.json())?.email
  if (!callerEmail) return res.status(401).json({ error: 'Unauthorized' })

  const { signal_id } = req.body ?? {}
  if (!signal_id) return res.status(400).json({ error: 'Missing signal_id' })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: signal } = await db
    .from('signals')
    .select('id, household_id, sender_email, emoji, message')
    .eq('id', signal_id)
    .single()
  if (!signal) return res.status(404).json({ error: 'Signal not found' })

  // The caller must be a member of the signal's household.
  const { data: caller } = await db
    .from('allowed_users')
    .select('household_id')
    .eq('email', callerEmail)
    .single()
  if (!caller || caller.household_id !== signal.household_id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { data: sender } = await db
    .from('allowed_users')
    .select('display_name')
    .eq('email', signal.sender_email)
    .single()
  const senderName = sender?.display_name || signal.sender_email.split('@')[0]

  // Everyone in the household except the sender's own devices.
  const { data: subs } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('household_id', signal.household_id)
    .neq('user_email', signal.sender_email)

  webpush.setVapidDetails('mailto:arthur@peek.us', vapidPublic, vapidPrivate)
  const payload = JSON.stringify({
    title: `${signal.emoji} ${senderName}`,
    body: signal.message,
    url: '/',
    tag: `signal-${signal.id}`,
  })

  let sent = 0
  const stale: string[] = []
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
      sent++
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) stale.push(s.endpoint)
    }
  }
  if (stale.length) await db.from('push_subscriptions').delete().in('endpoint', stale)

  return res.status(200).json({ ok: true, sent })
}
