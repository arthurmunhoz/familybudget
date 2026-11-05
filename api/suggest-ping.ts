// Vercel serverless: turn a family member's free-text note into a household
// "ping" — {kind, emoji, message}. Used by the Pings sheet's "just type it"
// box. Auth: the caller must send a valid Supabase JWT (don't burn AI credits
// for strangers). Uses a small/fast model — this is a trivial mapping task.
//
// `?action=assistant` (folded in here because api/ is at Vercel Hobby's
// 12-function cap): the Home's "ask anything" bar. The model ONLY parses the
// request into an intent ({add_items | agenda | unknown} + slots); the app
// then carries it out with the user's OWN Supabase session, so RLS stays the
// boundary and nothing here writes household data with the service role.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// Abuse ceiling only (migration 083) — NOT a product quota, and deliberately
// separate from the scanners' ai_scan_allowed free_monthly_cap. A household
// typing nudges all day wouldn't come close to this; it exists so a leaked JWT
// can't run up an AI bill. Metering problems fail OPEN — a real nudge is never
// blocked because the counter misbehaved.
const DAILY_CAP = 200
const HAIKU_RATE = { in: 1 / 1e6, out: 5 / 1e6 } // $/token, claude-haiku-4-5
function estCost(usage: any): number {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  return input * HAIKU_RATE.in + (usage?.output_tokens ?? 0) * HAIKU_RATE.out
}

const KINDS = ['help', 'omw', 'late', 'dinner', 'grab', 'love', 'custom'] as const

const PING_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [...KINDS],
      description:
        "Closest ping kind: help=needs a hand, omw=on my way/heading home, late=running late, dinner=food/meal is ready, grab=asking someone to buy or bring something, love=affection or checking in, custom=anything else.",
    },
    emoji: { type: 'string', description: 'A single emoji that fits the message.' },
    message: {
      type: 'string',
      description:
        'A short household ping, at most ~6 words, in the SAME language as the input note. No quotes, no trailing punctuation.',
    },
  },
  required: ['kind', 'emoji', 'message'],
  additionalProperties: false,
}

// The Home assistant's parse: one structured-output call, no tools. "" / [] / 0
// stand in for "not given" so every field can stay required/non-null. The app
// carries each intent out itself (lib/assistant.ts) with the user's session.
const INTENTS = [
  'add_items',
  'list_items',
  'find_items',
  'check_items',
  'remove_items',
  'agenda',
  'add_event',
  'add_money',
  'money_summary',
  'send_nudge',
  'pets_due',
  'family_info',
  'open_app',
  'split_bill',
  'discount',
  'unknown',
] as const
const APPS = ['calendar', 'shopping', 'budget', 'pets', 'pings', 'location', 'family', 'docs', 'calc', 'settings', '']
const FIELDS = ['phone', 'blood_type', 'height', 'weight', 'shoe_size', 'pants_size', 'shirt_size', 'allergies', 'birthday', '']
const ASSISTANT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [...INTENTS],
      description: [
        'add_items = put things on a shopping list.',
        'list_items = asks what is on the shopping list (all of it, or one store).',
        'find_items = asks whether specific things are on the list ("is there coconut water on the list?", "tem leite na lista?").',
        'check_items = STATES items were bought / are in the cart ("já comprei o leite"). A question is never check_items.',
        'remove_items = take items off the shopping list.',
        'agenda = asks what is on the calendar for a day.',
        'add_event = schedule something on the calendar.',
        'add_money = record money spent or received ("gastei 50 no mercado", "recebi o salário 3000").',
        'money_summary = asks how much was spent / is left / the balance.',
        'send_nudge = send a message to family members ("avisa o Léo que chego 19h").',
        'pets_due = asks what a pet needs / what pet care is due or left today ("o que a Lola precisa hoje?", "what\'s next for Chloe?", "a Chloe já comeu?") — daily routine items not done yet count.',
        'family_info = asks a stored detail about a family member (shoe size, blood type, allergies, phone, birthday...).',
        'open_app = asks to open a part of the app.',
        'split_bill = split a bill / restaurant check / total among people ("divide 58,71 em 3", "split the check").',
        'discount = the price after a percentage off ("quanto fica 80 com 30% de desconto").',
        'unknown = anything else.',
      ].join(' '),
    },
    items: {
      type: 'array',
      items: { type: 'string' },
      description:
        'add_items: each product as its own short item, capitalised, in the language the user said it ("Leite", "Óleo de cozinha"). ' +
        'find_items / check_items / remove_items: the EXACT labels from OPEN ITEMS that the user means — match by meaning in any language ' +
        '("coconut water" = "Agua de coco 🥥", "milk" = "Leite integral"); [] when nothing on the list matches. Empty otherwise.',
    },
    store: {
      type: 'string',
      description:
        'Shopping intents: the STORE named, matched to KNOWN STORES when it is the same store (return that exact spelling), else as written. A generic list ("lista de compras", "shopping list", "a lista", "mercado" without a store name) is NOT a store: return "". "" when none was named.',
    },
    scope: {
      type: 'string',
      enum: ['me', 'all', 'person'],
      description: 'agenda: me = the asker, all = everyone/the family, person = one named member. Default me.',
    },
    person: {
      type: 'string',
      description:
        'agenda (scope=person) / send_nudge (recipient) / family_info (whose detail) / add_event (whose event): a member name exactly as in MEMBERS. "" = the asker for family_info and add_event, everyone for send_nudge.',
    },
    date: {
      type: 'string',
      description:
        'agenda / add_event / add_money: the day as YYYY-MM-DD resolved from TODAY ("amanhã", "sexta", "dia 12"). TODAY when no day was named.',
    },
    date_end: {
      type: 'string',
      description:
        'agenda: the LAST day (YYYY-MM-DD) when the question covers a period, not a day: "this month" → last day of this month, ' +
        '"this week" → the coming Sunday, "next weeks" / "próximas semanas" → 21 days after TODAY, "next 10 days" → TODAY + 10. ' +
        'For a period that includes today, `date` is TODAY (what is still coming). Same as `date` for a single day.',
    },
    time: { type: 'string', description: 'add_event: start time as HH:MM (24h) when said, else "".' },
    title: {
      type: 'string',
      description:
        'add_event: the event title ("Dentista"). add_money: what it was ("Mercado", "Salário"). send_nudge: the message to send, in the user language, first person, short ("Chego às 19h"). "" otherwise.',
    },
    amount: {
      type: 'number',
      description: 'add_money: the amount. split_bill: the bill total. discount: the original price. 0 otherwise.',
    },
    people: { type: 'number', description: 'split_bill: how many people share it (whole number). 0 when not said.' },
    split_mode: {
      type: 'string',
      enum: ['even', 'items', ''],
      description:
        'split_bill: even = "igual / equally / em partes iguais"; items = "por item / by what each ordered / per product"; ' +
        '"" when the user did not say how (the app then asks).',
    },
    tip_pct: { type: 'number', description: 'split_bill: tip percent when said ("com 20% de gorjeta"), else 0.' },
    percent: { type: 'number', description: 'discount: the percent off (30 for "30%"). 0 otherwise.' },
    money_type: { type: 'string', enum: ['expense', 'income'], description: 'add_money: spent = expense, received = income.' },
    budget: {
      type: 'string',
      description: 'add_money / money_summary: the budget named, matched to KNOWN BUDGETS (exact spelling). "" when none.',
    },
    pet: {
      type: 'string',
      description: 'pets_due: the pet named, exactly as in PETS (fix transcription slips: "Cloe" = "Chloe"). "" = all pets.',
    },
    field: { type: 'string', enum: FIELDS, description: 'family_info: which detail. "" otherwise.' },
    app: { type: 'string', enum: APPS, description: 'open_app: which part (budget = money). "" otherwise.' },
    reply: {
      type: 'string',
      description:
        'agenda over a period: a short phrase naming it in the user language ("este mês", "this week", "nas próximas 3 semanas"). ' +
        'find_items: one short sentence in the user language answering the question, naming the store each match is on ' +
        '("Sim — Agua de coco está na lista do Costco.", "No, there is no coconut water on the list."). ' +
        'unknown: one short, friendly sentence in the user language saying what you can do (shopping lists, agenda, money, nudges, pets, family details, splitting a bill, discounts). "" otherwise.',
    },
  },
  required: [
    'intent',
    'items',
    'store',
    'scope',
    'person',
    'date',
    'date_end',
    'time',
    'title',
    'amount',
    'people',
    'split_mode',
    'tip_pct',
    'percent',
    'money_type',
    'budget',
    'pet',
    'field',
    'app',
    'reply',
  ],
  additionalProperties: false,
}
const HAIKU_55 = { id: 'claude-haiku-5-5', in: 0.1 / 1e6, out: 0.5 / 1e6 }
const ASSISTANT_CAP = 300

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strList = (v: unknown, n = 30, len = 80) =>
  Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []

async function assistant(body: any, db: any, household: string | null, res: any) {
  const text = str(body?.text, 400)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body?.today ?? '') ? body.today : new Date().toISOString().slice(0, 10)
  const context = [
    `TODAY: ${today} (${str(body?.weekday, 20)})`,
    `KNOWN STORES: ${strList(body?.stores).join(', ') || '(none yet)'}`,
    `MEMBERS: ${strList(body?.members, 15).join(', ') || '(unknown)'}`,
    `KNOWN BUDGETS: ${strList(body?.budgets, 15).join(', ') || '(none)'}`,
    `PETS: ${strList(body?.pets, 15).join(', ') || '(none)'}`,
    // What's still to buy, as "label @ store" — so questions and "I bought…"
    // resolve to real items whatever language either side is in.
    `OPEN ITEMS: ${strList(body?.openItems, 120).join(' | ') || '(the list is empty)'}`,
    `ASKER: ${str(body?.me, 40) || '(unknown)'}`,
  ].join('\n')
  // The conversation so far (the sheet keeps it while it's open): each turn is
  // what was asked and a one-line account of what the app answered, so a
  // follow-up ("remove the milk", "and tomorrow?", "e a Lola?") can lean on it.
  const history = (Array.isArray(body?.history) ? body.history : [])
    .slice(-6)
    .map((h: any) => ({ q: str(h?.q, 300), a: str(h?.a, 600) }))
    .filter((h: { q: string }) => h.q)
  const convo = history.length
    ? `EARLIER IN THIS CONVERSATION (oldest first):\n${history
        .map((h: { q: string; a: string }) => `User: ${h.q}\nApp: ${h.a || '(done)'}`)
        .join('\n')}\n\n`
    : ''
  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: HAIKU_55.id,
      max_tokens: 700,
      // A slot-filling parse: no reasoning needed, and thinking would be most
      // of the bill. Disabled is accepted on Haiku 5.5 at effort <= high.
      thinking: { type: 'disabled' },
      system:
        'You turn one request (typed, or spoken and transcribed — expect transcription slips) into a structured intent ' +
        'for a family organiser app. The household speaks Portuguese, English or Spanish, often mixing them. ' +
        'Never invent items or stores the user did not mean; for items already on the list, return their exact labels. ' +
        'The REQUEST may follow up on earlier turns: resolve "those", "it", "the first one", "remove the eggs", ' +
        '"and tomorrow?", "e para a Lola?" against the conversation, keeping whatever the user did not change ' +
        '(same store, same pet, same person, same period).',
      messages: [{ role: 'user', content: `${context}\n\n${convo}REQUEST: ${text}` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ASSISTANT_SCHEMA } },
    } as any)
    if (db && household) {
      const u: any = response.usage
      const cost =
        ((u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)) * HAIKU_55.in + (u?.output_tokens ?? 0) * HAIKU_55.out
      try {
        await db.rpc('ai_light_record', { p_household: household, p_kind: 'assistant', p_cost: cost })
      } catch {
        /* metering write failure must not break a good response */
      }
    }
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return res.status(502).json({ error: 'no_answer' })
    const p = JSON.parse(block.text)
    const intent = (INTENTS as readonly string[]).includes(p.intent) ? p.intent : 'unknown'
    const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today)
    return res.status(200).json({
      intent,
      items: strList(p.items),
      store: str(p.store),
      scope: ['me', 'all', 'person'].includes(p.scope) ? p.scope : 'me',
      person: str(p.person),
      date: iso(p.date),
      // Never before the start; capped at ~3 months so a stray answer can't
      // ask the phone to expand a year of recurring events.
      date_end: (() => {
        const start = iso(p.date)
        const end = typeof p.date_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date_end) ? p.date_end : start
        const cap = new Date(start + 'T12:00:00Z')
        cap.setUTCDate(cap.getUTCDate() + 92)
        const capIso = cap.toISOString().slice(0, 10)
        return end < start ? start : end > capIso ? capIso : end
      })(),
      time: typeof p.time === 'string' && /^\d{1,2}:\d{2}$/.test(p.time) ? p.time.padStart(5, '0') : '',
      title: str(p.title, 140),
      amount: typeof p.amount === 'number' && isFinite(p.amount) && p.amount > 0 ? Math.round(p.amount * 100) / 100 : 0,
      people: typeof p.people === 'number' && p.people >= 1 && p.people <= 50 ? Math.floor(p.people) : 0,
      split_mode: p.split_mode === 'even' || p.split_mode === 'items' ? p.split_mode : '',
      tip_pct: typeof p.tip_pct === 'number' && p.tip_pct > 0 && p.tip_pct <= 100 ? p.tip_pct : 0,
      percent: typeof p.percent === 'number' && p.percent > 0 && p.percent < 100 ? p.percent : 0,
      money_type: p.money_type === 'income' ? 'income' : 'expense',
      budget: str(p.budget),
      pet: str(p.pet, 40),
      field: FIELDS.includes(p.field) ? p.field : '',
      app: APPS.includes(p.app) ? p.app : '',
      reply: str(p.reply, 240),
    })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError && /credit balance|billing/i.test(err.message ?? '')) {
      return res.status(502).json({ error: 'out_of_credits' })
    }
    return res.status(502).json({ error: 'failed' })
  }
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

  const isAssistant = req.query?.action === 'assistant'
  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI pings are not configured.' })
  }

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
          p_kind: isAssistant ? 'assistant' : 'nudge',
          p_cap: isAssistant ? ASSISTANT_CAP : DAILY_CAP,
        })
        // Only an EXPLICIT "no" blocks; an RPC error leaves the feature working.
        if (!gateErr && gate && gate.allowed === false) {
          if (isAssistant) return res.status(429).json({ error: 'paused' })
          return res.status(429).json({ error: 'AI nudges are paused for now — try a preset.' })
        }
      }
    } catch {
      /* metering must never block a legitimate nudge */
    }
  }

  if (isAssistant) return assistant(req.body, db, household, res)

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Convert this short note from a family member into a household "ping" —',
                'a quick ping the rest of the household will see on their phones.',
                'Pick the closest kind, a fitting single emoji, and a concise message',
                'in the SAME language as the note.',
                '',
                `Note: ${text.trim().slice(0, 280)}`,
              ].join('\n'),
            },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: PING_SCHEMA },
      },
    })

    if (db && household) {
      try {
        await db.rpc('ai_light_record', {
          p_household: household,
          p_kind: 'nudge',
          p_cost: estCost(response.usage),
        })
      } catch {
        /* metering write failure must not break a good response */
      }
    }

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      return res.status(502).json({ error: 'Could not build the ping.' })
    }
    const parsed = JSON.parse(block.text)
    return res.status(200).json({
      kind: typeof parsed.kind === 'string' ? parsed.kind : 'custom',
      emoji: (typeof parsed.emoji === 'string' && parsed.emoji.trim()) || '📣',
      message: (typeof parsed.message === 'string' && parsed.message.trim()) || text.trim(),
    })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError && /credit balance|billing/i.test(err.message ?? '')) {
      return res.status(502).json({ error: 'AI is paused — out of credits.' })
    }
    return res.status(502).json({ error: 'Could not build the ping — try a preset.' })
  }
}
