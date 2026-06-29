// Vercel serverless function: extracts expense data from a receipt photo
// using Claude vision + structured outputs.
//
// Cost control (migration 032-034): tries the cheap Haiku 4.5 model first and
// only falls back to Opus 4.8 (with adaptive thinking) when Haiku's result is
// unparseable/implausible. Every successful scan is metered PER HOUSEHOLD via
// the service-role RPCs ai_scan_allowed / ai_scan_record, which enforce a free
// monthly cap and a global daily-spend kill-switch.
//
// Env: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Auth: the caller must send a valid Supabase JWT.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const HAIKU = 'claude-haiku-4-5' // primary: $1/$5 per 1M tokens, no thinking
const OPUS = 'claude-opus-4-8' // fallback: $5/$25 per 1M, adaptive thinking

// $ per token (input, output) — keep in sync with the model pricing.
const RATES: Record<string, { in: number; out: number }> = {
  [HAIKU]: { in: 1 / 1e6, out: 5 / 1e6 },
  [OPUS]: { in: 5 / 1e6, out: 25 / 1e6 },
}
function estCost(model: string, usage: any): number {
  const r = RATES[model] ?? RATES[OPUS]
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  const output = usage?.output_tokens ?? 0
  return input * r.in + output * r.out
}

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

/** Is Haiku's result good enough, or should we escalate to Opus? */
function plausible(p: any): boolean {
  return (
    p &&
    typeof p.amount === 'number' &&
    Number.isFinite(p.amount) &&
    p.amount > 0 &&
    typeof p.category === 'string' &&
    (CATEGORIES as readonly string[]).includes(p.category)
  )
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
      error: 'Receipt scanning is not configured yet (missing ANTHROPIC_API_KEY).',
    })
  }
  if (!serviceKey) {
    return res.status(500).json({
      error: 'Receipt scanning is not configured yet (missing service role).',
    })
  }

  // Resolve the caller's household server-side and check the per-household cap +
  // global kill-switch BEFORE spending any AI credits. Both RPCs are
  // service-role-only so clients can't tamper with the counters.
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
      const isOpus = model === OPUS
      const response = await client.messages.create({
        model,
        max_tokens: isOpus ? 4096 : 1024,
        // Opus gets adaptive thinking for hard/awkward receipts; Haiku (a 4.5-tier
        // model) does not support adaptive thinking — omit it for the cheap path.
        ...(isOpus ? { thinking: { type: 'adaptive' as const } } : {}),
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
      if (!text || text.type !== 'text') throw new Error('no_text')
      return { parsed: JSON.parse(text.text), usage: response.usage }
    }

    // Haiku first; escalate to Opus only if it failed or returned junk.
    let result: { parsed: any; usage: any } | null = null
    let usedModel = HAIKU
    try {
      const r = await extract(HAIKU)
      if (plausible(r.parsed)) result = r
    } catch {
      result = null
    }
    if (!result) {
      result = await extract(OPUS) // may throw APIError -> mapped below
      usedModel = OPUS
    }

    const parsed = result.parsed
    parsed.date = normalizeDate(parsed.date)
    parsed.subcategory =
      typeof parsed.subcategory === 'string' ? parsed.subcategory.trim() || null : null

    // Meter the successful scan (best-effort — never fail the response on this).
    try {
      await db.rpc('ai_scan_record', {
        p_household: household,
        p_kind: 'receipt',
        p_cost: estCost(usedModel, result.usage),
      })
    } catch {
      /* metering write failure must not break a good scan */
    }

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
