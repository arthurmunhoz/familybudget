// Runs the assistant's phrase set against the real model, before a deploy.
//
//   ANTHROPIC_API_KEY=... npx --yes tsx scripts/assistant-eval.ts [flat|grouped|both]
//
// Calls parseAssistant() from api/suggest-ping.ts directly (no auth, no
// metering, no gap logging), with the household fixture in
// assistant-eval.json. Each case passes when the intent and every field
// listed in `expect` match. Prints failures, accuracy, output tokens and
// latency per schema variant. Cost: ~60 Haiku calls, a fraction of a cent.
import { readFileSync } from 'node:fs'
import { parseAssistant, type SchemaVariant } from '../api/suggest-ping'

interface Case {
  text: string
  history?: { q: string; a: string }[]
  expect: Record<string, unknown>
}
const suite = JSON.parse(readFileSync(new URL('./assistant-eval.json', import.meta.url), 'utf8')) as {
  context: Record<string, unknown>
  cases: Case[]
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v)
function same(got: unknown, want: unknown): boolean {
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false
    const g = got.map(norm).sort()
    return want.map(norm).sort().every((w, i) => w === g[i])
  }
  if (typeof want === 'number') return typeof got === 'number' && Math.abs(got - want) < 0.005
  return norm(got) === norm(want)
}

async function run(variant: SchemaVariant) {
  let pass = 0
  let outTokens = 0
  let ms = 0
  const fails: string[] = []
  // A few at a time: fast, and well under any rate limit.
  const queue = suite.cases.map((c, i) => ({ c, i }))
  const results: { ok: boolean; line: string }[] = []
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { c, i } = next
      const t0 = Date.now()
      try {
        const { out, usage } = await parseAssistant({ ...suite.context, text: c.text, history: c.history ?? [] }, variant)
        ms += Date.now() - t0
        outTokens += usage?.output_tokens ?? 0
        const wrong = Object.entries(c.expect).filter(([k, v]) => !same(out[k], v))
        results[i] = wrong.length
          ? { ok: false, line: `✗ "${c.text}"\n    ${wrong.map(([k, v]) => `${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(out[k])}`).join('\n    ')}` }
          : { ok: true, line: '' }
      } catch (e) {
        // A bad key fails every case the same way: say so once and stop.
        if ((e as { status?: number }).status === 401) {
          console.error('The API key was rejected (401). Check ANTHROPIC_API_KEY.')
          process.exit(1)
        }
        ms += Date.now() - t0
        results[i] = { ok: false, line: `✗ "${c.text}"\n    error: ${(e as Error).message}` }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  for (const r of results) {
    if (r.ok) pass++
    else fails.push(r.line)
  }
  const n = suite.cases.length
  console.log(`\n── ${variant} ──`)
  if (fails.length) console.log(fails.join('\n'))
  console.log(`${pass}/${n} passed · avg ${Math.round(outTokens / n)} output tokens · avg ${Math.round(ms / n)} ms`)
  return pass
}

const arg = (process.argv[2] ?? 'both') as SchemaVariant | 'both'
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first.')
  process.exit(1)
}
for (const v of arg === 'both' ? (['flat', 'grouped'] as const) : [arg]) await run(v)
