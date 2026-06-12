// Vercel serverless function: extracts expense data from a receipt photo
// using Claude vision + structured outputs. Requires ANTHROPIC_API_KEY in
// the Vercel environment. Auth: the caller must send a valid Supabase JWT.
import Anthropic from '@anthropic-ai/sdk'

const CATEGORIES = [
  'groceries',
  'dining',
  'transport',
  'home',
  'utilities',
  'health',
  'entertainment',
  'shopping',
  'travel',
  'subscriptions',
  'gifts',
  'pets',
  'other',
] as const

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description:
        "Short human-friendly description, preferring the merchant name, e.g. 'Safeway' or 'Shell Gas'",
    },
    amount: {
      type: 'number',
      description: 'Final total paid, in dollars',
    },
    date: {
      anyOf: [
        { type: 'string', description: 'Purchase date as YYYY-MM-DD' },
        { type: 'null' },
      ],
      description: 'Purchase date, or null if not visible on the receipt',
    },
    category: { type: 'string', enum: [...CATEGORIES] },
  },
  required: ['label', 'amount', 'date', 'category'],
  additionalProperties: false,
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Only the two allowed users (valid Supabase session) may burn API credits.
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
      error: 'Receipt scanning is not configured yet (missing ANTHROPIC_API_KEY).',
    })
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
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
              text: 'This is a photo of a purchase receipt. Extract the merchant/label, the final total paid in dollars, the purchase date, and the best-fitting spending category.',
            },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: RECEIPT_SCHEMA },
      },
    })

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      return res.status(502).json({ error: 'Could not read the receipt.' })
    }
    return res.status(200).json(JSON.parse(text.text))
  } catch (err: any) {
    // Map raw API failures to messages that make sense in the app's UI.
    if (err instanceof Anthropic.APIError) {
      const msg = err.message ?? ''
      if (/credit balance|billing/i.test(msg)) {
        return res.status(502).json({
          error:
            'Receipt scanning is paused — the AI account is out of credits. Add credits at console.anthropic.com and try again.',
        })
      }
      if (err.status === 401 || err.status === 403) {
        return res.status(502).json({
          error: 'Receipt scanning is misconfigured — the API key is invalid.',
        })
      }
      if (err.status === 429 || err.status === 529) {
        return res.status(502).json({
          error: 'The scanner is busy right now — try again in a minute.',
        })
      }
    }
    return res.status(502).json({
      error: "Couldn't read that receipt — try a clearer, well-lit photo.",
    })
  }
}
