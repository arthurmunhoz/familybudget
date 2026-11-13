// What Roof suggests while it listens (owner, 2026-11-13: "every time it's the
// same sentence"). Each opening shows the NEXT example from a rotating list —
// so over a week the family sees most of what Roof can do — and every fourth
// opening the hint "Don't know what to ask? Say 'what can you do?'", which
// opens the capabilities screen (CapabilitiesView). The position survives
// restarts (AsyncStorage), so the first one isn't always the same.
import AsyncStorage from '@react-native-async-storage/async-storage'

import type { TKey } from '@/lib/i18n'

export const TIP_KEYS: TKey[] = [
  'ask.ex2',
  'roofEx.shop.1',
  'roofEx.cal.2',
  'roofEx.money.1',
  'roofEx.pets.1',
  'roofEx.nudge.1',
  'roofEx.cal.1',
  'roofEx.calc.1',
  'roofEx.family.2',
  'roofEx.shop.3',
  'roofEx.money.2',
  'roofEx.cal.4',
  'roofEx.pets.2',
  'roofEx.nudge.2',
  'ask.ex1',
]

export type Tip = { kind: 'example'; key: TKey } | { kind: 'help' }

const KEY = 'roof.tipN'
let n: number | null = null
void AsyncStorage.getItem(KEY)
  .then((v) => {
    if (n === null) n = Number(v) || 0
  })
  .catch(() => {})

/** The tip for this opening (advances the rotation). */
export function nextTip(): Tip {
  n = (n ?? 0) + 1
  void AsyncStorage.setItem(KEY, String(n)).catch(() => {})
  if (n % 4 === 0) return { kind: 'help' }
  const i = n - Math.floor(n / 4) // skip the help slots so examples don't jump
  return { kind: 'example', key: TIP_KEYS[i % TIP_KEYS.length] }
}

/** "o que você sabe fazer?", "what can you do?", "¿qué puedes hacer?"… —
 *  answered here with the capabilities screen (instant, nothing spent). */
export function isCapabilitiesAsk(text: string): boolean {
  const f = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (
    /\bo que (voce|vc|tu|o roof)? ?(sabe|pode|consegue) fazer\b/.test(f) ||
    /\bo que (eu )?(posso|da pra|da para) (te )?pedir\b/.test(f) ||
    /\b(como|em que) (voce|vc) (pode )?(me )?ajuda(r)?\b/.test(f) ||
    /\bwhat (can|do) you (do|know)\b/.test(f) ||
    /\bwhat can i (ask|say)\b/.test(f) ||
    /\bque (puedes|sabes) hacer\b/.test(f) ||
    /\bque (te )?puedo pedir\b/.test(f) ||
    /^(ajuda|help|ayuda)$/.test(f)
  )
}
