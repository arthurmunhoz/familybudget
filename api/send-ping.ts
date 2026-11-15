// Vercel serverless: household push fan-out. Two actions on one endpoint (kept
// together because api/ is at Vercel's 12-function cap):
//   • default (body has ping_id): push a freshly-created ping to everyone in the
//     household EXCEPT the sender.
//   • action:'place-event' (body has place_event_id): push "Emma arrived at
//     School" ONLY to members who subscribed to that place (place_watchers,
//     migration 070) and asked about that member — never the whole household.
// Both rows are already inserted client-side under RLS; this only fans out the
// push. Auth: caller must send a valid Supabase JWT and own/belong to the row.
// KNOWN LIMIT: push copy is English-only (same as the daily digest).
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { timingSafeEqual } from 'node:crypto'

/** Constant-time compare for shared secrets (length is not secret). */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// Expo push, INLINE and self-contained — like ack-ping.ts, send-digest.ts and
// widget.ts. This was briefly extracted to a file outside api/ to avoid adding
// a 13th function to api/ (Vercel's Hobby cap). That broke production outright:
// Vercel bundles only what lives under api/, so the deployed function died at
// module load with
//   ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/api-shared/expoPush'
// and every nudge got a 500 before it ran a single line. A function in api/
// must import nothing from outside api/ — duplicate the helper instead.
//
// What this does that the old one-liner didn't: exp.host returns HTTP 200 even
// when every message in the batch failed. The real outcome is per-message, in
// the "tickets" array. `if (r.ok) sent += chunk.length` counted dead tokens as
// delivered and never pruned them.
//   • DeviceNotRegistered — app uninstalled, data cleared, or token rotated.
//   • InvalidCredentials  — Expo holds no FCM credentials for THAT token's app
//     (e.g. tokens minted by the old com.oneroof.app build).
// Both mean "never send here again", so both are pruned and the token list
// heals itself instead of silently eating a share of every send.
interface ExpoMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
  priority?: 'default' | 'normal' | 'high'
  /** ANDROID ONLY: importance lives on the channel, not the message. Must match
   *  ANDROID_CHANNEL in mobile/src/lib/notifications.ts (ids are versioned:
   *  raising a channel's importance requires a NEW id, so this must be updated
   *  in lockstep with the app or notifications land on a fallback channel). */
  channelId?: 'household' | 'urgent'
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

/** Expo answers a send in TWO stages: a ticket (accepted for delivery) and,
 *  later, a receipt (what FCM/APNs actually did with it). The single most
 *  important outcome — `DeviceNotRegistered` — arrives ONLY in the receipt; its
 *  ticket says `ok`. So checking tickets alone reports a phone that can receive
 *  nothing as a successful send, which is exactly how a total outage went
 *  unnoticed: measured 2026-08-30, every push to a Galaxy S9+ had been
 *  discarded since 08-27 while the tickets all read ok and the token was never
 *  pruned.
 *
 *  Receipts are not instant, so this waits briefly and reads ONCE. Anything not
 *  ready yet is simply left — the token stays and the next send gets another
 *  chance at it, so the list still heals itself within a few sends without
 *  holding a serverless function open for the 15 minutes Expo allows itself. */
const RECEIPT_DELAY_MS = 2000
/** getReceipts takes at most 1000 ids per call; stay well under. */
const RECEIPT_CHUNK = 300

interface Receipt {
  status?: string
  message?: string
  details?: { error?: string }
}

/** ticket id → the error its receipt reported. Absent = ok or not ready yet;
 *  the two are deliberately not distinguished, because both mean "do nothing". */
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

async function sendExpoPush(
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
  /** Accepted ticket id → the token it was for, so a receipt can be traced back
   *  to the registration that has to be pruned. */
  const pending = new Map<string, string>()

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
        const tok = chunk[idx]?.to
        if (ticket?.status === 'ok') {
          sent += 1
          // Provisionally sent. The receipt below is what settles it.
          if (ticket.id && tok) pending.set(ticket.id, tok)
          return
        }
        failed += 1
        const err = ticket?.details?.error
        if (tok && err && DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
      })
    } catch {
      failed += chunk.length
    }
  }

  // A ticket only says Expo took the message. Downgrade every send the receipt
  // reports as failed, and prune the tokens that failed permanently.
  for (const [id, err] of await fetchReceiptErrors(Array.from(pending.keys()))) {
    const tok = pending.get(id)
    if (!tok) continue
    sent -= 1
    failed += 1
    if (DEAD_TOKEN_ERRORS.has(err)) dead.push(tok)
  }

  if (dead.length && onDeadTokens) {
    // Pruning is best-effort: failing to clean up must never fail a send.
    await onDeadTokens(Array.from(new Set(dead))).catch(() => {})
  }
  return { sent, failed }
}

/** Delete tokens Expo told us are permanently unusable. */
function pruneDeadTokens(db: any) {
  return async (tokens: string[]) => {
    await db.from('expo_push_tokens').delete().in('token', tokens)
  }
}

// ── Several households per person (migration 099) ───────────────────────────
// Push registrations belong to a PERSON and are stamped with whichever
// household is ACTIVE, so recipients are resolved by EMAIL through
// household_members — never by the token's household_id, which would drop
// everyone currently looking at another of their households. Someone in more
// than one household sees the household's name on its pushes, and `household`
// rides in the data so a tap can switch to it. Each helper falls back to the
// pre-099 shape (allowed_users.household_id) when the table isn't there, so
// deploying this before the migration changes nothing.
// (Duplicated in send-digest.ts, widget.ts and ack-ping.ts ON PURPOSE — a file
// in api/ must import nothing from outside its own folder; see CLAUDE.md.)

/** Emails of a household's members. */
async function householdMembers(db: any, householdId: string): Promise<string[]> {
  const { data, error } = await db.from('household_members').select('email').eq('household_id', householdId)
  if (!error) return (data ?? []).map((r: any) => r.email as string)
  const { data: legacy } = await db.from('allowed_users').select('email').eq('household_id', householdId)
  return (legacy ?? []).map((r: any) => r.email as string)
}

/** Is `email` a member of `householdId`? */
async function isMember(db: any, email: string, householdId: string): Promise<boolean> {
  const { data, error } = await db
    .from('household_members')
    .select('email')
    .eq('household_id', householdId)
    .eq('email', email)
    .maybeSingle()
  if (!error) return !!data
  const { data: legacy } = await db.from('allowed_users').select('household_id').eq('email', email).maybeSingle()
  return legacy?.household_id === householdId
}

/** Of `emails`, the ones who belong to more than one household. */
async function multiHousehold(db: any, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set()
  const { data, error } = await db.from('household_members').select('email').in('email', emails)
  if (error) return new Set()
  const count = new Map<string, number>()
  for (const r of data ?? []) count.set(r.email, (count.get(r.email) ?? 0) + 1)
  return new Set([...count].filter(([, n]) => n > 1).map(([e]) => e))
}

async function householdName(db: any, householdId: string): Promise<string | null> {
  const { data } = await db.from('households').select('name').eq('id', householdId).maybeSingle()
  return (data?.name as string | undefined) || null
}

/** "👋 Ana" → "👋 Ana · Souza" for someone who is in several households. */
function labelled(title: string, name: string | null, multi: boolean): string {
  return multi && name ? `${title} · ${name}` : title
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

  // INTERNAL caller: the database itself, via the pg_net trigger + pg_cron
  // sweeper (migration 085). It presents INTERNAL_PUSH_SECRET — its own secret,
  // not the Cron one, so the two can be rotated independently — in place of a
  // user JWT.
  //
  // Why this exists: the fan-out used to depend on the SENDER'S PHONE surviving
  // a second round-trip after the insert. It often doesn't — an app suspended
  // the moment it is pocketed, or a headless geofence task torn down straight
  // after recording a crossing, both leave the row saved and the push never
  // asked for. Measured on 2026-09-04: 11 of one member's nudges over four days
  // reached nobody, with no request ever arriving here. Postgres has no such
  // problem, so the row itself now triggers the push.
  //
  // An internal call is trusted to name the row, and ONLY that: everything that
  // decides who hears about it — the household, the recipients list, the
  // place_watchers gate, the sender exclusion — is still read from the row
  // server-side, exactly as for a user call. The one-shot `pushed_at` claim
  // below is what keeps a trigger and the sweeper from double-pushing.
  const internalSecret = process.env.INTERNAL_PUSH_SECRET
  const internal = !!internalSecret && secretEquals(String(token ?? ''), internalSecret)

  let callerEmail = ''
  if (!internal) {
    // Identify the caller from their JWT.
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
    if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
    callerEmail = (await userRes.json())?.email
    if (!callerEmail) return res.status(401).json({ error: 'Unauthorized' })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── Game invite: "Arthur opened a Hangman room" (migration 091). The room row
  //    is inserted by game_create(); its AFTER INSERT trigger asks for this.
  //    Goes to every OTHER member of the household who hasn't switched game
  //    notifications off (user_settings.notify_games), in each one's language.
  if ((req.body?.action ?? '') === 'game-invite') {
    const sessionId = req.body?.game_session_id
    if (!sessionId) return res.status(400).json({ error: 'Missing game_session_id' })
    const { data: room } = await db
      .from('game_sessions')
      .select('id, household_id, host_email, game, mode, status, state, pushed_at')
      .eq('id', sessionId)
      .single()
    if (!room) return res.status(404).json({ error: 'Room not found' })
    if (!internal && room.host_email !== callerEmail) return res.status(403).json({ error: 'Forbidden' })
    // A live room is announced while it's still a lobby; a SENT hangman (mode
    // 'async', migration 092) goes straight into play and is announced then.
    const announceable = room.mode === 'async' ? room.status === 'playing' : room.status === 'lobby'
    if (room.pushed_at || !announceable) return res.status(200).json({ ok: true, skipped: 'already_pushed' })
    const { data: roomClaimed } = await db
      .from('game_sessions')
      .update({ pushed_at: new Date().toISOString() })
      .eq('id', room.id)
      .is('pushed_at', null)
      .select('id')
      .maybeSingle()
    if (!roomClaimed) return res.status(200).json({ ok: true, skipped: 'already_pushed' })

    // Members by membership (migration 099): someone looking at another of
    // their households still hears about this one.
    const memberEmails = await householdMembers(db, room.household_id)
    const { data: members } = await db.from('allowed_users').select('email, display_name').in('email', memberEmails)
    // Live room: everyone else. Sent hangman: only the person it was sent to.
    const others = memberEmails
      .filter((e: string) => e !== room.host_email)
      .filter((e: string) => room.mode !== 'async' || e === (room.state as any)?.guesser)
    if (!others.length) return res.status(200).json({ ok: true, skipped: true })
    const { data: prefs } = await db.from('user_settings').select('email, notify_games, language').in('email', others)
    const pref = new Map((prefs ?? []).map((p: any) => [p.email as string, p]))
    const recipients = others.filter((e: string) => pref.get(e)?.notify_games !== false)
    if (!recipients.length) return res.status(200).json({ ok: true, skipped: true })

    const host = (members ?? []).find((m: any) => m.email === room.host_email)
    const hostName = (host?.display_name || room.host_email.split('@')[0]).split(' ')[0]
    const GAME: Record<string, Record<string, string>> = {
      pt: { hangman: 'Forca', battleship: 'Batalha naval', quiz: 'Perguntas & Tortadas' },
      en: { hangman: 'Hangman', battleship: 'Battleship', quiz: 'Buzzer quiz' },
      es: { hangman: 'Ahorcado', battleship: 'Batalla naval', quiz: 'Quiz con timbre' },
    }
    const copy = (lang: string) => {
      const l = lang === 'pt' || lang === 'es' ? lang : 'en'
      const game = GAME[l][room.game] ?? room.game
      if (room.mode === 'async') {
        if (l === 'pt') return { title: `🎮 ${game}`, body: `${hostName} te desafiou na forca! Consegue adivinhar?` }
        if (l === 'es') return { title: `🎮 ${game}`, body: `¡${hostName} te desafió al ahorcado! ¿Lo adivinas?` }
        return { title: `🎮 ${game}`, body: `${hostName} challenged you to hangman! Can you guess it?` }
      }
      if (l === 'pt') return { title: `🎮 ${game}`, body: `${hostName} abriu uma sala. Bora jogar?` }
      if (l === 'es') return { title: `🎮 ${game}`, body: `${hostName} abrió una sala. ¿Jugamos?` }
      return { title: `🎮 ${game}`, body: `${hostName} opened a room. Want to play?` }
    }

    const { data: gameTokens } = await db
      .from('expo_push_tokens')
      .select('token, user_email')
      .in('user_email', recipients)
    const gameExpo = await sendExpoPush(
      (gameTokens ?? []).map((t: any) => {
        const { title, body } = copy(pref.get(t.user_email)?.language ?? 'en')
        return {
          to: t.token,
          title,
          body,
          data: { url: `/games/${room.id}` },
          sound: 'default' as const,
          priority: 'high' as const,
          channelId: 'household' as const,
        }
      }),
      pruneDeadTokens(db),
    )
    return res.status(200).json({ ok: true, expoSent: gameExpo.sent, expoFailed: gameExpo.failed })
  }

  // ── Game result: a SENT hangman was played (migration 092). Tells the sender
  //    how it went. Asked for by hangman_finish_round; one-shot on
  //    result_pushed_at. Sent regardless of notify_games: it answers something
  //    the sender did themselves, like a nudge's "seen by".
  if ((req.body?.action ?? '') === 'game-result') {
    const sessionId = req.body?.game_session_id
    if (!sessionId) return res.status(400).json({ error: 'Missing game_session_id' })
    if (!internal) return res.status(403).json({ error: 'Forbidden' })
    const { data: g } = await db
      .from('game_sessions')
      .select('id, household_id, host_email, mode, status, state, result_pushed_at')
      .eq('id', sessionId)
      .single()
    if (!g) return res.status(404).json({ error: 'Game not found' })
    if (g.mode !== 'async' || g.status !== 'done' || g.result_pushed_at) {
      return res.status(200).json({ ok: true, skipped: true })
    }
    const { data: resClaimed } = await db
      .from('game_sessions')
      .update({ result_pushed_at: new Date().toISOString() })
      .eq('id', g.id)
      .is('result_pushed_at', null)
      .select('id')
      .maybeSingle()
    if (!resClaimed) return res.status(200).json({ ok: true, skipped: 'already_pushed' })
    const st = (g.state ?? {}) as { guesser?: string; solved?: boolean; word?: string }
    const { data: who } = await db.from('allowed_users').select('display_name').eq('email', st.guesser ?? '').maybeSingle()
    const guesserName = (who?.display_name || (st.guesser ?? '').split('@')[0]).split(' ')[0]
    const { data: hostPref } = await db.from('user_settings').select('language').eq('email', g.host_email).maybeSingle()
    const l = hostPref?.language === 'pt' || hostPref?.language === 'es' ? hostPref.language : 'en'
    const word = (st.word ?? '').toUpperCase()
    const body =
      l === 'pt'
        ? st.solved ? `${guesserName} acertou seu desafio: ${word} 🎉` : `${guesserName} não acertou ${word}. A casa ficou pronta! 🏠`
        : l === 'es'
          ? st.solved ? `${guesserName} adivinó tu desafío: ${word} 🎉` : `${guesserName} no adivinó ${word}. ¡La casa quedó terminada! 🏠`
          : st.solved ? `${guesserName} beat your challenge: ${word} 🎉` : `${guesserName} missed ${word}. The house got finished! 🏠`
    const title = l === 'pt' ? '🎮 Forca' : l === 'es' ? '🎮 Ahorcado' : '🎮 Hangman'
    const { data: hostTokens } = await db
      .from('expo_push_tokens')
      .select('token')
      .eq('user_email', g.host_email)
    const resultExpo = await sendExpoPush(
      (hostTokens ?? []).map((t: any) => ({
        to: t.token,
        title,
        body,
        data: { url: `/games/${g.id}` },
        sound: 'default' as const,
        priority: 'high' as const,
        channelId: 'household' as const,
      })),
      pruneDeadTokens(db),
    )
    return res.status(200).json({ ok: true, expoSent: resultExpo.sent })
  }

  // ── Place event: "Emma arrived at School". The event row is already inserted
  //    by the crossing member's own device (RLS); this fans the push out to the
  //    rest of the household.
  if ((req.body?.action ?? '') === 'place-event') {
    const eventId = req.body?.place_event_id
    if (!eventId) return res.status(400).json({ error: 'Missing place_event_id' })

    const { data: ev } = await db
      .from('place_events')
      .select('id, household_id, place_id, user_email, type, pushed_at')
      .eq('id', eventId)
      .single()
    if (!ev) return res.status(404).json({ error: 'Event not found' })
    // Only the member the crossing belongs to may announce it — or the database
    // itself, which read the row it is announcing.
    if (!internal && ev.user_email !== callerEmail) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // One fan-out per crossing — same conditional-UPDATE claim as a nudge
    // (migration 085). Needed now that the row's own trigger announces it as
    // well as the phone that recorded it: whoever loses the update sends
    // nothing, so nobody hears "arrived at Home" twice.
    if (ev.pushed_at) return res.status(200).json({ ok: true, skipped: 'already_pushed' })
    const { data: evClaimed } = await db
      .from('place_events')
      .update({ pushed_at: new Date().toISOString() })
      .eq('id', ev.id)
      .is('pushed_at', null)
      .select('id')
      .maybeSingle()
    if (!evClaimed) return res.status(200).json({ ok: true, skipped: 'already_pushed' })

    const { data: place } = await db
      .from('places')
      .select('name, icon')
      .eq('id', ev.place_id)
      .single()
    if (!place) return res.status(404).json({ error: 'Place not found' })

    // Who actually asked to hear about this? Per-user subscriptions (migration
    // 070): opted into THIS place, wants THIS direction, and either watches
    // everyone (empty `watched`) or this member specifically. Never the mover
    // themselves. No subscribers → nobody is notified, which is the point:
    // creating a place must not sign the household up for alerts.
    const { data: watchers } = await db
      .from('place_watchers')
      .select('user_email, watched, notify_arrivals, notify_departures')
      .eq('place_id', ev.place_id)
    const placeMembers = new Set(await householdMembers(db, ev.household_id))
    const recipients = (watchers ?? [])
      .filter((w: any) => w.user_email !== ev.user_email)
      .filter((w: any) => placeMembers.has(w.user_email))
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

    // By person, not by the registration's household (see householdMembers).
    const placeMulti = await multiHousehold(db, recipients)
    const placeHhName = placeMulti.size ? await householdName(db, ev.household_id) : null
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_email')
      .in('user_email', recipients)

    webpush.setVapidDetails('mailto:one.roof.family.organizer@gmail.com', vapidPublic, vapidPrivate)
    let placeSent = 0
    const placeStale: string[] = []
    for (const s of subs ?? []) {
      const placePayload = JSON.stringify({
        title: labelled(title, placeHhName, placeMulti.has(s.user_email)),
        body,
        url: '/location',
        tag: `place-${ev.id}`,
      })
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
      .select('token, user_email')
      .in('user_email', recipients)
    const placeExpoSent = await sendExpoPush(
      (placeTokens ?? []).map((t: any) => ({
        to: t.token,
        title: labelled(title, placeHhName, placeMulti.has(t.user_email)),
        body,
        data: { url: '/location', household: ev.household_id },
        sound: 'default' as const,
        // FCM transport priority, NOT the channel's importance. Without it the
        // message is normal-priority, and Android parks normal-priority FCM in
        // Doze until the next maintenance window — an arrival alert that lands
        // an hour later, or only when the app is next opened, is worthless.
        // Measured on a Samsung S9+ (not on the device-idle whitelist, which is
        // the default): every place alert and ordinary nudge was deferred.
        priority: 'high' as const,
        channelId: 'household' as const,
      })),
      pruneDeadTokens(db),
    )
    return res.status(200).json({
      ok: true,
      sent: placeSent,
      expoSent: placeExpoSent.sent,
      expoFailed: placeExpoSent.failed,
    })
  }

  const { ping_id } = req.body ?? {}
  if (!ping_id) return res.status(400).json({ error: 'Missing ping_id' })

  const { data: ping } = await db
    .from('pings')
    .select(
      'id, household_id, sender_email, kind, emoji, message, recipients, high_priority, expires_at, pushed_at',
    )
    .eq('id', ping_id)
    .single()
  if (!ping) return res.status(404).json({ error: 'Ping not found' })

  // Only the nudge's own sender may trigger its fan-out. Every caller in the
  // app does exactly this (src/lib/pings.ts + mobile/src/lib/pings.ts insert the
  // ping and immediately post their own id; the widget in api/widget.ts pushes
  // inline and never calls this endpoint), so this is invisible in normal use —
  // it just stops another household member from re-firing someone else's nudge.
  // (The database is exempt: it read the row it is announcing — see `internal`.)
  if (!internal && ping.sender_email !== callerEmail) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // The caller must be a member of the ping's household.
  // (A membership, not the caller's ACTIVE household — they may have switched
  // since sending.)
  if (!internal && !(await isMember(db, callerEmail, ping.household_id))) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  // An expired nudge is already gone from every banner — never push it.
  if (ping.expires_at && new Date(ping.expires_at).getTime() <= Date.now()) {
    return res.status(200).json({ ok: true, skipped: 'expired' })
  }

  // One fan-out per nudge. `pushed_at` is claimed with a conditional UPDATE, so
  // a replay (or two devices racing) can't push the same ping twice: whoever
  // loses the update gets no row back and returns without sending.
  if (ping.pushed_at) return res.status(200).json({ ok: true, skipped: 'already_pushed' })
  const { data: claimed } = await db
    .from('pings')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', ping.id)
    .is('pushed_at', null)
    .select('id')
  if (!claimed || claimed.length === 0) {
    return res.status(200).json({ ok: true, skipped: 'already_pushed' })
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
  // excluding the sender's own devices. Resolved as PEOPLE (members of the
  // ping's household), so a member currently looking at another of their
  // households still gets it.
  const members = (await householdMembers(db, ping.household_id)).filter((e) => e !== ping.sender_email)
  const targets =
    Array.isArray(ping.recipients) && ping.recipients.length > 0
      ? members.filter((e) => (ping.recipients as string[]).includes(e))
      : members
  if (!targets.length) return res.status(200).json({ ok: true, sent: 0, expoSent: 0, expoFailed: 0 })
  const multi = await multiHousehold(db, targets)
  const hhName = multi.size ? await householdName(db, ping.household_id) : null
  const pingTitle = `${ping.emoji} ${senderName}`

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_email')
    .in('user_email', targets)

  webpush.setVapidDetails('mailto:one.roof.family.organizer@gmail.com', vapidPublic, vapidPrivate)

  let sent = 0
  const stale: string[] = []
  for (const s of subs ?? []) {
    const payload = JSON.stringify({
      title: labelled(pingTitle, hhName, multi.has(s.user_email)),
      body: ping.message,
      url: '/pings',
      tag: `ping-${ping.id}`,
      tel,
      // High-priority nudges are urgent: sound + persistent + vibrate (where
      // supported). Generalizes the old "Need help"-only behavior.
      urgent: ping.high_priority === true,
    })
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
  const { data: expoTokens } = await db
    .from('expo_push_tokens')
    .select('token, user_email')
    .in('user_email', targets)
  const expoSent = await sendExpoPush(
    (expoTokens ?? []).map((t: any) => ({
      to: t.token,
      title: labelled(pingTitle, hhName, multi.has(t.user_email)),
      body: ping.message,
      data: { url: '/pings', tel, household: ping.household_id },
      sound: 'default' as const,
      // priority is the FCM transport (beats Doze); channelId is how Android
      // presents it. Both nudges are high-priority to SEND — a nudge nobody
      // sees until they open the app is not a nudge — and only an urgent one
      // gets the louder channel.
      ...(ping.high_priority === true
        ? { priority: 'high' as const, channelId: 'urgent' as const }
        : { priority: 'high' as const, channelId: 'household' as const }),
    })),
    pruneDeadTokens(db),
  )

  // expoFailed is reported rather than hidden: a nudge that reached nobody used
  // to return the same 200 as one that reached everybody.
  return res.status(200).json({ ok: true, sent, expoSent: expoSent.sent, expoFailed: expoSent.failed })
}
