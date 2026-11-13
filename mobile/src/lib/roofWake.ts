// "Ei Roof" — hands-free wake while the app is open on the Home (owner,
// 2026-11-12). No wake-word engine: the phone's OWN recogniser runs ON-DEVICE
// (requiresOnDeviceRecognition — nothing leaves the phone while it waits) and
// we watch its words for "ei/hey roof". The moment the call is heard: ONE
// chime and `onWake` (the Home opens the ask sheet already showing
// "listening"), and this same recogniser keeps going — no second start, no
// second chime (owner, 2026-11: two chimes left people unsure when to talk).
// What follows streams to `onHeard`; a pause after words (or ~7 s of nothing)
// ends it with `onDone(request)`.
//
// Never runs in the background (iOS/Android forbid the mic there) and never
// where on-device recognition isn't available — then the switch says so.
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { setRoofPref } from '@/lib/roof'
import { playChime, speechModule, stitch } from '@/lib/voice'

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
const CALL_STRONG = '(?:ei|hey|hei|ey|ai|oi|hay|oye|rei|eai|ok|okay)'
const CALL_WEAK = '(?:e|a)'
const SOUNDS_LIKE = '(?:r|rr|h)(?:u|o|ou|oo)(?:f|ff|ph|v|b)(?:e|i|y|o|u|a|ie|io|ia|ey)?s?'
const NAME =
  '(?:roof|roofs|roofe|ruf|ruff|ruffe|rufe|rufi|rufo|rufu|rufy|ruffy|rufus|ruth|rute|roofy|roofie|rouf|rof|rofe|rough|ruv|ru|rou|hoof|hoofe|huf|hufe|hufi|hufo|houf|uf|ufe|ufi)'
const WAKE = new RegExp(
  `(?:^|\\s)(?:${CALL_STRONG}\\s+(?:${NAME}|${SOUNDS_LIKE})|${CALL_WEAK}\\s+${NAME})(?:\\s|$)|^roof(?:\\s|$)`,
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
  return strong.test(prev) && /^(r|h|u|o)/.test(last)
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
   *  the recogniser stopped on its own right after a bare call (iOS ends a
   *  session at the pause after "Ei Roof") — the sheet should keep listening
   *  with its own mic — 'quiet' when the wake chime surely played, 'chime'
   *  when the session ended so soon after it that iOS may have cut it off
   *  (then the sheet's mic chimes as it goes live, so the user always hears
   *  exactly one "talk now"). */
  onDone: (request: string, handOff: false | 'quiet' | 'chime') => void
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
      const abort = () => {
        try {
          m.abort()
        } catch {
          /* already stopped */
        }
      }
      // Let the chime finish before tearing the session down.
      if (left > 0 && !handOff) setTimeout(abort, left)
      else abort()
      handRef.current.onDone(req, handOff && !req ? 'quiet' : false)
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
        m.start({
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
        } as Parameters<typeof m.start>[0])
        setState('waiting')
        // A long continuous session keeps a growing transcript; start fresh
        // every minute so it stays light and a missed "end" can't stall it.
        refresh = setTimeout(() => {
          if (running && !woke) {
            running = false
            try {
              m.stop()
            } catch {
              /* noop */
            }
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
        if (!running) return
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
          woke = { req: after, seg: { done: '', current: heard } }
          playChime('start')
          chimeAt = Date.now()
          handRef.current.onWake()
        } else {
          // iOS restarts its transcript after a pause: join the stretches,
          // and a stretch without the call in it is all request.
          const full = stitch(woke.seg, heard)
          woke.req = afterWake(full) ?? meaningfulRequest(full)
        }
        handRef.current.onHeard(woke.req)
        if (settle) clearTimeout(settle)
        if (e.isFinal && woke.req) return fire()
        // A pause after words = done. Just the call: keep this session (no gap,
        // no lost words) and wait a while; if iOS ends it at the pause, 'end'
        // hands the listening over to the sheet instead (fire(true)).
        settle = setTimeout(() => fire(false), woke.req ? 1300 : 7000)
      }),
      m.addListener('error', (e: { error?: string }) => {
        if (!running) return
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
        try {
          m.abort()
        } catch {
          /* noop */
        }
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
        setTimeout(() => {
          try {
            m.abort()
          } catch {
            /* noop */
          }
        }, CHIME_MS)
      }
      setState('off')
    }
  }, [enabled, lang, epoch])

  if (!enabled || !speechModule()) return 'off'
  if (!onDeviceOk()) return 'unsupported'
  return state
}
