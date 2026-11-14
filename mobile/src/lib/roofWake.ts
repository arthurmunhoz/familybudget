// "Ei Roof" — hands-free wake while the app is open on the Home (owner,
// 2026-11-12). No wake-word engine: the phone's OWN recogniser runs ON-DEVICE
// (requiresOnDeviceRecognition — nothing leaves the phone while it waits) and
// we watch its words for "ei/hey roof". The moment the call is heard: ONE
// chime and `onWake` (the Home opens the ask sheet already showing
// "listening"), and this same recogniser keeps going — no second start, no
// second chime (owner, 2026-11: two chimes left people unsure when to talk).
// What follows streams to `onHeard`; SPEECH_SETTLE_MS of unchanged words (or
// ~7 s of nothing) ends it with `onDone(request)`. A "final" result is NOT
// the end: iOS 18 flags every pause as final (see voice.ts stitch()).
// The mic is shared with useVoice: this listener starts / aborts it only
// through the owner token (micStart / micAbort), so nobody else's abort
// kills the capture and our late aborts never kill theirs.
//
// Never runs in the background (iOS/Android forbid the mic there) and never
// where on-device recognition isn't available — then the switch says so.
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { setRoofPref } from '@/lib/roof'
import { micAbort, micOwns, micStart, micStop, playChime, SPEECH_SETTLE_MS, speechModule, stitch } from '@/lib/voice'

/** The start chime's length (assets/sounds/listen-start.wav, 0.24 s) + a beat. */
const CHIME_MS = 300

const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// How recognisers spell "Roof" in pt/en/es, and the greeting before it.
// Strong greetings (ei, hey, oye…) take any word that SOUNDS like Roof: an
// r/h start (Brazilian RR is an h), u/o, then f/v/b, then any short ending —
// "rufi", "hufe", "rúfi", "rubi", "roofy" (owner, 2026-11: a Brazilian
// "Rúfi" wasn't caught). The bare "e"/"a" — ordinary words — only take the
// exact spellings below, so "e rouba…" doesn't wake it.
const CALL_STRONG = '(?:ei|hey|hei|ey|ai|oi|hay|oye|rei|eai|ok|okay|eu|hej|ola|hola)'
const CALL_WEAK = '(?:e|a)'
const SOUNDS_LIKE = '(?:r|rr|h)(?:u|o|ou|oo)(?:f|ff|ph|v|b)(?:e|i|y|o|u|a|ie|io|ia|ey)?s?'
const NAME =
  '(?:roof|roofs|roofe|ruf|ruff|ruffe|rufe|rufi|rufo|rufu|rufy|ruffy|rufus|ruth|rute|roofy|roofie|rouf|rof|rofe|rough|ruv|ru|rou|hoof|hoofe|huf|hufe|hufi|hufo|houf|uf|ufe|ufi)'
// "Oi Casa" (pt) / "Oye Casa" (es) — owner, 2026-11-13: "Roof" with a
// Brazilian or Spanish accent (the R, "Rúfi") kept being missed; "casa" sounds
// the same in every accent. Only right after a greeting, since "casa" alone
// is an everyday word ("vou pra casa"). English keeps "Hey Roof".
const CASA_CALL = '(?:oi|oii|oie|ei|hey|ola|oye|hola|hey|e ai)'
const WAKE = new RegExp(
  `(?:^|\\s)(?:${CALL_STRONG}\\s+(?:${NAME}|${SOUNDS_LIKE})|${CALL_WEAK}\\s+${NAME})(?:\\s|$)|^roof(?:\\s|$)|(?:^|\\s)${CASA_CALL}\\s+casa(?:\\s|$)`,
)

// Sounds, not requests: a hesitation the recogniser wrote down ("er", "uh",
// "é…") must never be sent — "ER" once went to the assistant and came back
// answered in English (owner, 2026-11).
const FILLERS = new Set(['er', 'err', 'erm', 'uh', 'uhh', 'um', 'umm', 'hum', 'hm', 'hmm', 'ah', 'ahn', 'eh', 'e', 'a', 'o', 'oh', 'ai', 'ei', 'hey', 'ok', 'okay', 'roof', 'ne', 'tipo', 'entao', 'bom'])

/** `text` with only filler words → '' (nothing to send); else `text`. */
export function meaningfulRequest(text: string): string {
  const words = fold(text).split(' ').filter(Boolean)
  return words.some((w) => !FILLERS.has(w)) ? text.trim() : ''
}

// A request that is only thanks / a goodbye ends the conversation: Roof
// answers it on the phone (no model call, nothing spent), says it, and closes
// instead of listening again (owner, 2026-11). Anything more ("obrigado, põe
// leite") is a real request and goes through as usual.
const BYE_WORDS = new Set([
  // pt
  'obrigado', 'obrigada', 'obrigadao', 'brigado', 'brigada', 'valeu', 'vlw', 'falou', 'tchau', 'tchauzinho', 'ate', 'mais', 'logo',
  'depois', 'amanha', 'so', 'isso', 'e', 'era', 'nada', 'muito', 'mto', 'roof', 'ei', 'ok', 'beleza', 'blz', 'otimo', 'perfeito',
  'show', 'certo', 'entao', 'por', 'hoje', 'tudo', 'tranquilo', 'de', 'fechou', 'maravilha', 'brigadao', 'ta', 'bom', 'okay',
  // en
  'thanks', 'thank', 'you', 'thx', 'bye', 'goodbye', 'see', 'later', 'that', 'thats', 's', 'all', 'great', 'cool', 'perfect', 'got', 'it',
  'so', 'much', 'for', 'now', 'cheers', 'hey',
  // never mind (owner, 2026-11-14: "nada não, obrigado" kept listening)
  'nao', 'precisa', 'deixa', 'pra', 'la', 'quieto', 'esquece', 'obg', 'no', 'nothing', 'never', 'mind', 'nevermind', 'nah', 'nope',
  'olvidalo', 'dejalo', 'mas',
  // es
  'gracias', 'adios', 'hasta', 'luego', 'pronto', 'eso', 'es', 'todo', 'chao', 'vale', 'perfecto', 'genial', 'oye',
])
const BYE_CORE = /\b(fechou|maravilha|ok|okay|brigadao|obrigad[oa]|obrigadao|brigad[oa]|valeu|vlw|falou|tchau|tchauzinho|ate (mais|logo|amanha|depois)|so isso|era so isso|e isso|thanks|thank you|thx|bye|goodbye|see you|that s all|thats all|gracias|adios|hasta (luego|pronto)|eso es todo|chao|nada|nao precisa|deixa (pra la|quieto)|esquece|obg|no thanks|nevermind|never mind|nothing|nah|nope|olvidalo|dejalo)\b/

/** Is `text` only thanks / a goodbye (in pt, en or es)? */
export function isGoodbye(text: string): boolean {
  const f = fold(text)
  if (!f || !BYE_CORE.test(f)) return false
  return f.split(' ').every((w) => BYE_WORDS.has(w))
}

/** The wake phrase in `heard`? Returns what came AFTER it (maybe ''), or null.
 *  Works on the ORIGINAL text so the request keeps its accents. */
export function afterWake(heard: string): string | null {
  const f = fold(heard)
  const m = WAKE.exec(f)
  if (!m) return null
  // Count the words up to the end of the match and drop as many from the
  // original (fold keeps word boundaries, it only rewrites letters).
  const n = f.slice(0, m.index + m[0].length).trim().split(' ').length
  const words = heard.trim().split(/\s+/)
  // Punctuation-only "words" vanish in fold; skip them so the counts agree.
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

/** Can this phone recognise speech without the network? Required: the wait
 *  for "Ei Roof" must never stream the kitchen to a server. */
export function onDeviceOk(): boolean {
  try {
    return !!(speechModule() as unknown as { supportsOnDeviceRecognition?: () => boolean } | null)?.supportsOnDeviceRecognition?.()
  } catch {
    return false
  }
}

/** Turn "Ei Roof" on (Settings and the Home's dock share this): needs
 *  on-device recognition and the microphone — asked here, from the tap. */
export async function turnOnRoofWake(): Promise<'ok' | 'unsupported' | 'denied'> {
  const m = speechModule()
  if (!m || !onDeviceOk()) return 'unsupported'
  const perm = await m.requestPermissionsAsync().catch(() => ({ granted: false }))
  if (!perm.granted) return 'denied'
  setRoofPref('wake', true)
  return 'ok'
}

/** 'hearing' = a call is starting ("Ei…", "Hey…", "Ei Ru…") and the phone is
 *  still writing it down — the dock shows three dots until it becomes
 *  "Ei Roof" (the sheet opens) or doesn't (they fade). */
export type WakeState = 'off' | 'waiting' | 'hearing' | 'unsupported'

/** Does `heard` END like the start of a call? Only the tail counts, so
 *  ordinary talk in the room doesn't light the dots. */
export function soundsLikeCalling(heard: string): boolean {
  const w = fold(heard).split(' ').filter(Boolean)
  const last = w[w.length - 1] ?? ''
  const prev = w[w.length - 2] ?? ''
  const strong = new RegExp(`^${CALL_STRONG}$`)
  if (strong.test(last)) return true
  return strong.test(prev) && /^(r|h|u|o|c)/.test(last)
}

// The last thing the wake listener heard — so the owner can see how the phone
// writes "Ei Roof" in their voice and we can teach it (2026-11). MEMORY ONLY:
// never stored or sent; gone when the app closes. Shown in Settings › Roof.
let lastHeard = ''
const heardSubs = new Set<() => void>()
export function roofLastHeard() {
  return lastHeard
}
export function onRoofHeard(f: () => void) {
  heardSubs.add(f)
  return () => {
    heardSubs.delete(f)
  }
}
function noteHeard(text: string) {
  const v = text.trim().slice(0, 80)
  if (!v || v === lastHeard) return
  lastHeard = v
  heardSubs.forEach((f) => f())
}

export interface WakeHandlers {
  /** The call was heard (the chime already played): open the sheet listening. */
  onWake: () => void
  /** What has been said after the call so far. */
  onHeard: (text: string) => void
  /** Finished: the request ('' = nothing came after the call). `handOff`:
   *  the recogniser ended on its own right after a bare call — the sheet
   *  should listen with its own mic, NOT quietly: there's a gap while it
   *  starts, so it says "one moment" and chimes when it's really live (the
   *  honest "talk now"; review 2026-11-14 H2). Called only once the wake
   *  chime has finished, so the new session can't cut it off. */
  onDone: (request: string, handOff: boolean) => void
}

/** Listens for "Ei Roof" while `enabled`. Bump `epoch` to re-arm it after a
 *  wake was handed off while `enabled` stayed true. */
export function useRoofWake(enabled: boolean, lang: string, handlers: WakeHandlers, epoch = 0): WakeState {
  const [state, setState] = useState<WakeState>('off')
  const handRef = useRef(handlers)
  useEffect(() => {
    handRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const m = speechModule()
    if (!enabled || !m || !onDeviceOk()) return
    let alive = true
    let running = false
    let fails = 0
    // Woke and finished: the caller turns this off; never restart in between.
    let held = false
    // This listener's claim on the shared recogniser (see voice.ts).
    const me = {}
    let woke: { req: string; seg: { done: string; current: string } } | null = null
    let settle: ReturnType<typeof setTimeout> | null = null
    let restart: ReturnType<typeof setTimeout> | null = null
    let refresh: ReturnType<typeof setTimeout> | null = null

    const clear = () => {
      for (const t of [settle, restart, refresh]) if (t) clearTimeout(t)
      settle = restart = refresh = null
    }
    // When the "I heard you" chime played: a session torn down while it's
    // still sounding cuts it off (iOS reconfigures the audio), which is why
    // the call was sometimes silent and only the closing chime was heard.
    let chimeAt = 0
    let hearingOff: ReturnType<typeof setTimeout> | null = null
    const fire = (handOff = false) => {
      if (!woke) return
      const req = woke.req
      woke = null
      running = false
      held = true
      clear()
      const left = CHIME_MS - (Date.now() - chimeAt)
      const abort = () => micAbort(me)
      // Let the chime finish before tearing the session down (and before the
      // sheet's own mic starts on a hand-off).
      if (left > 0 && !handOff) setTimeout(abort, left)
      else abort()
      const done = () => handRef.current.onDone(req, handOff && !req)
      if (handOff && !req && left > 0) setTimeout(() => alive && done(), left)
      else done()
    }
    const begin = async () => {
      if (!alive || held || running || AppState.currentState !== 'active') return
      const perm = await m.getPermissionsAsync?.().catch(() => null)
      if (!perm?.granted) {
        // Asking happens from the Settings switch, never out of the blue.
        setState('off')
        return
      }
      running = true
      woke = null
      try {
        micStart(me, {
          lang: LOCALE[lang] ?? 'pt-BR',
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: true,
          addsPunctuation: false,
          contextualStrings: ['Roof', 'Ei Roof', 'Hey Roof', 'One Roof', 'Rufi', 'Ei Rufi'],
          // Music playing on the phone keeps playing (mixWithOthers).
          iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'], mode: 'default' },
          ...(Platform.OS === 'android'
            ? { androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 60000, EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 60000 } }
            : {}),
        } as Parameters<typeof micStart>[1])
        setState('waiting')
        // A long continuous session keeps a growing transcript; start fresh
        // every minute so it stays light and a missed "end" can't stall it.
        refresh = setTimeout(() => {
          if (running && !woke) {
            running = false
            micStop(me)
          }
        }, 60000)
      } catch {
        running = false
        schedule()
      }
    }
    const schedule = () => {
      if (!alive || held || restart) return
      // Back off when the recogniser keeps failing (busy mic, no model).
      const wait = fails > 4 ? 15000 : 600 + fails * 600
      restart = setTimeout(() => {
        restart = null
        void begin()
      }, wait)
    }

    const subs = [
      m.addListener('result', (e: { results?: { transcript: string }[]; isFinal?: boolean }) => {
        if (!running || !micOwns(me)) return
        fails = 0
        const heard = e.results?.[0]?.transcript ?? ''
        noteHeard(heard)
        if (!woke) {
          const after = afterWake(heard)
          if (after === null) {
            // Maybe the start of a call: show the dots, drop them after a
            // beat of nothing more.
            if (soundsLikeCalling(heard)) {
              setState('hearing')
              if (hearingOff) clearTimeout(hearingOff)
              hearingOff = setTimeout(() => {
                hearingOff = null
                if (alive && !woke) setState('waiting')
              }, 1600)
            }
            return
          }
          if (hearingOff) clearTimeout(hearingOff)
          hearingOff = null
          // The call's own result may already be a pause-final ("Oi Casa
          // marca" [pause]): bank it, so the next stretch adds to it.
          const seg = { done: '', current: '' }
          stitch(seg, heard, !!e.isFinal)
          woke = { req: after, seg }
          playChime('start')
          chimeAt = Date.now()
          handRef.current.onWake()
        } else {
          // iOS restarts its transcript after a pause: join the stretches,
          // and a stretch without the call in it is all request.
          const full = stitch(woke.seg, heard, !!e.isFinal)
          woke.req = afterWake(full) ?? meaningfulRequest(full)
        }
        handRef.current.onHeard(woke.req)
        if (settle) clearTimeout(settle)
        // Words that stop changing = done (a "final" is only a pause on iOS
        // 18 — firing on it sent "marca uma" without the rest). Just the call:
        // keep this session (no gap, no lost words) and wait a while; if the
        // recogniser ends anyway, 'end' hands over to the sheet (fire(true)).
        settle = setTimeout(() => fire(false), woke.req ? SPEECH_SETTLE_MS : 7000)
      }),
      m.addListener('error', (e: { error?: string }) => {
        if (!running || !micOwns(me)) return
        running = false
        if (woke) return fire(true)
        if (e.error === 'not-allowed') {
          setState('off')
          return
        }
        // "no-speech" is just a quiet kitchen — not a failure.
        if (e.error !== 'no-speech' && e.error !== 'aborted') fails++
        schedule()
      }),
      m.addListener('end', () => {
        if (!micOwns(me)) return
        if (!running) {
          if (alive && !woke) schedule()
          return
        }
        running = false
        if (woke) return fire(true)
        schedule()
      }),
    ]
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        fails = 0
        void begin()
      } else if (running) {
        running = false
        clear()
        micAbort(me)
      }
    })
    void begin()
    return () => {
      alive = false
      clear()
      if (hearingOff) clearTimeout(hearingOff)
      app.remove()
      subs.forEach((s) => s.remove())
      // A delayed abort (letting the chime finish) is left to run on its own.
      if (running) {
        running = false
        // Off a beat later: closing the sheet mid-capture plays the stop
        // chime right now, and tearing the session down at once cut it off.
        // The listeners are already gone, so nothing it hears meanwhile counts.
        // A no-op if the sheet's mic has started meanwhile (owner token).
        setTimeout(() => micAbort(me), CHIME_MS)
      }
      setState('off')
    }
  }, [enabled, lang, epoch])

  if (!enabled || !speechModule()) return 'off'
  if (!onDeviceOk()) return 'unsupported'
  return state
}
