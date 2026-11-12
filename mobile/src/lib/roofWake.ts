// "Ei Roof" — hands-free wake while the app is open on the Home (owner,
// 2026-11-12). No wake-word engine: the phone's OWN recogniser runs ON-DEVICE
// (requiresOnDeviceRecognition — nothing leaves the phone while it waits) and
// we watch its words for "ei/hey roof". Whatever was said after it in the same
// breath ("Ei Roof, põe café na lista") is the request; a bare "Ei Roof" opens
// the ask sheet listening.
//
// Never runs in the background (iOS/Android forbid the mic there) and never
// where on-device recognition isn't available — then the switch says so.
import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'

import { playChime, speechModule } from '@/lib/voice'

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
const CALL = '(?:ei|hey|hei|ey|ai|oi|e|a|hay|oye)'
const NAME = '(?:roof|roofs|ruf|ruff|rufe|rufi|rufo|rufy|ruffy|rufus|ruth|roofy|roofie|rouf|hoof)'
const WAKE = new RegExp(`(?:^|\\s)${CALL}\\s+${NAME}(?:\\s|$)`)

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

export type WakeState = 'off' | 'waiting' | 'unsupported'

/** Listens for "Ei Roof" while `enabled`. `onWake(request)` gets what followed
 *  the wake phrase ('' = just the call). */
export function useRoofWake(enabled: boolean, lang: string, onWake: (request: string) => void): WakeState {
  const [state, setState] = useState<WakeState>('off')
  const wakeRef = useRef(onWake)
  useEffect(() => {
    wakeRef.current = onWake
  }, [onWake])

  useEffect(() => {
    const m = speechModule()
    if (!enabled || !m || !onDeviceOk()) return
    let alive = true
    let running = false
    let fails = 0
    // Woke and handed off: the caller takes the mic (the ask sheet) and turns
    // this off; never restart in between.
    let held = false
    let woke: { at: number; req: string } | null = null
    let settle: ReturnType<typeof setTimeout> | null = null
    let restart: ReturnType<typeof setTimeout> | null = null
    let refresh: ReturnType<typeof setTimeout> | null = null

    const clear = () => {
      for (const t of [settle, restart, refresh]) if (t) clearTimeout(t)
      settle = restart = refresh = null
    }
    const fire = () => {
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
      wakeRef.current(req)
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
        const after = afterWake(heard)
        if (after === null) return
        if (!woke) {
          woke = { at: Date.now(), req: after }
          playChime('start')
        } else woke.req = after
        if (settle) clearTimeout(settle)
        // Wait for the sentence to finish: a pause after words = done; just
        // "Ei Roof" with nothing more for a moment = open the sheet listening.
        if (e.isFinal) return fire()
        settle = setTimeout(fire, after ? 1300 : 1800)
      }),
      m.addListener('error', (e: { error?: string }) => {
        if (!running) return
        running = false
        if (woke) return fire()
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
        if (woke) return fire()
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
  }, [enabled, lang])

  if (!enabled || !speechModule()) return 'off'
  if (!onDeviceOk()) return 'unsupported'
  return state
}
