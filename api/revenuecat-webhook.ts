// RevenueCat webhook: the server source of truth for One Roof Plus entitlement.
// RevenueCat is configured with app_user_id = household_id, so every event names
// the household to update. We upsert public.household_subscriptions (service
// role — clients can't write it). `expires_at` is the real guard: household_is_plus
// checks `expires_at > now()`, so a lapsed subscription auto-downgrades even if a
// later event is missed.
//
// Setup (RevenueCat dashboard → Integrations → Webhooks):
//   URL:    https://one-roof-app.vercel.app/api/revenuecat-webhook
//   Header: Authorization: <REVENUECAT_WEBHOOK_SECRET>   (any strong random string)
// Env (Vercel): SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, REVENUECAT_WEBHOOK_SECRET.
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

/** Constant-time string compare for shared secrets (length is not secret). */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

const PLUS_ENTITLEMENT = 'plus'
const SANDBOX_GRANT_MS = 7 * 24 * 60 * 60 * 1000

// A well-formed UUID (our household_id). RevenueCat anonymous ids look like
// "$RCAnonymousID:..." and are ignored (no household to attach to yet).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Event types that mean "keep/refresh Plus". CANCELLATION means auto-renew was
// turned off but access continues until expiration_at_ms — so we keep Plus and
// let the future EXPIRATION event (or the expires_at guard) downgrade it.
const GRANT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'CANCELLATION',
  'BILLING_ISSUE',
  'TRANSFER',
])

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = process.env.REVENUECAT_WEBHOOK_SECRET
  const auth = String(req.headers.authorization ?? '')
  // Unset secret still fails closed; the compare itself is constant-time.
  if (!secret || !secretEquals(auth, secret)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Not configured' })
  }

  const event = req.body?.event
  if (!event || typeof event !== 'object') {
    return res.status(200).json({ ok: true, ignored: 'no-event' })
  }

  const householdId: string = event.app_user_id ?? ''
  if (!UUID_RE.test(householdId)) {
    // Anonymous / not-yet-identified purchaser — nothing to attach.
    return res.status(200).json({ ok: true, ignored: 'no-household' })
  }

  const type: string = event.type ?? ''
  const entitlements: string[] = Array.isArray(event.entitlement_ids)
    ? event.entitlement_ids
    : event.entitlement_id
      ? [event.entitlement_id]
      : []
  // If the event carries entitlement ids and ours isn't among them, it's for a
  // different product — ignore. (When absent, proceed; some event types omit it.)
  if (entitlements.length > 0 && !entitlements.includes(PLUS_ENTITLEMENT)) {
    return res.status(200).json({ ok: true, ignored: 'other-entitlement' })
  }

  const expiresAt =
    typeof event.expiration_at_ms === 'number'
      ? new Date(event.expiration_at_ms).toISOString()
      : null

  let plan: 'free' | 'plus'
  let expires: string | null
  if (type === 'EXPIRATION' || type === 'SUBSCRIPTION_PAUSED') {
    plan = 'free'
    expires = null
  } else if (GRANT_TYPES.has(type) || entitlements.includes(PLUS_ENTITLEMENT)) {
    plan = 'plus'
    expires = expiresAt // null for lifetime / non-renewing → permanent
  } else {
    // Unknown event with no signal — leave the row as-is.
    return res.status(200).json({ ok: true, ignored: `unhandled:${type}` })
  }

  // Sandbox purchases (TestFlight, store review, license testers) are real
  // enough to unlock Plus for testing, but never for good: a sandbox event
  // with no expiry gets a week, and one may never touch a family that has a
  // live PRODUCTION subscription.
  const sandbox = String(event.environment ?? '').toUpperCase() === 'SANDBOX'
  if (sandbox && plan === 'plus' && !expires) expires = new Date(Date.now() + SANDBOX_GRANT_MS).toISOString()
  const eventMs = typeof event.event_timestamp_ms === 'number' ? event.event_timestamp_ms : null

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: current } = await db
    .from('household_subscriptions')
    .select('plan, expires_at, environment, last_event_ms')
    .eq('household_id', householdId)
    .maybeSingle()
  // Webhooks can arrive late or be retried: never let an older event
  // overwrite what a newer one already set.
  if (eventMs !== null && typeof current?.last_event_ms === 'number' && eventMs < current.last_event_ms) {
    return res.status(200).json({ ok: true, ignored: 'stale' })
  }
  const liveProduction =
    current?.environment === 'PRODUCTION' &&
    current.plan === 'plus' &&
    (!current.expires_at || new Date(current.expires_at).getTime() > Date.now())
  if (sandbox && liveProduction) return res.status(200).json({ ok: true, ignored: 'sandbox-over-production' })

  const { error } = await db.from('household_subscriptions').upsert(
    {
      household_id: householdId,
      plan,
      product: event.product_id ?? null,
      store: event.store ?? null,
      expires_at: expires,
      environment: sandbox ? 'SANDBOX' : 'PRODUCTION',
      last_event_ms: eventMs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'household_id' },
  )
  if (error) {
    // 200 so RevenueCat doesn't hammer retries on a bad household_id (FK miss);
    // real outages still surface in logs.
    return res.status(200).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, household: householdId, plan })
}
