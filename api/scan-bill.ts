// Vercel serverless function: extracts itemized line items from a restaurant /
// store bill photo using Claude vision + structured outputs, so the app can
// split a bill item-by-item between people.
//
// Cost control (migration 032-034): HAIKU ONLY — do NOT add a fallback to Opus
// or any pricier model (owner decision, 2026-07: always the cheapest model). If
// Haiku finds no items, we return "try a clearer photo" instead of escalating.
// Every successful scan is metered PER HOUSEHOLD via the service-role RPCs
// ai_scan_allowed / ai_scan_record (free monthly cap + global daily-spend
// kill-switch).
//
// Env: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Auth: the caller must send a valid Supabase JWT.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const HAIKU = 'claude-haiku-4-5' // $1/$5 per 1M tokens — the ONLY model used

const RATES: Record<string, { in: number; out: number }> = {
  [HAIKU]: { in: 1 / 1e6, out: 5 / 1e6 },
}
function estCost(model: string, usage: any): number {
  const r = RATES[model] ?? RATES[HAIKU]
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  const output = usage?.output_tokens ?? 0
  return input * r.in + output * r.out
}

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

/** Normalize the model output into well-formed items + numeric tax/tip/total. */
function cleanBill(parsed: any) {
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
  return parsed
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Only an authenticated user (valid Supabase session) may burn API credits.
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
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
  const email = (await userRes.json())?.email
  if (!email) {
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
  if (!serviceKey) {
    return res.status(500).json({
      error: 'Bill scanning is not configured yet (missing service role).',
    })
  }

  // Resolve household + check the per-household cap / kill-switch before spending.
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await db
    .from('allowed_users')
    .select('household_id')
    .eq('email', email)
    .single()
  const household = caller?.household_id
  if (!household) {
    return res.status(403).json({ error: 'No household found for this account.' })
  }

  const { data: gate, error: gateErr } = await db.rpc('ai_scan_allowed', {
    p_household: household,
  })
  if (gateErr) {
    return res.status(503).json({ error: 'Scanning is temporarily unavailable.' })
  }
  if (!gate?.allowed) {
    const messages: Record<string, string> = {
      disabled: 'Scanning is temporarily paused. Please try again later.',
      daily_cap: 'Scanning is paused for today (daily limit reached). Try again tomorrow.',
      monthly_cap: `You've used all ${gate?.cap ?? ''} receipt/bill scans for this month.`,
      no_household: 'No household found for this account.',
    }
    return res
      .status(429)
      .json({ error: messages[gate?.reason] ?? 'Scanning is unavailable right now.', reason: gate?.reason })
  }

  try {
    const client = new Anthropic()

    async function extract(model: string) {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
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
      if (!text || text.type !== 'text') throw new Error('no_text')
      return { parsed: cleanBill(JSON.parse(text.text)), usage: response.usage }
    }

    // Haiku only — no items found fails with the friendly message below
    // (NO fallback to a pricier model; see the header comment).
    const usedModel = HAIKU
    const result = await extract(HAIKU) // may throw APIError -> mapped below
    if (result.parsed.items.length === 0) {
      return res.status(502).json({
        error: "Couldn't read that bill — try a clearer, well-lit photo.",
      })
    }

    try {
      await db.rpc('ai_scan_record', {
        p_household: household,
        p_kind: 'bill',
        p_cost: estCost(usedModel, result.usage),
      })
    } catch {
      /* metering write failure must not break a good scan */
    }

    return res.status(200).json(result.parsed)
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
