// Sign in with Apple — capture the refresh token so we can revoke it on account
// deletion (Apple review requirement). After a successful native Apple sign-in
// the app POSTs the one-time { code } (expo-apple-authentication's
// credential.authorizationCode) here with the user's Supabase JWT; we exchange it
// with Apple for a refresh_token and store it (service role only).
//
// Env (Vercel): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID (= the iOS bundle id,
// e.g. com.oneroof.app), APPLE_PRIVATE_KEY (the .p8 file contents; if you paste it
// with literal \n escapes that's fine, we un-escape), plus VITE_SUPABASE_URL,
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
    const db = createClient(url, serviceKey, { auth: { persistSession: false } })
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
