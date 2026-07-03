// Vercel serverless: suggest the biggest household-shopping store chains for
// the caller's location. Location comes from Vercel's IP-geo headers
// (x-vercel-ip-city / -country / -country-region) — no device GPS permission
// needed — with an optional {country, city} body fallback (dev / VPN edge
// cases). Claude Haiku returns ~12 chains with brand-ish colors; the app shows
// them in the store picker. Auth: valid Supabase JWT (same as suggest-ping).
import Anthropic from '@anthropic-ai/sdk'

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Store suggestions are not configured.' })
  }

  // Vercel IP geo (city is URL-encoded, e.g. "S%C3%A3o%20Paulo").
  const hdr = (k: string) => {
    const v = req.headers[k]
    return typeof v === 'string' && v ? decodeURIComponent(v) : null
  }
  const body = req.body ?? {}
  const country = hdr('x-vercel-ip-country') ?? (typeof body.country === 'string' ? body.country : null)
  const city = hdr('x-vercel-ip-city') ?? (typeof body.city === 'string' ? body.city : null)
  const region = hdr('x-vercel-ip-country-region')
  if (!country && !city) {
    return res.status(200).json({ stores: [], location: null })
  }
  const place = [city, region, country].filter(Boolean).join(', ')

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
