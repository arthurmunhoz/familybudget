// Sign in with Apple server bits, both actions in one function:
//   ?action=connect — capture the refresh token after a native Apple sign-in so
//                     we can revoke it later (Apple review requirement).
//   ?action=revoke  — revoke + delete it during account deletion (Guideline
//                     5.1.1(v)).
//
// MERGED from api/apple-connect.ts + api/apple-revoke.ts to stay under Vercel
// Hobby's 12-function cap. The ORIGINAL URLs (/api/apple-connect,
// /api/apple-revoke) still work — vercel.json rewrites them here with ?action=…
// — because the shipped App Store build calls those paths and can't be changed.
// Don't "tidy" those rewrites away.
//
// Env (Vercel): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID (= the iOS bundle
// id, e.g. com.oneroof.app), APPLE_PRIVATE_KEY (the .p8 file contents; literal
// \n escapes are fine, we un-escape), plus VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. NOTE: untested end-to-end —
// verify on a device once the Apple key + env vars are set.
import { createClient } from '@supabase/supabase-js'
import { SignJWT, importPKCS8 } from 'jose'

async function appleClientSecret(): Promise<string> {
  const teamId = process.env.APPLE_TEAM_ID
  const keyId = process.env.APPLE_KEY_ID
  const clientId = process.env.APPLE_CLIENT_ID
  const pem = (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!teamId || !keyId || !clientId || !pem) throw new Error('Apple env not configured')
  const key = await importPKCS8(pem, 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(key)
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // The rewrite supplies ?action=…; allow a body action too for direct callers.
  const action = String(req.query?.action ?? req.body?.action ?? '')

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!url || !anonKey || !serviceKey || !token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const email = (await userRes.json())?.email
  if (!email) return res.status(401).json({ error: 'Unauthorized' })

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── connect ───────────────────────────────────────────────────────────────
  if (action === 'connect') {
    const { code } = req.body ?? {}
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Missing code' })
    try {
      const clientSecret = await appleClientSecret()
      const body = new URLSearchParams({
        client_id: process.env.APPLE_CLIENT_ID as string,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      })
      const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      const data: any = await tokenRes.json()
      if (!tokenRes.ok || !data.refresh_token) {
        return res.status(502).json({ error: 'Apple token exchange failed', detail: data?.error })
      }
      await db.from('apple_refresh_tokens').upsert({
        user_email: email,
        refresh_token: data.refresh_token,
        updated_at: new Date().toISOString(),
      })
      return res.status(200).json({ ok: true })
    } catch (e: any) {
      // Not configured yet (no Apple key) — don't hard-fail sign-in; just skip.
      return res.status(200).json({ ok: false, reason: e?.message ?? 'not configured' })
    }
  }

  // ── revoke ────────────────────────────────────────────────────────────────
  if (action === 'revoke') {
    const { data } = await db
      .from('apple_refresh_tokens')
      .select('refresh_token')
      .eq('user_email', email)
      .maybeSingle()

    if (data?.refresh_token) {
      try {
        const clientSecret = await appleClientSecret()
        const body = new URLSearchParams({
          client_id: process.env.APPLE_CLIENT_ID as string,
          client_secret: clientSecret,
          token: data.refresh_token,
          token_type_hint: 'refresh_token',
        })
        await fetch('https://appleid.apple.com/auth/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
      } catch {
        /* best-effort — Apple env may not be set yet */
      }
      await db.from('apple_refresh_tokens').delete().eq('user_email', email)
    }
    return res.status(200).json({ ok: true })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
