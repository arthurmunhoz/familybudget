// Sounds + haptics for the games. Both native modules are loaded LAZILY with a
// guarded require (see "Don't statically import a native module" in CLAUDE.md):
// an older binary without expo-haptics just plays no buzz instead of crashing.
// Sounds come from scripts/make-game-sounds.py (original, synthesised).
//
// Players are created once (a small pool for quick UI sounds) and rewound
// when they finish, so rapid taps neither pile up players nor get dropped. A per-device mute lives in
// AsyncStorage ('games.muted').
/* eslint-disable @typescript-eslint/no-require-imports -- bundled sounds + lazily-loaded native modules (see header) */
import AsyncStorage from '@react-native-async-storage/async-storage'

export type GameSound = 'tap' | 'pop' | 'ready' | 'hit' | 'miss' | 'turn' | 'start' | 'win' | 'lose' | 'trophy' | 'splash' | 'boom' | 'sink' | 'whoosh' | 'buzzer' | 'correct' | 'wrong' | 'tick' | 'applause' | 'splat' | 'rattle' | 'drop' | 'call' | 'dab'

const FILES: Record<GameSound, number> = {
  tap: require('../../../assets/sounds/games/tap.wav'),
  pop: require('../../../assets/sounds/games/pop.wav'),
  ready: require('../../../assets/sounds/games/ready.wav'),
  hit: require('../../../assets/sounds/games/hit.wav'),
  miss: require('../../../assets/sounds/games/miss.wav'),
  turn: require('../../../assets/sounds/games/turn.wav'),
  start: require('../../../assets/sounds/games/start.wav'),
  win: require('../../../assets/sounds/games/win.wav'),
  lose: require('../../../assets/sounds/games/lose.wav'),
  trophy: require('../../../assets/sounds/games/trophy.wav'),
  splash: require('../../../assets/sounds/games/splash.wav'),
  boom: require('../../../assets/sounds/games/boom.wav'),
  sink: require('../../../assets/sounds/games/sink.wav'),
  whoosh: require('../../../assets/sounds/games/whoosh.wav'),
  buzzer: require('../../../assets/sounds/games/buzzer.wav'),
  correct: require('../../../assets/sounds/games/correct.wav'),
  wrong: require('../../../assets/sounds/games/wrong.wav'),
  tick: require('../../../assets/sounds/games/tick.wav'),
  applause: require('../../../assets/sounds/games/applause.wav'),
  splat: require('../../../assets/sounds/games/splat.wav'),
  rattle: require('../../../assets/sounds/games/rattle.wav'),
  drop: require('../../../assets/sounds/games/drop.wav'),
  call: require('../../../assets/sounds/games/call.wav'),
  dab: require('../../../assets/sounds/games/dab.wav'),
}

interface Player {
  play: () => void
  pause?: () => void
  seekTo: (s: number) => Promise<void> | void
  volume: number
  addListener?: (ev: 'playbackStatusUpdate', cb: (st: { didJustFinish?: boolean }) => void) => unknown
}

// One loaded player per voice. Quick UI sounds get a few voices each, played
// round-robin: with a single player a second tap that landed while the first
// was still sounding (or still rewinding) was swallowed (owner, 2026-11).
const VOICES: Partial<Record<GameSound, number>> = { tap: 4, tick: 3, pop: 2, dab: 3 }

interface Voice {
  p: Player
  /** At position 0 and ready — play() can go out right away, no seek wait. */
  rewound: boolean
}

const pools = new Map<GameSound, { voices: Voice[]; next: number }>()
let audioOk: boolean | null = null
let muted = false
const MUTE_KEY = 'games.muted'

void AsyncStorage.getItem(MUTE_KEY).then((v) => {
  muted = v === '1'
})

export function isMuted() {
  return muted
}
export function setMuted(m: boolean) {
  muted = m
  void AsyncStorage.setItem(MUTE_KEY, m ? '1' : '0')
}

function makeVoice(audio: { createAudioPlayer: (src: number) => Player }, name: GameSound): Voice {
  const p = audio.createAudioPlayer(FILES[name])
  p.volume = name === 'tap' ? 0.45 : 0.85
  const v: Voice = { p, rewound: true }
  // Rewind as soon as a run ends, so the NEXT play needs no async seek first
  // (waiting on the seek is what made taps sound late).
  try {
    p.addListener?.('playbackStatusUpdate', (st) => {
      // Ignore a finish we didn't start: if a player ever restarted by itself
      // after the rewind, this lets it end at most once more, never loop.
      if (!st.didJustFinish || v.rewound) return
      // PAUSE before rewinding: on Android the player stays "playing" at the
      // end, so a bare seekTo(0) starts it again → finishes → rewinds → an
      // endless chime (Galaxy, 2026-11). iOS pauses by itself at the end.
      p.pause?.()
      const r = p.seekTo(0)
      if (r && typeof r.then === 'function') r.then(() => (v.rewound = true), () => undefined)
      else v.rewound = true
    })
  } catch {
    // no listener support: sound() falls back to seek-then-play
  }
  return v
}

function pool(name: GameSound) {
  if (audioOk === false) return null
  const existing = pools.get(name)
  if (existing) return existing
  try {
    // Native side first: requiring expo-audio on a binary without it throws
    // at module load (a red box in development).
    const { requireOptionalNativeModule } = require('expo-modules-core')
    if (!requireOptionalNativeModule('ExpoAudio')) {
      audioOk = false
      return null
    }
    const audio = require('expo-audio')
    if (audioOk === null) {
      // Play alongside music/podcasts and respect the silent switch.
      void audio.setAudioModeAsync?.({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })
      audioOk = true
    }
    const voices = Array.from({ length: VOICES[name] ?? 1 }, () => makeVoice(audio, name))
    const made = { voices, next: 0 }
    pools.set(name, made)
    return made
  } catch {
    audioOk = false
    return null
  }
}

/** Create (load) the players up front — the FIRST play of a sound otherwise
 *  waits for its file to load, which is what made impacts land late. Call
 *  when a game screen opens. */
export function preloadSounds(names: GameSound[] = Object.keys(FILES) as GameSound[]) {
  for (const n of names) pool(n)
}

/** Fade a sound out over `fadeMs` and stop it (a long recording that must
 *  end when something happens — the bingo cage when the ball comes out). */
export function stopSound(name: GameSound, fadeMs = 300) {
  const pl = pools.get(name)
  if (!pl) return
  const base = name === 'tap' ? 0.45 : 0.85
  for (const v of pl.voices) {
    if (v.rewound) continue
    const p = v.p
    const steps = Math.max(1, Math.round(fadeMs / 40))
    let k = 0
    const id = setInterval(() => {
      k++
      try {
        p.volume = base * Math.max(0, 1 - k / steps)
      } catch {
        // gone
      }
      if (k < steps) return
      clearInterval(id)
      try {
        p.pause?.()
        const r = p.seekTo(0)
        const done = () => {
          p.volume = base
          v.rewound = true
        }
        if (r && typeof r.then === 'function') r.then(done, done)
        else done()
      } catch {
        // never let a sound take a turn down
      }
    }, 40)
  }
}

export function sound(name: GameSound) {
  if (muted) return
  const pl = pool(name)
  if (!pl) return
  // Prefer a voice that is rewound and idle; else take the next in turn.
  let i = pl.voices[pl.next].rewound ? pl.next : pl.voices.findIndex((v) => v.rewound)
  if (i < 0) i = pl.next
  pl.next = (i + 1) % pl.voices.length
  const v = pl.voices[i]
  try {
    if (v.rewound) {
      v.rewound = false
      v.p.play()
      return
    }
    // Rewind FIRST, then play. seekTo is async: calling play() right after
    // it raced the rewind, so a player left at the end of its last run
    // sometimes played nothing (the missing explosions, owner 2026-11).
    const r = v.p.seekTo(0)
    if (r && typeof r.then === 'function') r.then(() => v.p.play(), () => v.p.play())
    else v.p.play()
  } catch {
    // never let a sound take a turn down
  }
}

type HapticKind = 'light' | 'medium' | 'success' | 'error' | 'select'
let haptics: Record<string, (...a: unknown[]) => Promise<void>> | null | undefined

function hapticsMod() {
  if (haptics !== undefined) return haptics
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core')
    haptics = requireOptionalNativeModule('ExpoHaptics') ? require('expo-haptics') : null
  } catch {
    haptics = null
  }
  return haptics
}

export function haptic(kind: HapticKind) {
  const h = hapticsMod()
  if (!h) return
  try {
    if (kind === 'select') void h.selectionAsync()
    else if (kind === 'success') void h.notificationAsync('success')
    else if (kind === 'error') void h.notificationAsync('error')
    else void h.impactAsync(kind)
  } catch {
    // ignore
  }
}

/** Sound + matching haptic in one call — what most game events want. */
export function feedback(name: GameSound) {
  sound(name)
  if (name === 'tap') haptic('select')
  else if (name === 'hit' || name === 'ready' || name === 'pop') haptic('light')
  else if (name === 'miss' || name === 'splash') haptic('light')
  else if (name === 'boom' || name === 'sink') haptic('medium')
  else if (name === 'win' || name === 'trophy' || name === 'applause' || name === 'start' || name === 'correct') haptic('success')
  else if (name === 'buzzer') haptic('medium')
  else if (name === 'wrong') haptic('error')
  else if (name === 'tick') haptic('select')
  else if (name === 'lose') haptic('error')
  else if (name === 'turn') haptic('medium')
  else if (name === 'dab') haptic('light')
  else if (name === 'call') haptic('medium')
}
