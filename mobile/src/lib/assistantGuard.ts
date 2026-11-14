// Pure checks on what the assistant understood, before anything is written.
// No imports on purpose: scripts/assistant-eval.ts uses these too.

/** Intents that change household data (a send_nudge is only sent on a tap,
 *  but a cut-off message is still not worth offering). */
export const WRITE_INTENTS = new Set([
  'add_items',
  'check_items',
  'remove_items',
  'move_items',
  'clear_checked',
  'uncheck_items',
  'add_event',
  'move_event',
  'remove_event',
  'edit_event',
  'add_money',
  'fix_money',
  'remove_money',
  'pet_done',
  'pet_log',
  'pet_weight',
  'family_update',
  'send_nudge',
])

// Words a sentence doesn't end on: articles, prepositions, "and". A spoken
// request ending on one was cut off by the recogniser ("marca uma consulta
// da", "add milk to the") — owner report 2026-11, a wrong write ran.
const DANGLING = new Set([
  // pt
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'pro', 'na', 'no', 'nas', 'nos',
  'em', 'com', 'e', 'ou', 'que', 'pela', 'pelo', 'ao', 'à', 'meu', 'minha', 'seu', 'sua',
  // en
  'the', 'an', 'to', 'for', 'of', 'on', 'in', 'at', 'with', 'and', 'or', 'my', 'our', 'his', 'her', 'their', 'from',
  // es
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'al', 'en', 'con', 'y', 'mi', 'su', 'por',
])

/** True when the request ends mid-phrase (on an article / preposition / "and"). */
export function looksCut(text: string): boolean {
  const words = text
    .trim()
    .toLowerCase()
    .replace(/[.!?…,;:]+$/u, '')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length < 2) return false
  return DANGLING.has(words[words.length - 1])
}

/** A write understood from a cut-off request: ask instead of doing it. */
export function cutWrite(intentName: string, text: string): boolean {
  return WRITE_INTENTS.has(intentName) && looksCut(text)
}
