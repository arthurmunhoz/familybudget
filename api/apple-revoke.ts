// Called during account deletion to revoke the user's Apple token — required by
// Apple for apps offering Sign in with Apple (Guideline 5.1.1(v)). Reads the
// stored refresh token (service role), asks Apple to revoke it, then deletes the
// row. Best-effort: returns ok even if there's nothing to revoke or Apple env
// isn't set yet, so the account-deletion flow never gets stuck.
//
// Env (Vercel): same as apple-connect.ts (APPLE_TEAM_ID, APPLE_KEY_ID,
// APPLE_CLIENT_ID, APPLE_PRIVATE_KEY + Supabase URL/anon/service role).
// NOTE: untested end-to-end — verify on a device once the Apple key is set.
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

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
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
