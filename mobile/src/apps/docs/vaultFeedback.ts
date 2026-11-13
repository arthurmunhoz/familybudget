// Sounds for the vault opening (scripts/make-vault-sounds.py). expo-audio is
// required LAZILY and guarded, like the games' feedback: an older binary just
// plays nothing. Respects the silent switch. Haptics come from the games'
// helper (same guarded module).
/* eslint-disable @typescript-eslint/no-require-imports -- bundled sounds + lazily-loaded native module */
import { haptic } from '@/apps/games/feedback'

export type VaultSound = 'dial' | 'clunk' | 'open'

const FILES: Record<VaultSound, number> = {
  dial: require('../../../assets/sounds/vault/dial.wav'),
  clunk: require('../../../assets/sounds/vault/clunk.wav'),
  open: require('../../../assets/sounds/vault/open.wav'),
}

interface Player {
  play: () => void
  pause?: () => void
  seekTo: (s: number) => Promise<void> | void
  volume: number
  remove?: () => void
}

let players: Partial<Record<VaultSound, Player>> | null = null

/** Load the three players up front (the first play would otherwise wait). */
export function preloadVault() {
  if (players) return
  try {
    // Check the native side first: requiring expo-audio on a binary without
    // it throws at module load (and shows a red box in development).
    const { requireOptionalNativeModule } = require('expo-modules-core')
    if (!requireOptionalNativeModule('ExpoAudio')) {
      players = {}
      return
    }
    const audio = require('expo-audio')
    void audio.setAudioModeAsync?.({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' })
    players = {}
    for (const k of Object.keys(FILES) as VaultSound[]) {
      const p = audio.createAudioPlayer(FILES[k]) as Player
      // Quiet on purpose (owner, 2026-11-13): it's a flourish, not an alarm.
      p.volume = k === 'open' ? 0.4 : 0.45
      players[k] = p
    }
  } catch {
    players = {}
  }
}

export function vaultSound(name: VaultSound) {
  const p = players?.[name]
  if (!p) return
  try {
    p.pause?.()
    const r = p.seekTo(0)
    if (r && typeof r.then === 'function') r.then(() => p.play(), () => p.play())
    else p.play()
  } catch {
    // never let a sound break the unlock
  }
}

export { haptic }
