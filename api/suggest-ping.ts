// Vercel serverless: turn a family member's free-text note into a household
// "ping" — {kind, emoji, message}. Used by the Pings sheet's "just type it"
// box. Auth: the caller must send a valid Supabase JWT (don't burn AI credits
// for strangers). Uses a small/fast model — this is a trivial mapping task.
import Anthropic from '@anthropic-ai/sdk'

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

  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI pings are not configured.' })
  }

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
