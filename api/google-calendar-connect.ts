// Vercel serverless: store the Google OAuth tokens the client captured right
// after the "Connect Google Calendar" consent redirect. The client can't write
// these (RLS denies it); only this service-role endpoint can. Auth: caller must
// send a valid Supabase JWT — we link the connection to THAT user.
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!url || !anonKey || !token) return res.status(401).json({ error: 'Unauthorized' })
  if (!serviceKey) return res.status(500).json({ error: 'Not configured (missing service key).' })

  // Identify the caller from their JWT.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const callerEmail = (await userRes.json())?.email
  if (!callerEmail) return res.status(401).json({ error: 'Unauthorized' })

  const { access_token, refresh_token, expires_in, google_email, calendar_id } = req.body ?? {}
  if (!access_token) return res.status(400).json({ error: 'Missing access_token' })
  // A refresh token is what makes long-lived sync possible. It only comes back
  // with access_type=offline + prompt=consent; if it's missing, tell the client
  // to re-run consent rather than silently storing a connection we can't refresh.
  if (!refresh_token) {
    return res.status(400).json({ error: 'No refresh token returned — please reconnect.' })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await db
    .from('allowed_users')
    .select('household_id')
    .eq('email', callerEmail)
    .single()
  if (!caller) return res.status(403).json({ error: 'Forbidden' })

  const expiry = new Date(Date.now() + (Number(expires_in) || 3500) * 1000).toISOString()

  const { error } = await db.from('google_calendar_connections').upsert(
    {
      user_email: callerEmail,
      household_id: caller.household_id,
      google_email: google_email ?? callerEmail,
      access_token,
      refresh_token,
      token_expiry: expiry,
      calendar_id: calendar_id || 'primary',
      connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: 'user_email' },
  )
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true })
}
