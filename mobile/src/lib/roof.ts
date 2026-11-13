// Roof — the assistant's voice (owner, 2026-11-12). Two per-device switches
// and the spoken reply:
//   · wake  — "Ei Roof" / "Hey Roof" while the app is open on the Home
//             (lib/roofWake). OFF by default: the family opts in.
//   · speak — read the assistant's answer out loud. ON by default, but only
//             for a request that was SPOKEN (typing never talks back).
// Both are Plus features. With both off Roof still works by tapping the mic
// and answers on screen (owner: some families will prefer that).
//
// The voice is Azure's Thalita (picked by ear in a blind test), synthesised by
// /api/suggest-ping?action=speak. Each distinct sentence is cached on disk by
// a hash of its text, so the fixed lines ("Pronto…") cost nothing after once.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { useEffect, useSyncExternalStore } from 'react'

import { supabase } from '@/lib/supabase'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

// ── prefs ────────────────────────────────────────────────────────────────────

export interface RoofPrefs {
  wake: boolean
  speak: boolean
}
const KEY = 'roof.prefs.v1'
const DEFAULTS: RoofPrefs = { wake: false, speak: true }
let current: RoofPrefs = DEFAULTS
let loaded: Promise<RoofPrefs> | null = null
const subs = new Set<(p: RoofPrefs) => void>()

export function loadRoofPrefs(): Promise<RoofPrefs> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const j = raw ? (JSON.parse(raw) as Partial<RoofPrefs>) : {}
        // A switch flipped before the disk answered wins over what was stored.
        current = { ...DEFAULTS, ...j, ...touched }
        subs.forEach((f) => f(current))
        return current
      })
      .catch(() => current)
  }
  return loaded
}

// Prefs changed this session (see loadRoofPrefs).
let touched: Partial<RoofPrefs> = {}

export function setRoofPref<K extends keyof RoofPrefs>(k: K, v: RoofPrefs[K]) {
  touched = { ...touched, [k]: v }
  current = { ...current, [k]: v }
  subs.forEach((f) => f(current))
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {})
}

/** The live prefs: one store shared by every screen (Settings and the Home
 *  both read it), so a switch flipped in one shows in the other at once. The
 *  hook used to copy the launch-time value into local state and could hand a
 *  newly mounted screen the old one (2026-11-12). */
export function useRoofPrefs(): RoofPrefs {
  useEffect(() => {
    void loadRoofPrefs()
  }, [])
  return useSyncExternalStore(subscribe, snapshot)
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
const snapshot = () => current

// ── speaking ─────────────────────────────────────────────────────────────────

/** What gets read out: no emoji, one line, short. Same rule as the server. */
export function speakable(raw: string): string {
  return raw
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

/** Stable short hash (FNV-1a) — the cache file name for a sentence. */
export function voiceKey(lang: string, text: string): string {
  let h = 0x811c9dc5
  const s = `${lang}|${text}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

type Player = {
  play: () => void
  pause: () => void
  remove: () => void
  addListener: (e: 'playbackStatusUpdate', fn: (s: { didJustFinish?: boolean }) => void) => { remove: () => void }
}
let player: Player | null = null
function stopPlayer() {
  try {
    player?.pause()
    player?.remove()
  } catch {
    /* already gone */
  }
  player = null
}

function cacheDir(): Directory {
  const d = new Directory(Paths.cache, 'roof-voice')
  if (!d.exists) d.create({ intermediates: true, idempotent: true })
  return d
}

async function fetchVoice(text: string, lang: string): Promise<string | null> {
  if (!API_BASE) return null
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return null
  const res = await fetch(`${API_BASE}/api/suggest-ping?action=speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, lang }),
  })
  if (!res.ok) return null
  const j = (await res.json().catch(() => null)) as { audio?: string } | null
  return typeof j?.audio === 'string' && j.audio ? j.audio : null
}

let seq = 0

/** Say `text` in Roof's voice. Resolves when it finished (or failed — a voice
 *  is never worth an error; the answer is on screen either way). A newer call
 *  cuts off the one playing. */
export async function roofSay(text: string, lang: string): Promise<void> {
  const line = speakable(text)
  if (!line) return
  const my = ++seq
  stopPlayer()
  if (!requireOptionalNativeModule('ExpoAudio')) return
  try {
    const f = new File(cacheDir(), `${voiceKey(lang, line)}.mp3`)
    if (!f.exists) {
      const b64 = await fetchVoice(line, lang)
      if (!b64 || my !== seq) return
      f.write(b64, { encoding: 'base64' })
    }
    if (my !== seq) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAudioPlayer } = require('expo-audio')
    const p: Player = createAudioPlayer({ uri: f.uri })
    player = p
    await new Promise<void>((resolve) => {
      const sub = p.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          sub.remove()
          resolve()
        }
      })
      // A reply never runs past ~40 s; don't hang a caller on a lost event.
      setTimeout(resolve, 40000)
      p.play()
    })
    if (player === p) stopPlayer()
  } catch {
    /* fall back to the screen */
  }
}

/** Stop talking (the sheet closed, a new question started). */
export function roofHush() {
  seq++
  stopPlayer()
}
