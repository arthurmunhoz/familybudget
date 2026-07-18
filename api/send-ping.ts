// Vercel serverless: household push fan-out. Two actions on one endpoint (kept
// together because api/ is at Vercel's 12-function cap):
//   • default (body has ping_id): push a freshly-created ping to everyone in the
//     household EXCEPT the sender.
//   • action:'place-event' (body has place_event_id): push "Emma arrived at
//     School" ONLY to members who subscribed to that place (place_watchers,
//     migration 069) and asked about that member — never the whole household.
// Both rows are already inserted client-side under RLS; this only fans out the
// push. Auth: caller must send a valid Supabase JWT and own/belong to the row.
// KNOWN LIMIT: push copy is English-only (same as the daily digest).
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Best-effort Expo (native) push, sent alongside web-push. Errors swallowed so
// a push failure never breaks the request. Only well-formed Expo tokens are sent.
async function sendExpoPush(
  messages: { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: 'default' }[],
): Promise<number> {
  const valid = messages.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken'),
  )
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
    return res.status(500).json({ error: 'Pings are not configured (missing env).' })
  }

  // Identify the caller from their JWT.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const callerEmail = (await userRes.json())?.email
  if (!callerEmail) return res.status(401).json({ error: 'Unauthorized' })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── Place event: "Emma arrived at School". The event row is already inserted
  //    by the crossing member's own device (RLS); this fans the push out to the
  //    rest of the household.
  if ((req.body?.action ?? '') === 'place-event') {
    const eventId = req.body?.place_event_id
    if (!eventId) return res.status(400).json({ error: 'Missing place_event_id' })

    const { data: ev } = await db
      .from('place_events')
      .select('id, household_id, place_id, user_email, type')
      .eq('id', eventId)
      .single()
    if (!ev) return res.status(404).json({ error: 'Event not found' })
    // Only the member the crossing belongs to may announce it.
    if (ev.user_email !== callerEmail) return res.status(403).json({ error: 'Forbidden' })

    const { data: place } = await db
      .from('places')
      .select('name, icon')
      .eq('id', ev.place_id)
      .single()
    if (!place) return res.status(404).json({ error: 'Place not found' })

    // Who actually asked to hear about this? Per-user subscriptions (migration
    // 069): opted into THIS place, wants THIS direction, and either watches
    // everyone (empty `watched`) or this member specifically. Never the mover
    // themselves. No subscribers → nobody is notified, which is the point:
    // creating a place must not sign the household up for alerts.
    const { data: watchers } = await db
      .from('place_watchers')
      .select('user_email, watched, notify_arrivals, notify_departures')
      .eq('place_id', ev.place_id)
    const recipients = (watchers ?? [])
      .filter((w: any) => w.user_email !== ev.user_email)
      .filter((w: any) => (ev.type === 'arrive' ? w.notify_arrivals : w.notify_departures))
      .filter(
        (w: any) =>
          !Array.isArray(w.watched) || w.watched.length === 0 || w.watched.includes(ev.user_email),
      )
      .map((w: any) => w.user_email as string)
    if (!recipients.length) return res.status(200).json({ ok: true, skipped: true })

    const { data: mover } = await db
      .from('allowed_users')
      .select('display_name')
      .eq('email', ev.user_email)
      .single()
    const moverName = mover?.display_name || ev.user_email.split('@')[0]
    const title = `${place.icon || '📍'} ${place.name}`
    const body = ev.type === 'arrive' ? `${moverName} arrived` : `${moverName} left`

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('household_id', ev.household_id)
      .in('user_email', recipients)

    webpush.setVapidDetails('mailto:one.roof.family.organizer@gmail.com', vapidPublic, vapidPrivate)
    const placePayload = JSON.stringify({ title, body, url: '/location', tag: `place-${ev.id}` })
    let placeSent = 0
    const placeStale: string[] = []
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          placePayload,
        )
        placeSent++
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) placeStale.push(s.endpoint)
      }
    }
    if (placeStale.length) await db.from('push_subscriptions').delete().in('endpoint', placeStale)

    const { data: placeTokens } = await db
      .from('expo_push_tokens')
      .select('token')
      .eq('household_id', ev.household_id)
      .in('user_email', recipients)
    const placeExpoSent = await sendExpoPush(
      (placeTokens ?? []).map((t: any) => ({
        to: t.token,
        title,
        body,
        data: { url: '/location' },
        sound: 'default' as const,
      })),
    )
    return res.status(200).json({ ok: true, sent: placeSent, expoSent: placeExpoSent })
  }

  const { ping_id } = req.body ?? {}
  if (!ping_id) return res.status(400).json({ error: 'Missing ping_id' })

  const { data: ping } = await db
    .from('pings')
    .select('id, household_id, sender_email, kind, emoji, message, recipients, high_priority')
    .eq('id', ping_id)
    .single()
  if (!ping) return res.status(404).json({ error: 'Ping not found' })

  // The caller must be a member of the ping's household.
  const { data: caller } = await db
    .from('allowed_users')
    .select('household_id')
    .eq('email', callerEmail)
    .single()
  if (!caller || caller.household_id !== ping.household_id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { data: sender } = await db
    .from('allowed_users')
    .select('display_name')
    .eq('email', ping.sender_email)
    .single()
  const senderName = sender?.display_name || ping.sender_email.split('@')[0]

  // Sender's phone (from the Family feature) powers the "Call" affordance.
  const { data: senderProfile } = await db
    .from('member_profiles')
    .select('phone')
    .eq('email', ping.sender_email)
    .maybeSingle()
  const tel = senderProfile?.phone || null

  // Recipients: targeted list if set, otherwise the whole household — always
  // excluding the sender's own devices.
  let query = db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('household_id', ping.household_id)
    .neq('user_email', ping.sender_email)
  if (Array.isArray(ping.recipients) && ping.recipients.length > 0) {
    query = query.in('user_email', ping.recipients)
  }
  const { data: subs } = await query

  webpush.setVapidDetails('mailto:one.roof.family.organizer@gmail.com', vapidPublic, vapidPrivate)
  const payload = JSON.stringify({
    title: `${ping.emoji} ${senderName}`,
    body: ping.message,
    url: '/pings',
    tag: `ping-${ping.id}`,
    tel,
    // High-priority nudges are urgent: sound + persistent + vibrate (where
    // supported). Generalizes the old "Need help"-only behavior.
    urgent: ping.high_priority === true,
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

  // Native (Expo) devices for the same recipients — best-effort, alongside web push.
  let expoQuery = db
    .from('expo_push_tokens')
    .select('token')
    .eq('household_id', ping.household_id)
    .neq('user_email', ping.sender_email)
  if (Array.isArray(ping.recipients) && ping.recipients.length > 0) {
    expoQuery = expoQuery.in('user_email', ping.recipients)
  }
  const { data: expoTokens } = await expoQuery
  const expoSent = await sendExpoPush(
    (expoTokens ?? []).map((t: any) => ({
      to: t.token,
      title: `${ping.emoji} ${senderName}`,
      body: ping.message,
      data: { url: '/pings', tel },
      sound: 'default' as const,
    })),
  )

  return res.status(200).json({ ok: true, sent, expoSent })
}
