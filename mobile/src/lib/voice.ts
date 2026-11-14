// Voice input for the Home's ask bar (expo-speech-recognition: Apple's Speech
// framework on iOS, the system recogniser on Android). On-device where the OS
// can; results stream in as you speak and the final one is sent as the request.
//
// The native module is loaded LAZILY (guarded require): a build from before it
// was added has no such module, and a static import would throw at load and
// take the whole Home down with it (see "Don't statically import a native
// module" in CLAUDE.md). `voiceSupported()` is false there and the mic hides.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

type Sub = { remove: () => void }
interface SpeechModule {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>
  getPermissionsAsync?: () => Promise<{ granted: boolean }>
  start: (o: {
    lang: string
    interimResults: boolean
    continuous: boolean
    maxAlternatives?: number
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
type Player = { play: () => void; pause: () => void; seekTo: (s: number) => Promise<void>; volume: number }
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
      // The START chime plays while a recogniser is (about to be) recording.
      // expo-audio's default deactivates the shared iOS audio session ~0.1 s
      // after a player pauses or finishes (AudioModule.deactivateSession) —
      // which landed right as the user began to talk and stopped the mic
      // under them. keepAudioSessionActive turns that off for this player.
      // The STOP chime keeps the default: it plays once listening is over,
      // and its deactivation is what lets other apps' music resume.
      const start: Player = createAudioPlayer(require('../../assets/sounds/listen-start.wav'), { keepAudioSessionActive: true })
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
/** The chimes are 0.24 s; touching the mic before they end cuts them off. */
export const CHIME_MS = 280

function chime(which: 'start' | 'stop') {
  const p = chimes()?.[which]
  if (!p) return
  // A player that finished sits at the END of the file. seekTo is async, and
  // calling play() before the rewind lands plays nothing — which is why the
  // chimes sounded only every other time (owner, 2026-11: open → bip, close →
  // bip, then silence, then bip again…). Rewind first, THEN play. pause()
  // first stays: on Android a finished player still reports "playing" and a
  // bare seekTo(0) restarts it (see the games' sounds in CLAUDE.md); on iOS
  // the start player keeps the session active, so the pause is harmless.
  try {
    p.pause()
    p.seekTo(0).then(
      () => p.play(),
      () => p.play(),
    )
  } catch {
    /* a sound is never worth an error */
  }
}

/** Resolve once the app is foreground-ACTIVE again (or after `maxMs`). The
 *  system permission alerts leave it 'inactive', and starting the recogniser
 *  then fails to open the microphone. */
function whenActive(maxMs = 2500): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      sub.remove()
      clearTimeout(t)
      resolve()
    }
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') done()
    })
    const t = setTimeout(done, maxMs)
  })
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The native recogniser (or null on a build without it) — for Roof's wake
 *  listener (lib/roofWake), which shares the module with useVoice. */
export function speechModule() {
  return speech()
}

// ── who owns the microphone ──────────────────────────────────────────────────
// ONE native recogniser serves the wake listener and every useVoice (each
// AskSheet, the quiz). An abort() from one of them used to kill whatever was
// running: the Hub remounts AskSheet on a wake (new key), the old sheet's
// cleanup aborted — and took the wake capture down mid-request (review
// 2026-11-14, "marca uma consulta…" lost its start). Every start now claims
// the mic with a token, and only the current owner may stop or abort it; a
// delayed abort from an earlier owner (letting a chime finish) is a no-op once
// someone else started. Listeners also ignore events while they don't own it.
type MicOwner = object
let micOwner: MicOwner | null = null
/** Start the recogniser as `who` (the new owner). */
export function micStart(who: MicOwner, o: Parameters<SpeechModule['start']>[0]) {
  const m = speech()
  if (!m) return
  micOwner = who
  m.start(o)
}
export function micOwns(who: MicOwner): boolean {
  return micOwner === who
}
/** Stop gracefully (a final result, then 'end') — only if `who` owns it. */
export function micStop(who: MicOwner) {
  if (micOwner !== who) return
  try {
    speech()?.stop()
  } catch {
    /* already stopped */
  }
}
/** Abort — only if `who` still owns the mic. */
export function micAbort(who: MicOwner) {
  if (micOwner !== who) return
  micOwner = null
  try {
    speech()?.abort()
  } catch {
    /* already stopped */
  }
}

/** How long the words must stop changing before a spoken request counts as
 *  finished. iOS 18 flags EVERY pause as a final result (the module's
 *  speechDuration hack), so "final" can't mean "done"; silence can. */
export const SPEECH_SETTLE_MS = 1500
/** The listen chimes, for the wake listener's "I heard you". */
export function playChime(which: 'start' | 'stop') {
  chime(which)
}

export function voiceSupported(): boolean {
  return speech() !== null
}

/** Join a new result onto what's been heard. iOS 18 resets its transcript
 *  after a pause and reports only the new stretch, flagging the result just
 *  before the reset as final (isFinal at every pause). So:
 *  - a FINAL result banks its stretch — the next one starts fresh. ("Marca",
 *    final, then "uma consulta…" used to lose "Marca": the same length wasn't
 *    taken as a reset.)
 *  - a final that only repeats the stretch just banked is dropped;
 *  - without a final flag, a partial that no longer starts the way the
 *    current stretch did and is SHORTER is a reset too (a revision, "What's"
 *    → "What is on", keeps or grows its length). */
export function stitch(seg: { done: string; current: string }, next: string, isFinal = false): string {
  const join = (...xs: string[]) => xs.filter(Boolean).join(' ')
  const cur = seg.current.trim()
  const nxt = next.trim()
  if (!nxt) return join(seg.done, cur)
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
  const banked = key(seg.done)
  if (isFinal && !cur && banked && (banked === key(nxt) || banked.endsWith(' ' + key(nxt)))) return seg.done
  const head = (s: string) => s.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
  const continues = !cur || nxt.toLowerCase().startsWith(head(cur)) || head(nxt) === head(cur)
  const words = (s: string) => s.split(/\s+/).length
  if (!continues && words(nxt) < words(cur)) seg.done = join(seg.done, cur)
  if (isFinal) {
    seg.done = join(seg.done, nxt)
    seg.current = ''
    return seg.done
  }
  seg.current = nxt
  return join(seg.done, nxt)
}

const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

/** `starting` = the recogniser was asked to start but the microphone isn't
 *  delivering audio yet — anything said now would be lost, so the UI says
 *  "one moment" and the chime waits for `listening` (owner, 2026-11: speaking
 *  right after the tap lost the first words). */
export type VoiceState = 'idle' | 'starting' | 'listening' | 'denied' | 'error'

/** Listen once: `transcript` updates live; `onFinal` gets the last result. */
/** Short answers (the quiz): keep listening through silence (`continuous`),
 *  take each result as-is instead of stitching sentence fragments, and fold
 *  a word the recogniser repeated ("borboleta borboleta" → "borboleta"). */
export interface VoiceOptions {
  short?: boolean
}

/** "borboleta borboleta" / "Paris. Paris" → "borboleta" / "Paris": the same
 *  word or phrase said (or reported) twice in a row, once. */
export function foldRepeats(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const key = (w: string) => w.toLowerCase().replace(/[.,!?;:]+$/g, '')
  for (let n = 1; n <= words.length / 2; n++) {
    if (words.length % n) continue
    const unit = words.slice(0, n).map(key).join(' ')
    let same = true
    for (let i = n; i < words.length; i += n) if (words.slice(i, i + n).map(key).join(' ') !== unit) same = false
    if (same) return words.slice(0, n).join(' ').replace(/[.,!?;:]+$/g, '')
  }
  return text.trim()
}

/** No words at all for this long after the mic went live: a one-shot listen
 *  ends (iOS runs the sheet's mic in continuous mode, so nothing native ends
 *  it), and a conversation's follow-up listen stops — the TV in the room must
 *  not become requests (review 2026-11-14). */
const NO_SPEECH_MS = 6000
const FOLLOW_IDLE_MS = 10000

export function useVoice(
  lang: string,
  onFinal: (text: string, alternatives: string[]) => void,
  hints: string[] = [],
  opts: VoiceOptions = {},
) {
  const short = !!opts.short
  // iOS 18 marks every pause as a final result and, in one-shot mode, the
  // module ENDS the session there ("marca uma… [pause]" was sent as "marca
  // uma"). So on iOS the request mic runs continuous and the app decides the
  // end: SPEECH_SETTLE_MS of unchanged words, or the stop button. Android's
  // recogniser ends on its own silence and keeps its one-shot mode.
  const continuous = short || Platform.OS === 'ios'
  const ownEnd = continuous && !short
  const [me] = useState<object>(() => ({}))
  const hintsRef = useRef(hints)
  useEffect(() => {
    hintsRef.current = hints
  }, [hints])
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const latest = useRef('')
  // Every other guess the recogniser offered during this listen (short mode):
  // an accent turns "two" into "true" as the BEST guess while "two" is still
  // among the alternatives — the quiz checks them all (owner, 2026-11).
  const alts = useRef<string[]>([])
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
  /** This session reported 'start' (or audio / words): an 'end' before that
   *  belongs to the PREVIOUS session (an abort's 'end' arrives late). */
  const began = useRef(false)
  /** One silent retry per tap (see the 'error' listener). */
  const retryLeft = useRef(false)
  /** A retry is scheduled: the failed attempt's 'end' is ignored. */
  const retrying = useRef(false)
  /** Starts the native recogniser with the current options (set by start). */
  const begin = useRef<(() => void) | null>(null)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** End-of-speech (ownEnd) and no-speech timers. */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** A start that never reports anything (no 'start', audio, words or error). */
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quietStart = useRef(false)
  /** Keep listening through silence until cancel() (a conversation's
   *  follow-up, owner 2026-11-13: a few seconds wasn't enough to read the
   *  answer and reply) — but not forever: FOLLOW_IDLE_MS without a word ends
   *  it. Where the recogniser stops at each pause (Android) it's restarted
   *  quietly, showing "one moment" until the mic is live again. */
  const untilCancel = useRef(false)
  /** Restarts in a row that failed fast — a broken mic must not spin. */
  const quickRestarts = useRef(0)
  const lastRestart = useRef(0)
  /** Bumped by every start and cancel; a start that's been overtaken stops. */
  const startGen = useRef(0)
  /** start() is awaiting permissions / the app — not listening yet. */
  const opening = useRef(false)

  const clearTimers = useCallback(() => {
    for (const r of [fallback, settle, idle, watchdog]) {
      if (r.current) clearTimeout(r.current)
      r.current = null
    }
  }, [])

  /** Silence while listening: a one-shot listen that heard nothing ends; a
   *  conversation's follow-up stops (with the stop chime — it did stop). */
  const armIdle = useCallback(() => {
    if (idle.current) clearTimeout(idle.current)
    idle.current = null
    if (short || (!ownEnd && !untilCancel.current)) return
    idle.current = setTimeout(
      () => {
        idle.current = null
        if (!listening.current || latest.current.trim() || !micOwns(me)) return
        listening.current = false
        clearTimers()
        const chimed = live.current
        if (chimed) chime('stop')
        setState('idle')
        const gen = ++startGen.current
        // Let the chime finish before the session is torn down.
        if (!chimed) micAbort(me)
        else setTimeout(() => gen === startGen.current && micAbort(me), CHIME_MS)
      },
      untilCancel.current ? FOLLOW_IDLE_MS : NO_SPEECH_MS,
    )
  }, [short, ownEnd, me, clearTimers])

  const goLive = useCallback(() => {
    if (fallback.current) clearTimeout(fallback.current)
    fallback.current = null
    if (!listening.current || live.current) return
    live.current = true
    began.current = true
    if (watchdog.current) clearTimeout(watchdog.current)
    watchdog.current = null
    // A quiet start continues a listen the user already heard begin (a
    // conversation's next turn): no second chime.
    if (!quietStart.current) chime('start')
    setState('listening')
    // Not re-armed by a quiet restart (Android, see keepGoing): the silence
    // window counts from the last word, not from each restart.
    if (!latest.current.trim() && !idle.current) armIdle()
  }, [armIdle])

  useEffect(() => {
    const m = speech()
    if (!m) return
    const keepGoing = () => {
      const now = Date.now()
      quickRestarts.current = now - lastRestart.current < 1500 ? quickRestarts.current + 1 : 0
      lastRestart.current = now
      if (quickRestarts.current > 5) return false
      retrying.current = true
      latest.current = ''
      segments.current = { done: '', current: '' }
      // Deaf until the restarted recogniser is live again: say "one moment"
      // instead of "listening" meanwhile (quiet: no chime when it's back).
      live.current = false
      setState('starting')
      const gen = startGen.current
      setTimeout(() => {
        retrying.current = false
        if (gen === startGen.current && listening.current && untilCancel.current) {
          began.current = false
          begin.current?.()
        }
      }, 200)
      return true
    }
    /** Hand over what was heard (or close the listen with nothing). */
    const finish = (said: string) => {
      clearTimers()
      const wasLive = live.current
      listening.current = false
      // Mid-conversation a request just flows on — no chime (the stop chime
      // still plays when the sheet closes, via cancel()).
      if (wasLive && !(said && untilCancel.current)) chime('stop')
      setState('idle')
      if (said) finalRef.current(said, alts.current.filter((a) => a !== said))
    }
    const subs = [
      // The chime marks the moment you can talk: when the microphone is
      // actually delivering audio. 'start'/'audiostart' fire as soon as the
      // engine is told to run (iOS sends both back to back), so the first
      // VOLUME reading — computed from a real mic buffer — is the signal.
      // A recogniser that never reports volume still goes live after 'start'.
      m.addListener('start', () => {
        if (!micOwns(me) || !listening.current) return
        began.current = true
        if (live.current) return
        if (fallback.current) clearTimeout(fallback.current)
        fallback.current = setTimeout(goLive, 700)
      }),
      m.addListener('volumechange', () => {
        if (!micOwns(me) || !listening.current) return
        if (!live.current) goLive()
      }),
      m.addListener('result', (e: { results?: { transcript: string }[]; isFinal?: boolean }) => {
        if (!micOwns(me) || !listening.current) return
        began.current = true
        const raw = e.results?.[0]?.transcript ?? ''
        const text = short ? foldRepeats(raw) : stitch(segments.current, raw, !!e.isFinal)
        if (short) {
          for (const r of e.results ?? []) {
            const a = foldRepeats(r.transcript ?? '').trim()
            if (a && !alts.current.includes(a)) alts.current = [...alts.current, a].slice(-12)
          }
        }
        latest.current = text
        setTranscript(text)
        // Words arriving prove the mic is live (some Android recognisers never
        // report volume or 'start' the way iOS does).
        if (text.trim() && !live.current) goLive()
        if (!text.trim()) return
        if (idle.current) clearTimeout(idle.current)
        idle.current = null
        if (ownEnd) {
          // A final here is only a PAUSE (iOS 18). Done = the words stop
          // changing; then a graceful stop, and 'end' hands the text over.
          if (settle.current) clearTimeout(settle.current)
          settle.current = setTimeout(() => {
            settle.current = null
            if (listening.current) micStop(me)
          }, SPEECH_SETTLE_MS)
          return
        }
        if (e.isFinal) finish(text.trim())
      }),
      m.addListener('error', (e: { error?: string }) => {
        if (!micOwns(me) || !listening.current) return
        if (fallback.current) clearTimeout(fallback.current)
        // Failed BEFORE the mic ever went live, on the first try: the audio
        // session wasn't ready (typically right after the permission alerts).
        // Try once more, quietly, instead of "couldn't capture" (2026-11).
        if (!live.current && retryLeft.current && e.error !== 'not-allowed' && e.error !== 'aborted') {
          retryLeft.current = false
          retrying.current = true
          setTimeout(() => {
            retrying.current = false
            if (listening.current) {
              began.current = false
              begin.current?.()
            }
          }, 400)
          return
        }
        // Something WAS heard: an error on the way out must not drop it —
        // Android reports 'no-speech' / 'client' when a continuous listen is
        // stopped, and the quiz lost a perfectly heard "deserto do Saara"
        // to that (owner, 2026-11-13). Hand it over like a final result.
        const said = latest.current.trim()
        if (said && e.error !== 'not-allowed' && e.error !== 'aborted') return finish(said)
        // Silence in a conversation: listen again (see untilCancel).
        if (untilCancel.current && live.current && (e.error === 'no-speech' || e.error === 'speech-timeout') && keepGoing()) return
        finish('')
        // "no-speech"/"aborted" are a user stopping or saying nothing — just idle.
        setState(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'idle' : 'error')
      }),
      // Ended (the settle timer's stop, a tap on stop, Android's own end of
      // speech): send what was heard, if anything.
      m.addListener('end', () => {
        if (!micOwns(me) || !listening.current) return
        if (fallback.current) clearTimeout(fallback.current)
        // The failed first try ends too — a retry is already on its way, so
        // this 'end' must not close the listen. Nor may the late 'end' of the
        // session before this one (it arrives after our start was asked).
        if (retrying.current || !began.current) return
        // Ended on silence in a conversation: listen again, quietly.
        if (untilCancel.current && live.current && !latest.current.trim() && keepGoing()) return
        finish(latest.current.trim())
      }),
    ]
    return () => {
      subs.forEach((s) => s.remove())
      clearTimers()
      // A start still awaiting permissions must not open the mic later.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a DOM ref: bumping the live value is the point
      startGen.current++
      // Unmounted mid-listen (the sheet went away): still say it stopped.
      if (listening.current && live.current) chime('stop')
      const mine = listening.current || opening.current
      listening.current = false
      opening.current = false
      // Only OUR session: the Hub remounts the sheet on a wake (new key), and
      // the old sheet's abort used to kill the wake capture (review H1).
      if (mine) micAbort(me)
    }
  }, [goLive, short, ownEnd, me, clearTimers])

  const start = useCallback(async (opts?: { quiet?: boolean; untilCancel?: boolean }) => {
    const m = speech()
    if (!m) return
    // A cancel() that lands while we're still awaiting permissions must win:
    // otherwise the mic opened AFTER the sheet closed and answered silence
    // (owner, 2026-11: "Ei Roof", close the sheet, it kept listening).
    const gen = ++startGen.current
    clearTimers()
    quietStart.current = opts?.quiet === true
    untilCancel.current = opts?.untilCancel === true
    quickRestarts.current = 0
    opening.current = true
    // Was this the first time? Then the OS just showed its permission alerts,
    // and the app is still coming back from them — wait for it to be active
    // (plus a beat for the audio session) before opening the microphone. Doing
    // it at once is what made the very first try start and immediately end
    // with "couldn't capture" (owner, 2026-11).
    const before = await m.getPermissionsAsync?.().catch(() => null)
    const perm = await m.requestPermissionsAsync()
    if (!perm.granted) {
      opening.current = false
      setState('denied')
      return
    }
    const justAsked = !before?.granted
    if (gen !== startGen.current) return
    setState('starting')
    if (justAsked) {
      await whenActive()
      await sleep(350)
    }
    if (gen !== startGen.current) {
      setState('idle')
      return
    }
    opening.current = false
    latest.current = ''
    alts.current = []
    segments.current = { done: '', current: '' }
    setTranscript('')
    listening.current = true
    live.current = false
    began.current = false
    retryLeft.current = true
    retrying.current = false
    // Start AT ONCE, but say "one moment" until the mic is live (goLive):
    // the user waits for the chime instead of talking into a recogniser
    // that isn't hearing yet.
    setState('starting')
    // Nothing at all back from the recogniser (no 'start', audio, words or
    // error): don't sit on "one moment" forever.
    watchdog.current = setTimeout(() => {
      watchdog.current = null
      if (gen !== startGen.current || !listening.current || live.current) return
      listening.current = false
      setState('error')
      micAbort(me)
    }, 6000)
    begin.current = () =>
      micStart(me, {
        lang: LOCALE[lang] ?? 'en-US',
        interimResults: true,
        // See `continuous` above: the quiz (short) and every iOS listen keep
        // the mic open through a pause; the app decides when it's complete.
        continuous,
        // Several guesses per result (see `alts`); one is plenty otherwise.
        maxAlternatives: short ? 5 : 1,
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
    begin.current()
  }, [lang, short, continuous, me, clearTimers])

  /** Stop listening; whatever was heard so far is sent. */
  const stop = useCallback(() => {
    micStop(me)
  }, [me])

  /** Stop listening and DROP what was heard — the sheet is being dismissed.
   *  Plays the stop chime (when listening had gone live) so closing mid-listen
   *  sounds like it stopped, because it did. */
  const cancel = useCallback(() => {
    startGen.current++
    clearTimers()
    retrying.current = false
    if (!listening.current) {
      opening.current = false
      setState('idle')
      return
    }
    opening.current = false
    listening.current = false
    const chimed = live.current
    if (chimed) chime('stop')
    setState('idle')
    // Turning the mic off reconfigures the audio session, which cut the stop
    // chime in half (owner, 2026-11). Let it finish first. The owner token
    // makes the late abort a no-op once anyone (this hook or the wake
    // listener) has started a new session meanwhile.
    if (!chimed) {
      micAbort(me)
      return
    }
    const gen = startGen.current
    setTimeout(() => gen === startGen.current && micAbort(me), CHIME_MS)
  }, [me, clearTimers])

  return { state, transcript, start, stop, cancel }
}
