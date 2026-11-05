// Voice input for the Home's ask bar (expo-speech-recognition: Apple's Speech
// framework on iOS, the system recogniser on Android). On-device where the OS
// can; results stream in as you speak and the final one is sent as the request.
//
// The native module is loaded LAZILY (guarded require): a build from before it
// was added has no such module, and a static import would throw at load and
// take the whole Home down with it (see "Don't statically import a native
// module" in CLAUDE.md). `voiceSupported()` is false there and the mic hides.
import { useCallback, useEffect, useRef, useState } from 'react'
import { requireOptionalNativeModule } from 'expo-modules-core'

type Sub = { remove: () => void }
interface SpeechModule {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>
  start: (o: {
    lang: string
    interimResults: boolean
    continuous: boolean
    addsPunctuation?: boolean
    contextualStrings?: string[]
    volumeChangeEventOptions?: { enabled: boolean; intervalMillis?: number }
    iosCategory?: { category: string; categoryOptions: string[]; mode?: string }
  }) => void
  stop: () => void
  abort: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads differ per event
  addListener: (event: string, fn: (e: any) => void) => Sub
}

let mod: SpeechModule | null | undefined
function speech(): SpeechModule | null {
  if (mod !== undefined) return mod
  try {
    // Ask first, without throwing: requiring the package on a binary that lacks
    // the module raises inside expo-modules (a red box in dev) even though the
    // catch below would swallow it.
    if (!requireOptionalNativeModule('ExpoSpeechRecognition')) {
      mod = null
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-speech-recognition').ExpoSpeechRecognitionModule ?? null
    }
  } catch {
    mod = null
  }
  return mod ?? null
}

// ── the chimes: a soft rising "bip" when listening starts, falling when it
// stops (owner idea, 2026-11). Synthesised WAVs in assets/sounds. expo-audio is
// loaded the same guarded way — no module (an older build), no sound, no crash.
type Player = { play: () => void; seekTo: (s: number) => void | Promise<void>; volume: number }
let players: { start: Player; stop: Player } | null | undefined
function chimes() {
  if (players !== undefined) return players
  try {
    if (!requireOptionalNativeModule('ExpoAudio')) {
      players = null
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createAudioPlayer } = require('expo-audio')
      /* eslint-disable @typescript-eslint/no-require-imports */
      const start: Player = createAudioPlayer(require('../../assets/sounds/listen-start.wav'))
      const stop: Player = createAudioPlayer(require('../../assets/sounds/listen-stop.wav'))
      /* eslint-enable @typescript-eslint/no-require-imports */
      start.volume = 0.6
      stop.volume = 0.6
      players = { start, stop }
    }
  } catch {
    players = null
  }
  return players
}
function chime(which: 'start' | 'stop') {
  const p = chimes()?.[which]
  if (!p) return
  try {
    void p.seekTo(0)
    p.play()
  } catch {
    /* a sound is never worth an error */
  }
}

export function voiceSupported(): boolean {
  return speech() !== null
}

/** Join a new partial result onto what's been heard. A partial that no longer
 *  starts the way the current stretch did (and isn't a longer version of it)
 *  is a NEW stretch after a recogniser reset: bank the old one first. */
export function stitch(seg: { done: string; current: string }, next: string): string {
  const cur = seg.current.trim()
  const nxt = next.trim()
  if (!nxt) return [seg.done, cur].filter(Boolean).join(' ')
  const head = (s: string) => s.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
  const continues = !cur || nxt.toLowerCase().startsWith(head(cur)) || head(nxt) === head(cur)
  // A reset starts SHORT; a revision ("What's" → "What is on") keeps its length.
  const words = (s: string) => s.split(/\s+/).length
  if (!continues && words(nxt) < words(cur)) seg.done = [seg.done, cur].filter(Boolean).join(' ')
  seg.current = nxt
  return [seg.done, nxt].filter(Boolean).join(' ')
}

const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

/** `starting` = the recogniser was asked to start but the microphone isn't
 *  delivering audio yet — anything said now would be lost, so the UI says
 *  "one moment" and the chime waits for `listening` (owner, 2026-11: speaking
 *  right after the tap lost the first words). */
export type VoiceState = 'idle' | 'starting' | 'listening' | 'denied' | 'error'

/** Listen once: `transcript` updates live; `onFinal` gets the last result. */
export function useVoice(lang: string, onFinal: (text: string) => void, hints: string[] = []) {
  const hintsRef = useRef(hints)
  useEffect(() => {
    hintsRef.current = hints
  }, [hints])
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const latest = useRef('')
  // iOS 18's recogniser RESETS its transcript after a short pause mid-sentence
  // and from then on reports only the new stretch — "what is on… my shopping
  // list" arrived as "my shopping list" (owner, 2026-11). We keep the stretches
  // already heard and join them back up (see stitch()).
  const segments = useRef<{ done: string; current: string }>({ done: '', current: '' })
  // Mirrors `state` for the listeners, which are registered once.
  const listening = useRef(false)
  const finalRef = useRef(onFinal)
  useEffect(() => {
    finalRef.current = onFinal
  }, [onFinal])
  // Audio is really flowing: chime + "listening" — the cue to talk. Once per
  // start (both audiostart and the fallback timer can call it).
  const live = useRef(false)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)
  const goLive = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current)
    fallback.current = null
    if (!listening.current || live.current) return
    live.current = true
    chime('start')
    setState('listening')
  }, [])

  useEffect(() => {
    const m = speech()
    if (!m) return
    const subs = [
      // The chime marks the moment you can talk: when the microphone is
      // actually delivering audio. 'start'/'audiostart' fire as soon as the
      // engine is told to run (iOS sends both back to back), so the first
      // VOLUME reading — computed from a real mic buffer — is the signal.
      // A recogniser that never reports volume still goes live after 'start'.
      m.addListener('start', () => {
        if (!listening.current || live.current) return
        if (fallback.current) clearTimeout(fallback.current)
        fallback.current = setTimeout(goLive, 700)
      }),
      m.addListener('volumechange', () => {
        if (!live.current) goLive()
      }),
      m.addListener('result', (e: { results?: { transcript: string }[]; isFinal?: boolean }) => {
        const text = stitch(segments.current, e.results?.[0]?.transcript ?? '')
        latest.current = text
        setTranscript(text)
        if (e.isFinal && text.trim() && listening.current) {
          listening.current = false
          chime('stop')
          setState('idle')
          finalRef.current(text.trim())
        }
      }),
      m.addListener('error', (e: { error?: string }) => {
        if (fallback.current) clearTimeout(fallback.current)
        if (listening.current && live.current) chime('stop')
        listening.current = false
        // "no-speech"/"aborted" are a user stopping or saying nothing — just idle.
        setState(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'idle' : 'error')
      }),
      // Ended without a final result (a tap on stop, some Android recognisers):
      // send what was heard, if anything.
      m.addListener('end', () => {
        if (fallback.current) clearTimeout(fallback.current)
        if (!listening.current) return
        listening.current = false
        if (live.current) chime('stop')
        setState('idle')
        if (latest.current.trim()) finalRef.current(latest.current.trim())
      }),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      if (fallback.current) clearTimeout(fallback.current)
      // Unmounted mid-listen (the sheet went away): still say it stopped.
      if (listening.current && live.current) chime('stop')
      listening.current = false
      m.abort()
    }
  }, [goLive])

  const start = useCallback(async () => {
    const m = speech()
    if (!m) return
    const perm = await m.requestPermissionsAsync()
    if (!perm.granted) {
      setState('denied')
      return
    }
    latest.current = ''
    segments.current = { done: '', current: '' }
    setTranscript('')
    listening.current = true
    live.current = false
    // Start AT ONCE, but say "one moment" until the mic is live (goLive):
    // the user waits for the chime instead of talking into a recogniser
    // that isn't hearing yet.
    setState('starting')
    m.start({
      lang: LOCALE[lang] ?? 'en-US',
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      // The household's own words (stores, items, names, pets) — iOS biases
      // recognition toward them; "Publix" or "Thor" stop coming out as
      // ordinary words.
      contextualStrings: hintsRef.current.slice(0, 100),
      // Only used to learn when audio is really flowing (see 'volumechange').
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      // The module's default session mode is 'measurement', which turns iOS
      // OUTPUT right down while recording — the chimes came out faint and
      // seemed late (owner, 2026-11). 'default' keeps the loudspeaker.
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
        mode: 'default',
      },
    })
  }, [lang])

  /** Stop listening; whatever was heard so far is sent. */
  const stop = useCallback(() => {
    speech()?.stop()
  }, [])

  /** Stop listening and DROP what was heard — the sheet is being dismissed.
   *  Plays the stop chime (when listening had gone live) so closing mid-listen
   *  sounds like it stopped, because it did. */
  const cancel = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current)
    if (!listening.current) return
    listening.current = false
    if (live.current) chime('stop')
    setState('idle')
    speech()?.abort()
  }, [])

  return { state, transcript, start, stop, cancel }
}
