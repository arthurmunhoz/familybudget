// What Roof settles ON THE DEVICE, before any server call: answers to its own
// questions ("sim", "cancela", "o segundo", "o Costco"), "desfaz isso", "repete",
// and the clock / the date. Pure and import-free ON PURPOSE: src/casa/talk.ts
// is a byte-for-byte copy (the phone and Modo Casa are separate packages), and
// __tests__/assistantTalk.test.ts fails when the two drift apart.

/** Lower-case, no accents, no punctuation, single spaces. */
export function foldTalk(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words that may wrap a short answer without changing it.
const PAD = new Set(['ei', 'hey', 'oi', 'oye', 'roof', 'casa', 'por', 'favor', 'please', 'porfa', 'ai', 'entao', 'e', 'a', 'o'])
const core = (text: string) =>
  foldTalk(text)
    .split(' ')
    .filter((w) => w && !PAD.has(w))

/** The WHOLE request is "undo that" (pt / en / es) — never one that merely
 *  contains "volta" or "undo" ("volta a lista do Walmart"). */
const UNDO_ASK =
  /^(?:desfaz|desfaca|desfazer|undo|deshaz|deshacer|volta atras|volte atras)(?: (?:isso|isto|que voce fez|que fez|ultima|ultimo|that|it|this|the last one|what you did|eso|esto|lo ultimo|la ultima))?$/
export function isUndoAsk(text: string): boolean {
  return UNDO_ASK.test(core(text).join(' '))
}

const YES = new Set([
  'sim', 'isso', 'pode', 'manda', 'mande', 'envia', 'envie', 'enviar', 'mandar', 'confirma', 'confirmo', 'confirmar', 'claro', 'ok', 'okay',
  'beleza', 'certo', 'exato', 'isso mesmo', 'pode mandar', 'pode enviar', 'pode sim', 'manda sim', 'sim pode', 'sim manda', 'pode ser', 'ok pode', 'ok manda', 'ok sim', 'vai', 'bora',
  'yes', 'yeah', 'yep', 'sure', 'send', 'send it', 'do it', 'go ahead', 'confirm', 'right', 'correct', 'yes please',
  'si', 'dale', 'envialo', 'mandalo', 'claro que si', 'correcto', 'hazlo',
])
const NO = new Set([
  'nao', 'cancela', 'cancele', 'cancelar', 'deixa', 'deixa pra la', 'esquece', 'nao precisa', 'nao manda', 'nao envia', 'nao quero', 'para', 'pare',
  'no', 'nope', 'cancel', 'never mind', 'nevermind', 'dont', 'do not', 'stop', 'forget it',
  'cancelalo', 'olvidalo', 'dejalo', 'no lo envies',
])
/** The whole request is a yes ("sim", "pode mandar", "go ahead"). */
export function isYes(text: string): boolean {
  return YES.has(core(text).join(' '))
}
/** The whole request is a no ("não", "cancela", "never mind"). */
export function isNo(text: string): boolean {
  return NO.has(core(text).join(' '))
}

const ORDINALS: [RegExp, number][] = [
  [/^(?:primeir[oa]|first|primer[oa]?|um|uma|one|uno|1)$/, 0],
  [/^(?:segund[oa]|second|dois|duas|two|dos|2)$/, 1],
  [/^(?:terceir[oa]|third|tercer[oa]?|tres|three|3)$/, 2],
  [/^(?:quart[oa]|fourth|cuart[oa]|quatro|four|cuatro|4)$/, 3],
  [/^(?:quint[oa]|fifth|cinco|five|5)$/, 4],
]
const LAST = /^(?:ultim[oa]|last)$/
// Words around an ordinal or a name that carry no choice of their own.
const FILL = new Set(['o', 'a', 'os', 'as', 'no', 'na', 'do', 'da', 'de', 'el', 'la', 'the', 'lista', 'list', 'opcao', 'option', 'opcion', 'quero', 'pode', 'ser', 'seria', 'para', 'pro', 'en', 'in', 'on', 'one', 'that', 'esse', 'essa', 'este', 'esta', 'ese', 'esa', 'coloca', 'coloque', 'poe', 'bota', 'adiciona', 'put', 'add', 'it', 'pon', 'mesmo', 'mesma'])

/** Which of `labels` a short spoken answer means: by position ("o segundo",
 *  "the last one") or by name ("Costco", "a da Ana"). -1 when it names none
 *  (or more than one) — then the words are a NEW request, not an answer. */
export function pickByVoice(text: string, labels: string[]): number {
  const words = core(text).filter((w) => !FILL.has(w))
  if (!words.length || words.length > 5 || !labels.length) return -1
  if (words.length === 1) {
    if (LAST.test(words[0])) return labels.length - 1
    // A digit or a number word is a position only when no label is that word.
    const byName = labels.findIndex((l) => foldTalk(l).split(' ').includes(words[0]))
    const ord = ORDINALS.find(([re]) => re.test(words[0]))
    if (ord && byName < 0) return ord[1] < labels.length ? ord[1] : -1
  }
  const said = words.join(' ')
  const hits = labels
    .map((l, i) => ({ i, f: foldTalk(l) }))
    .filter(({ f }) => f && (f === said || f.includes(said) || (said.includes(f) && f.length >= 3) || words.every((w) => w.length >= 3 && f.split(' ').some((x) => x.startsWith(w)))))
  if (!hits.length) return -1
  const exact = hits.filter((h) => h.f === said)
  if (exact.length === 1) return exact[0].i
  return hits.length === 1 ? hits[0].i : -1
}

/** "repete", "fala de novo", "say that again", "repite". */
export function isRepeatAsk(text: string): boolean {
  return /^(?:repete|repita|repetir|fala de novo|fale de novo|de novo|como|nao entendi|que|repeat|repeat that|say that again|say it again|again|what|pardon|repite|repitelo|otra vez|que|no entendi)$/.test(
    core(text).join(' '),
  )
}

export type ClockAsk = 'time' | 'date' | 'morning' | null
/** The clock, today's date, or a bare "bom dia" (→ the day's overview): things
 *  the device knows without asking anyone. */
export function clockAsk(text: string): ClockAsk {
  const f = core(text).join(' ')
  if (/^(?:que horas sao|que hora|que horas|quantas horas|que horas sao agora|what time is it|what s the time|whats the time|what time is it now|the time|que hora es|que horas son)$/.test(f)) return 'time'
  if (/^(?:que dia hoje|qual data de hoje|que data hoje|que dia da semana hoje|hoje que dia|que dia|what day is it|what day is it today|what day is today|what s the date|whats the date|what s today s date|what is the date today|que dia es hoy|que fecha es hoy|cual es la fecha de hoy)$/.test(f)) return 'date'
  if (/^(?:bom dia|good morning|buenos dias|buen dia)$/.test(f)) return 'morning'
  return null
}

// ── "how long?" ──────────────────────────────────────────────────────────────

const DUR_NUM: Record<string, string> = {
  um: '1', uma: '1', one: '1', un: '1', una: '1', uno: '1', an: '1',
  dois: '2', duas: '2', two: '2', dos: '2',
  tres: '3', three: '3',
  quatro: '4', four: '4', cuatro: '4',
  cinco: '5', five: '5',
  seis: '6', six: '6',
  oito: '8', eight: '8', ocho: '8',
}
const DUR_FILL = new Set([
  'ei', 'hey', 'oi', 'oye', 'roof', 'casa', 'por', 'favor', 'please', 'umas', 'uns', 'unas', 'unos', 'durante', 'for', 'about', 'around', 'cerca', 'de', 'so', 'apenas', 'only', 'just',
  'vai', 'durar', 'dura', 'deve', 'pode', 'ser', 'coloca', 'poe', 'acho', 'que', 'tipo', 'como', 'mais', 'ou', 'menos', 'it', 'lasts', 'make', 'solo',
])
const DUR_H = '(?:hora|horas|h|hr|hrs|hour|hours)'
const DUR_M = '(?:min|mins|minuto|minutos|minute|minutes|m)'
const DUR_N = '(\\d+(?:\\.\\d+)?)'
const DUR_HALF = '(?:meia|media|half)'

/** A spoken length as MINUTES — "2 horas", "uma hora e meia", "45 minutos",
 *  "1h30", "half an hour" — or null when the words are not (only) a length.
 *  `bare`: a lone number counts as hours ("duas" answering "how long?"). */
export function durationSaid(text: string, bare = false): number | null {
  const s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*:\s*(\d)/g, '$1 h $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !DUR_FILL.has(w))
    .map((w) => DUR_NUM[w] ?? w)
    .join(' ')
  if (!s) return null
  const ok = (m: number) => (Number.isFinite(m) && m >= 5 && m <= 24 * 60 ? Math.round(m) : null)
  let m: RegExpMatchArray | null
  if (new RegExp(`^${DUR_HALF} (?:1 |a )?${DUR_H}$`).test(s)) return 30
  if ((m = s.match(new RegExp(`^(?:${DUR_N} )?${DUR_H} (?:e|y|and)(?: a| 1)? ${DUR_HALF}$`)))) return ok(Number(m[1] ?? 1) * 60 + 30)
  if ((m = s.match(new RegExp(`^${DUR_N} (?:e|y|and)(?: a| 1)? ${DUR_HALF}(?: ${DUR_H})?$`)))) return ok(Number(m[1]) * 60 + 30)
  if ((m = s.match(new RegExp(`^${DUR_N} ${DUR_H}(?: (?:e|y|and))?(?: ${DUR_N}(?: ${DUR_M})?)?$`)))) return ok(Number(m[1]) * 60 + Number(m[2] ?? 0))
  if ((m = s.match(new RegExp(`^${DUR_H}$`)))) return 60
  if ((m = s.match(new RegExp(`^${DUR_N} ${DUR_M}$`)))) return ok(Number(m[1]))
  if (bare && (m = s.match(/^(\d+(?:\.\d+)?)$/)) && Number(m[1]) <= 12) return ok(Number(m[1]) * 60)
  return null
}
