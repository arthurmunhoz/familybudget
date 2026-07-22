// Vercel serverless: suggest the biggest household-shopping store chains for
// the caller's location. Location comes from Vercel's IP-geo headers
// (x-vercel-ip-city / -country / -country-region) — no device GPS permission
// needed — with an optional {country, city} body fallback (dev / VPN edge
// cases). Claude Haiku returns ~12 chains with brand-ish colors; the app shows
// them in the store picker. Auth: valid Supabase JWT (same as suggest-ping).
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// Abuse ceiling only (migration 083) — NOT a product quota. A household doing
// this all day long wouldn't come close; it exists so a leaked JWT can't run up
// an AI bill. Metering problems fail OPEN (see below): a suggestion is never
// blocked because the counter misbehaved.
const DAILY_CAP = 120
const HAIKU_RATE = { in: 1 / 1e6, out: 5 / 1e6 } // $/token, claude-haiku-4-5
function estCost(usage: any): number {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  return input * HAIKU_RATE.in + (usage?.output_tokens ?? 0) * HAIKU_RATE.out
}

const STORES_SCHEMA = {
  type: 'object',
  properties: {
    stores: {
      type: 'array',
      description: 'The biggest store chains for household shopping in this area, most popular first.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: "The chain's common short name as locals write it, e.g. 'Pão de Açúcar', 'Publix', 'Mercadona'.",
          },
          color: {
            type: 'string',
            description: "The brand's primary color as a 6-digit hex like #007A33 (best guess).",
          },
        },
        required: ['name', 'color'],
        additionalProperties: false,
      },
    },
  },
  required: ['stores'],
  additionalProperties: false,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!supabaseUrl || !anonKey || !token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const email = (await userRes.json())?.email
  if (!email) return res.status(401).json({ error: 'Unauthorized' })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Store suggestions are not configured.' })
  }

  // Vercel IP geo (city is URL-encoded, e.g. "S%C3%A3o%20Paulo"). A malformed
  // percent-sequence makes decodeURIComponent throw a URIError — fall back to
  // the raw header rather than 500-ing the request.
  const hdr = (k: string) => {
    const v = req.headers[k]
    if (typeof v !== 'string' || !v) return null
    try {
      return decodeURIComponent(v)
    } catch {
      return v
    }
  }
  // Anything client-supplied is bounded before it reaches the prompt.
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)
  const body = req.body ?? {}
  const country = clean(hdr('x-vercel-ip-country') ?? body.country)
  const city = clean(hdr('x-vercel-ip-city') ?? body.city)
  const region = clean(hdr('x-vercel-ip-country-region'))
  if (!country && !city) {
    return res.status(200).json({ stores: [], location: null })
  }
  const place = [city, region, country].filter(Boolean).join(', ')

  // Cost metering (best-effort, fails OPEN). Resolves the caller's household
  // server-side and checks the service-role-only ceiling before spending.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null
  let household: string | null = null
  if (db) {
    try {
      const { data: caller } = await db
        .from('allowed_users')
        .select('household_id')
        .eq('email', email)
        .maybeSingle()
      household = caller?.household_id ?? null
      if (household) {
        const { data: gate, error: gateErr } = await db.rpc('ai_light_allowed', {
          p_household: household,
          p_kind: 'stores',
          p_cap: DAILY_CAP,
        })
        // Only an EXPLICIT "no" blocks; an RPC error leaves the feature working.
        if (!gateErr && gate && gate.allowed === false) {
          return res.status(429).json({ error: 'Store suggestions are paused for now — try again later.' })
        }
      }
    } catch {
      /* metering must never block a legitimate request */
    }
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            `List the 12 biggest store chains where a family living in ${place} actually does its household shopping.`,
            'Cover the everyday mix: supermarkets/grocery first, then wholesale/club, pharmacy, and one or two general/home stores.',
            'Only real, well-known chains with physical stores in that specific area — national chains that operate there count; chains from other countries do not.',
            'Use the common short name locals use. Most popular first.',
          ].join('\n'),
        },
      ],
      output_config: { format: { type: 'json_schema', schema: STORES_SCHEMA } },
    })
    if (db && household) {
      try {
        await db.rpc('ai_light_record', {
          p_household: household,
          p_kind: 'stores',
          p_cost: estCost(response.usage),
        })
      } catch {
        /* metering write failure must not break a good response */
      }
    }
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') throw new Error('no_text')
    const parsed = JSON.parse(text.text)
    const stores = (Array.isArray(parsed.stores) ? parsed.stores : [])
      .filter((s: any) => s && typeof s.name === 'string' && s.name.trim())
      .slice(0, 14)
      .map((s: any) => ({
        name: s.name.trim(),
        color: typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color.trim()) ? s.color.trim() : null,
      }))
    return res.status(200).json({ stores, location: place })
  } catch {
    return res.status(502).json({ error: 'Could not load suggestions right now.' })
  }
}
