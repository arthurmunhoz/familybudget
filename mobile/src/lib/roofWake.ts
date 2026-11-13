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
const CALL = '(?:ei|hey|hei|ey|ai|oi|e|a|hay|oye|rei|eai)'
// An American "roof" said inside Portuguese often comes back as rough/rof/ru…
const NAME =
  '(?:roof|roofs|roofe|ruf|ruff|ruffe|rufe|rufi|rufo|rufu|rufy|ruffy|rufus|ruth|rute|roofy|roofie|rouf|rof|rofe|rough|ruv|ru|rou|hoof|hoofe|huf|hufe|hufi|hufo|houf|uf|ufe|ufi)'
const WAKE = new RegExp(`(?:^|\\s)${CALL}\\s+${NAME}(?:\\s|$)|^roof(?:\\s|$)`)

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
  return words
    .slice(i)
    .join(' ')
    .replace(/^[\s,.;:!?-]+/, '')
    .trim()
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

export type WakeState = 'off' | 'waiting' | 'unsupported'

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
   *  with its own mic, quietly. */
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
    let woke: { req: string; seg: { done: string; current: string } } | null = null
    let settle: ReturnType<typeof setTimeout> | null = null
    let restart: ReturnType<typeof setTimeout> | null = null
    let refresh: ReturnType<typeof setTimeout> | null = null

    const clear = () => {
      for (const t of [settle, restart, refresh]) if (t) clearTimeout(t)
      settle = restart = refresh = null
    }
    const fire = (handOff = false) => {
      if (!woke) return
      const req = woke.req
      woke = null
      running = false
      held = true
      clear()
      try {
        m.abort()
      } catch {
        /* already stopped */
      }
      handRef.current.onDone(req, handOff && !req)
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
          contextualStrings: ['Roof', 'Ei Roof', 'Hey Roof', 'One Roof'],
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
          if (after === null) return
          woke = { req: after, seg: { done: '', current: heard } }
          playChime('start')
          handRef.current.onWake()
        } else {
          // iOS restarts its transcript after a pause: join the stretches,
          // and a stretch without the call in it is all request.
          const full = stitch(woke.seg, heard)
          woke.req = afterWake(full) ?? full.trim()
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
      app.remove()
      subs.forEach((s) => s.remove())
      if (running) {
        running = false
        try {
          m.abort()
        } catch {
          /* noop */
        }
      }
      setState('off')
    }
  }, [enabled, lang, epoch])

  if (!enabled || !speechModule()) return 'off'
  if (!onDeviceOk()) return 'unsupported'
  return state
}
