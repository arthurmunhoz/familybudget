// Voice input for the Home's ask bar (expo-speech-recognition: Apple's Speech
// framework on iOS, the system recogniser on Android). On-device where the OS
// can; results stream in as you speak and the final one is sent as the request.
//
// The native module is loaded LAZILY (guarded require): a build from before it
// was added has no such module, and a static import would throw at load and
// take the whole Home down with it (see "Don't statically import a native
// module" in CLAUDE.md). `voiceSupported()` is false there and the mic hides.
import { useCallback, useEffect, useRef, useState } from 'react'

type Sub = { remove: () => void }
interface SpeechModule {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>
  start: (o: { lang: string; interimResults: boolean; continuous: boolean; addsPunctuation?: boolean }) => void
  stop: () => void
  abort: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads differ per event
  addListener: (event: string, fn: (e: any) => void) => Sub
}

let mod: SpeechModule | null | undefined
function speech(): SpeechModule | null {
  if (mod !== undefined) return mod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-speech-recognition').ExpoSpeechRecognitionModule ?? null
  } catch {
    mod = null
  }
  return mod ?? null
}

export function voiceSupported(): boolean {
  return speech() !== null
}

const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

export type VoiceState = 'idle' | 'listening' | 'denied' | 'error'

/** Listen once: `transcript` updates live; `onFinal` gets the last result. */
export function useVoice(lang: string, onFinal: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const latest = useRef('')
  // Mirrors `state` for the listeners, which are registered once.
  const listening = useRef(false)
  const finalRef = useRef(onFinal)
  useEffect(() => {
    finalRef.current = onFinal
  }, [onFinal])

  useEffect(() => {
    const m = speech()
    if (!m) return
    const subs = [
      m.addListener('result', (e: { results?: { transcript: string }[]; isFinal?: boolean }) => {
        const text = e.results?.[0]?.transcript ?? ''
        latest.current = text
        setTranscript(text)
        if (e.isFinal && text.trim() && listening.current) {
          listening.current = false
          setState('idle')
          finalRef.current(text.trim())
        }
      }),
      m.addListener('error', (e: { error?: string }) => {
        listening.current = false
        // "no-speech"/"aborted" are a user stopping or saying nothing — just idle.
        setState(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'idle' : 'error')
      }),
      // Ended without a final result (a tap on stop, some Android recognisers):
      // send what was heard, if anything.
      m.addListener('end', () => {
        if (!listening.current) return
        listening.current = false
        setState('idle')
        if (latest.current.trim()) finalRef.current(latest.current.trim())
      }),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      m.abort()
    }
  }, [])

  const start = useCallback(async () => {
    const m = speech()
    if (!m) return
    const perm = await m.requestPermissionsAsync()
    if (!perm.granted) {
      setState('denied')
      return
    }
    latest.current = ''
    setTranscript('')
    listening.current = true
    setState('listening')
    m.start({ lang: LOCALE[lang] ?? 'en-US', interimResults: true, continuous: false, addsPunctuation: false })
  }, [lang])

  /** Stop listening; whatever was heard so far is sent. */
  const stop = useCallback(() => {
    speech()?.stop()
  }, [])

  return { state, transcript, start, stop }
}
