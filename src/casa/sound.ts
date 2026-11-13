// Modo Casa sounds: a soft two-note chime synthesised with WebAudio (no
// asset), and Roof's spoken reply from /api/suggest-ping?action=speak. Any
// failure is silent — the answer is on screen either way.
import { supabase } from '../lib/supabase'
import { API_BASE } from './util'

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!C) return null
      ctx = new C()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Browsers only let audio start after a touch: wake the context on the first. */
export function unlockAudioOnFirstTouch(): () => void {
  const go = () => {
    audio()
    window.removeEventListener('pointerdown', go)
  }
  window.addEventListener('pointerdown', go)
  return () => window.removeEventListener('pointerdown', go)
}

function note(ac: AudioContext, freq: number, at: number, dur: number, gain: number) {
  const o = ac.createOscillator()
  const g = ac.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  // A quiet octave on top gives it a bell-like shimmer.
  const o2 = ac.createOscillator()
  const g2 = ac.createGain()
  o2.type = 'sine'
  o2.frequency.setValueAtTime(freq * 2, at)
  g2.gain.setValueAtTime(0, at)
  g2.gain.linearRampToValueAtTime(gain * 0.18, at + 0.01)
  g2.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.6)
  o.connect(g).connect(ac.destination)
  o2.connect(g2).connect(ac.destination)
  o.start(at)
  o2.start(at)
  o.stop(at + dur + 0.05)
  o2.stop(at + dur + 0.05)
}

/** 'start' = "I'm listening" (rising), 'done' = a soft tick (confirmations). */
export function chime(kind: 'start' | 'done' | 'close' = 'start') {
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.02
  if (kind === 'start') {
    note(ac, 659.25, t, 0.28, 0.16) // E5
    note(ac, 987.77, t + 0.09, 0.42, 0.13) // B5
  } else if (kind === 'done') {
    note(ac, 783.99, t, 0.22, 0.1) // G5
    note(ac, 1046.5, t + 0.07, 0.34, 0.09) // C6
  } else {
    note(ac, 880, t, 0.2, 0.08)
    note(ac, 587.33, t + 0.08, 0.3, 0.07)
  }
}

/** A light "tap" for ticking things off. */
export function tick() {
  const ac = audio()
  if (!ac) return
  note(ac, 1318.5, ac.currentTime + 0.01, 0.12, 0.06)
}

let playing: HTMLAudioElement | null = null
let seq = 0

/** Roof says `text`. Resolves when finished — or at once on any failure
 *  (402 = no voice on this plan, network, autoplay blocked). */
export async function speak(text: string, lang: string): Promise<void> {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!line) return
  const my = ++seq
  stopSpeaking()
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    const res = await fetch(`${API_BASE}/api/suggest-ping?action=speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: line, lang }),
    })
    if (!res.ok || my !== seq) return
    const j = (await res.json().catch(() => null)) as { audio?: string } | null
    if (!j?.audio || my !== seq) return
    const el = new Audio(`data:audio/mpeg;base64,${j.audio}`)
    playing = el
    await new Promise<void>((resolve) => {
      el.onended = () => resolve()
      el.onerror = () => resolve()
      el.play().catch(() => resolve())
    })
  } catch {
    /* silent */
  } finally {
    if (my === seq) playing = null
  }
}

export function stopSpeaking() {
  if (playing) {
    try {
      playing.pause()
    } catch {
      /* noop */
    }
    playing = null
  }
}
