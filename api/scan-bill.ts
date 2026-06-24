// Vercel serverless function: extracts itemized line items from a restaurant /
// store bill photo using Claude vision + structured outputs, so the app can
// split a bill item-by-item between people. Requires ANTHROPIC_API_KEY in the
// Vercel environment. Auth: the caller must send a valid Supabase JWT.
import Anthropic from '@anthropic-ai/sdk'

const BILL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Each ordered line item with its charged price',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              "Short item name as printed. If quantity > 1, prefix it, e.g. '2× Tacos'.",
          },
          price: {
            type: 'number',
            description:
              'The line total for this item in the bill currency (quantity already multiplied in), as a plain number.',
          },
        },
        required: ['name', 'price'],
        additionalProperties: false,
      },
    },
    tax: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
      description: 'Tax amount as a plain number, or null if not shown',
    },
    tip: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
      description: 'Tip / gratuity / service charge amount, or null if not shown',
    },
    total: {
      anyOf: [{ type: 'number' }, { type: 'null' }],
      description: 'Grand total paid, or null if not shown',
    },
  },
  required: ['items', 'tax', 'tip', 'total'],
  additionalProperties: false,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Only an authenticated user (valid Supabase session) may burn API credits.
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!supabaseUrl || !anonKey || !token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { image, media_type } = req.body ?? {}
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Bill scanning is not configured yet (missing ANTHROPIC_API_KEY).',
    })
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      // Adaptive thinking: reading cramped itemized receipts, merging wrapped
      // lines, and separating items from subtotal/tax/tip benefits from a
      // little reasoning.
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: media_type ?? 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: [
                'This is a photo of an itemized restaurant or store bill to split between people.',
                'Extract every ordered line item with its charged price (the line total, with quantity already multiplied in — if a line shows "2 Tacos 8.00" use price 8.00 and name "2× Tacos").',
                'Do NOT include subtotal, tax, tip, gratuity, service charge, or grand-total lines among the items.',
                'Return tax, tip (gratuity/service charge), and the grand total separately, or null if a value is not printed.',
                'All prices as plain numbers in the bill currency.',
              ].join('\n'),
            },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: BILL_SCHEMA },
      },
    })

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      return res.status(502).json({ error: 'Could not read the bill.' })
    }
    const parsed = JSON.parse(text.text)
    // Defensive: keep only well-formed items with a finite price.
    parsed.items = Array.isArray(parsed.items)
      ? parsed.items
          .filter(
            (it: any) => it && typeof it.name === 'string' && Number.isFinite(it.price),
          )
          .map((it: any) => ({ name: it.name.trim(), price: Number(it.price) }))
      : []
    for (const k of ['tax', 'tip', 'total']) {
      parsed[k] = Number.isFinite(parsed[k]) ? Number(parsed[k]) : null
    }
    return res.status(200).json(parsed)
  } catch (err: any) {
    if (err instanceof Anthropic.APIError) {
      const msg = err.message ?? ''
      if (/credit balance|billing/i.test(msg)) {
        return res.status(502).json({
          error:
            'Bill scanning is paused — the AI account is out of credits. Add credits at console.anthropic.com and try again.',
        })
      }
      if (err.status === 401 || err.status === 403) {
        return res.status(502).json({
          error: 'Bill scanning is misconfigured — the API key is invalid.',
        })
      }
      if (err.status === 429 || err.status === 529) {
        return res.status(502).json({
          error: 'The scanner is busy right now — try again in a minute.',
        })
      }
    }
    return res.status(502).json({
      error: "Couldn't read that bill — try a clearer, well-lit photo.",
    })
  }
}
