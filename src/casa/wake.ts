// "Ei Roof" on the home device. Ported (not imported) from
// mobile/src/lib/roofWake.ts — keep the word lists and the regexes in step
// with it. The browser's own SpeechRecognition (webkitSpeechRecognition)
// runs continuously; we watch its words for the call, then the same session
// keeps going and what follows is the request.

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const CALL_STRONG = '(?:ei|hey|hei|ey|ai|oi|hay|oye|rei|eai|ok|okay)'
const CALL_WEAK = '(?:e|a)'
const SOUNDS_LIKE = '(?:r|rr|h)(?:u|o|ou|oo)(?:f|ff|ph|v|b)(?:e|i|y|o|u|a|ie|io|ia|ey)?s?'
const NAME =
  '(?:roof|roofs|roofe|ruf|ruff|ruffe|rufe|rufi|rufo|rufu|rufy|ruffy|rufus|ruth|rute|roofy|roofie|rouf|rof|rofe|rough|ruv|ru|rou|hoof|hoofe|huf|hufe|hufi|hufo|houf|uf|ufe|ufi)'
const WAKE = new RegExp(
  `(?:^|\\s)(?:${CALL_STRONG}\\s+(?:${NAME}|${SOUNDS_LIKE})|${CALL_WEAK}\\s+${NAME})(?:\\s|$)|^roof(?:\\s|$)`,
)

const FILLERS = new Set(['er', 'err', 'erm', 'uh', 'uhh', 'um', 'umm', 'hum', 'hm', 'hmm', 'ah', 'ahn', 'eh', 'e', 'a', 'o', 'oh', 'ai', 'ei', 'hey', 'ok', 'okay', 'roof', 'ne', 'tipo', 'entao', 'bom'])

/** `text` with only filler words → '' (nothing to send); else `text`. */
export function meaningfulRequest(text: string): string {
  const words = fold(text).split(' ').filter(Boolean)
  return words.some((w) => !FILLERS.has(w)) ? text.trim() : ''
}

const BYE_WORDS = new Set([
  'obrigado', 'obrigada', 'obrigadao', 'brigado', 'brigada', 'valeu', 'vlw', 'falou', 'tchau', 'tchauzinho', 'ate', 'mais', 'logo',
  'depois', 'amanha', 'so', 'isso', 'e', 'era', 'nada', 'muito', 'mto', 'roof', 'ei', 'ok', 'beleza', 'blz', 'otimo', 'perfeito',
  'show', 'certo', 'entao', 'por', 'hoje', 'tudo', 'tranquilo', 'de', 'fechou', 'maravilha', 'brigadao', 'ta', 'bom', 'okay',
  'thanks', 'thank', 'you', 'thx', 'bye', 'goodbye', 'see', 'later', 'that', 'thats', 's', 'all', 'great', 'cool', 'perfect', 'got', 'it',
  'so', 'much', 'for', 'now', 'cheers', 'hey',
  'gracias', 'adios', 'hasta', 'luego', 'pronto', 'eso', 'es', 'todo', 'chao', 'vale', 'perfecto', 'genial', 'oye',
])
const BYE_CORE = /\b(fechou|maravilha|ok|okay|brigadao|obrigad[oa]|obrigadao|brigad[oa]|valeu|vlw|falou|tchau|tchauzinho|ate (mais|logo|amanha|depois)|so isso|era so isso|e isso|thanks|thank you|thx|bye|goodbye|see you|that s all|thats all|gracias|adios|hasta (luego|pronto)|eso es todo|chao)\b/

/** Is `text` only thanks / a goodbye (pt, en or es)? */
export function isGoodbye(text: string): boolean {
  const f = fold(text)
  if (!f || !BYE_CORE.test(f)) return false
  return f.split(' ').every((w) => BYE_WORDS.has(w))
}

/** The wake phrase in `heard`? What came AFTER it (maybe ''), or null. */
export function afterWake(heard: string): string | null {
  const f = fold(heard)
  const m = WAKE.exec(f)
  if (!m) return null
  const n = f.slice(0, m.index + m[0].length).trim().split(' ').length
  const words = heard.trim().split(/\s+/)
  let seen = 0
  let i = 0
  while (i < words.length && seen < n) {
    if (fold(words[i])) seen++
    i++
  }
  return meaningfulRequest(
    words
      .slice(i)
      .join(' ')
      .replace(/^[\s,.;:!?-]+/, '')
      .trim(),
  )
}

/** Does `heard` END like the start of a call ("Ei…", "Hey Ru…")? */
export function soundsLikeCalling(heard: string): boolean {
  const w = fold(heard).split(' ').filter(Boolean)
  const last = w[w.length - 1] ?? ''
  const prev = w[w.length - 2] ?? ''
  const strong = new RegExp(`^${CALL_STRONG}$`)
  if (strong.test(last)) return true
  return strong.test(prev) && /^(r|h|u|o)/.test(last)
}

// ── the recogniser ───────────────────────────────────────────────────────────

/* Minimal typing for the Web Speech API (not in lib.dom for every TS). */
interface SRAlternative {
  transcript: string
}
interface SRResult {
  isFinal: boolean
  length: number
  [i: number]: SRAlternative
}
interface SREvent {
  resultIndex: number
  results: { length: number; [i: number]: SRResult }
}
interface SR {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function SRClass(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = (): boolean => !!SRClass()

export type EarsState = 'off' | 'waiting' | 'hearing' | 'capturing' | 'unsupported' | 'denied'

export interface EarsHandlers {
  /** The call was heard: open listening (the chime is the caller's). */
  onWake: () => void
  /** What has been said for the request so far. */
  onHeard: (text: string) => void
  /** A pause after words (or ~7 s of nothing): the request ('' = nothing). */
  onDone: (request: string) => void
  onState: (s: EarsState) => void
}

const LANGS: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

/**
 * One continuous recogniser for both jobs:
 *  - 'wake'    watch for "Ei Roof" (and what follows it)
 *  - 'capture' everything said is the request (tap-to-talk, follow-ups)
 *  - 'paused'  hear nothing (Roof is talking; the panel is typed in)
 * It restarts itself when the browser ends a session, with back-off on errors.
 */
export class RoofEars {
  private rec: SR | null = null
  private running = false
  private wantOn = false
  private mode: 'wake' | 'capture' | 'paused' = 'paused'
  private wakeArmed = true
  private scanFrom = 0
  private results: string[] = []
  private finals: boolean[] = []
  private woke = false
  private req = ''
  private settle: ReturnType<typeof setTimeout> | null = null
  private restart: ReturnType<typeof setTimeout> | null = null
  private hearingOff: ReturnType<typeof setTimeout> | null = null
  private fails = 0
  private denied = false
  private lang: string
  private h: EarsHandlers

  constructor(lang: string, handlers: EarsHandlers) {
    this.lang = lang
    this.h = handlers
  }

  setHandlers(h: EarsHandlers) {
    this.h = h
  }

  setLang(lang: string) {
    if (lang === this.lang) return
    this.lang = lang
    if (this.running) this.recycle()
  }

  /** Listen for "Ei Roof" (armed) or only when asked to capture (disarmed). */
  setWake(armed: boolean) {
    this.wakeArmed = armed
    if (this.mode === 'wake' || this.mode === 'paused') {
      this.mode = armed ? 'wake' : 'paused'
      this.ensure()
    }
    this.emitState()
  }

  /** Everything said from now on is the request. */
  capture() {
    this.clearSettle()
    this.mode = 'capture'
    this.woke = true
    this.req = ''
    this.scanFrom = this.results.length
    this.ensure()
    // Nothing at all for a while → done with nothing.
    this.settle = setTimeout(() => this.fire(), 8000)
    this.emitState()
  }

  /** Stop capturing; back to waiting for the call (or silent). */
  release() {
    this.clearSettle()
    this.woke = false
    this.req = ''
    this.mode = this.wakeArmed ? 'wake' : 'paused'
    this.scanFrom = this.results.length
    this.ensure()
    this.emitState()
  }

  /** Hear nothing for now (Roof speaking). */
  pause() {
    this.clearSettle()
    this.woke = false
    this.mode = 'paused'
    this.scanFrom = this.results.length
    this.emitState()
  }

  /** Back from the background: start again if we should be on. */
  wakeUp() {
    this.fails = 0
    this.ensure()
  }

  dispose() {
    this.wantOn = false
    this.clearSettle()
    if (this.restart) clearTimeout(this.restart)
    if (this.hearingOff) clearTimeout(this.hearingOff)
    this.stopRec()
  }

  get state(): EarsState {
    if (!SRClass()) return 'unsupported'
    if (this.denied) return 'denied'
    if (this.mode === 'capture') return 'capturing'
    if (this.mode === 'wake' && this.running) return this.hearingOff ? 'hearing' : 'waiting'
    return 'off'
  }

  private emitState() {
    this.h.onState(this.state)
  }

  private clearSettle() {
    if (this.settle) clearTimeout(this.settle)
    this.settle = null
  }

  private ensure() {
    const need = this.mode !== 'paused' || this.wakeArmed
    this.wantOn = need
    if (need && !this.running) this.begin()
  }

  private recycle() {
    this.stopRec()
    this.scheduleRestart(200)
  }

  private stopRec() {
    if (!this.rec) return
    const r = this.rec
    this.rec = null
    this.running = false
    r.onresult = r.onerror = r.onend = r.onstart = null
    try {
      r.abort()
    } catch {
      /* already stopped */
    }
  }

  private begin() {
    const C = SRClass()
    if (!C || this.running || !this.wantOn) return
    if (document.visibilityState === 'hidden') return
    const rec = new C()
    rec.lang = LANGS[this.lang] ?? 'pt-BR'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    this.results = []
    this.finals = []
    this.scanFrom = 0
    rec.onresult = (e) => this.onResult(e)
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.denied = true
        this.wantOn = false
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') this.fails++
    }
    rec.onend = () => {
      this.running = false
      this.rec = null
      if (this.mode === 'capture' && this.req) this.fire()
      this.emitState()
      if (this.wantOn && !this.denied) this.scheduleRestart(this.fails > 4 ? 15000 : 400 + this.fails * 600)
    }
    this.rec = rec
    try {
      rec.start()
      this.running = true
      this.denied = false
    } catch {
      this.running = false
      this.rec = null
      this.fails++
      this.scheduleRestart(1500)
    }
    this.emitState()
  }

  private scheduleRestart(ms: number) {
    if (this.restart) return
    this.restart = setTimeout(() => {
      this.restart = null
      this.begin()
    }, ms)
  }

  private onResult(e: SREvent) {
    this.fails = 0
    for (let i = e.resultIndex; i < e.results.length; i++) {
      this.results[i] = e.results[i][0]?.transcript ?? ''
      this.finals[i] = e.results[i].isFinal
    }
    this.results.length = e.results.length
    const heard = this.results.slice(this.scanFrom).join(' ').replace(/\s+/g, ' ').trim()
    if (this.mode === 'paused') return

    if (this.mode === 'wake' && !this.woke) {
      const after = afterWake(heard)
      if (after === null) {
        if (soundsLikeCalling(heard)) {
          if (this.hearingOff) clearTimeout(this.hearingOff)
          this.hearingOff = setTimeout(() => {
            this.hearingOff = null
            this.emitState()
          }, 1600)
          this.emitState()
        }
        // Keep the scan window short: drop final stretches that held no call
        // (all but the last one, in case the call straddles two).
        let lastFinal = -1
        for (let i = this.scanFrom; i < this.results.length; i++) if (this.finals[i]) lastFinal = i
        if (lastFinal > this.scanFrom) this.scanFrom = lastFinal
        return
      }
      if (this.hearingOff) clearTimeout(this.hearingOff)
      this.hearingOff = null
      this.woke = true
      this.mode = 'capture'
      this.req = after
      this.h.onWake()
      this.emitState()
    } else {
      this.req = afterWake(heard) ?? meaningfulRequest(heard)
    }
    this.h.onHeard(this.req)
    this.clearSettle()
    const allFinal = this.finals.slice(this.scanFrom).every(Boolean)
    this.settle = setTimeout(() => this.fire(), this.req ? (allFinal ? 900 : 1500) : 7000)
  }

  private fire() {
    this.clearSettle()
    const req = this.req
    this.woke = false
    this.req = ''
    this.mode = 'paused'
    this.scanFrom = this.results.length
    this.emitState()
    this.h.onDone(req)
  }
}
