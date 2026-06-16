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
        { type: 'string', description: 'Purchase date as YYYY-MM-DD, zero-padded' },
        { type: 'null' },
      ],
      description: 'Purchase date, or null if not visible on the receipt',
    },
    category: { type: 'string', enum: [...CATEGORIES] },
    subcategory: {
      anyOf: [
        {
          type: 'string',
          description:
            "A short, specific subcategory inferred from the line items, e.g. 'Produce', 'Gas', 'Pharmacy', 'Clothing'. One or two words.",
        },
        { type: 'null' },
      ],
      description:
        'A specific subcategory when the items clearly point to one, otherwise null',
    },
  },
  required: ['label', 'amount', 'date', 'category', 'subcategory'],
  additionalProperties: false,
}

/** Coerce whatever the model returned into a strict, zero-padded YYYY-MM-DD
 *  (or null). The date field on the form does a lexicographic period check and
 *  the native date input needs exact padding, so an unpadded "2026-6-9" must
 *  be normalized or it gets silently dropped. */
function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const mm = mo.padStart(2, '0')
  const dd = d.padStart(2, '0')
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null
  return `${y}-${mm}-${dd}`
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
      max_tokens: 4096,
      // Adaptive thinking: reading small/awkward receipt dates and inferring a
      // subcategory from line items benefits from a little reasoning.
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
                'This is a photo of a purchase receipt. Extract:',
                '- label: the merchant name',
                '- amount: the final total paid, in dollars',
                '- date: the purchase/transaction date, converted to YYYY-MM-DD with zero-padded month and day (e.g. a receipt showing 6/9/26 becomes 2026-06-09). Null only if no date is visible.',
                '- category: the best-fitting spending category',
                "- subcategory: a short, specific subcategory inferred from the line items when they clearly point to one (e.g. 'Produce' for groceries, 'Gas' for fuel, 'Pharmacy' for a drugstore), otherwise null.",
              ].join('\n'),
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
    const parsed = JSON.parse(text.text)
    parsed.date = normalizeDate(parsed.date)
    parsed.subcategory =
      typeof parsed.subcategory === 'string' ? parsed.subcategory.trim() || null : null
    return res.status(200).json(parsed)
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
