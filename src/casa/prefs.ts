// Modo Casa — this device's own display preferences (theme, layout, the idle
// photo frame), persisted in localStorage and shared live between the hub and
// the Settings sheet through a tiny external store.
import { useSyncExternalStore } from 'react'
import { lsGet, lsSet } from './util'

export type ThemePref = 'auto' | 'light' | 'dark'
export type LayoutPref = 'panel' | 'widgets'
/** Minutes without a touch before the photo frame takes over; 0 = never. */
export type FrameIdle = 0 | 5 | 15 | 30

export interface CasaPrefs {
  theme: ThemePref
  layout: LayoutPref
  frameIdle: FrameIdle
}

const KEY = 'casa.prefs'

function read(): CasaPrefs {
  const out: CasaPrefs = { theme: 'auto', layout: 'panel', frameIdle: 15 }
  try {
    const raw = JSON.parse(lsGet(KEY) ?? '{}') as Partial<CasaPrefs>
    if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto') out.theme = raw.theme
    if (raw.layout === 'panel' || raw.layout === 'widgets') out.layout = raw.layout
    if ([0, 5, 15, 30].includes(raw.frameIdle as number)) out.frameIdle = raw.frameIdle as FrameIdle
  } catch {
    /* defaults */
  }
  return out
}

let state = read()
const subs = new Set<() => void>()

export function setPrefs(patch: Partial<CasaPrefs>) {
  state = { ...state, ...patch }
  lsSet(KEY, JSON.stringify(state))
  subs.forEach((f) => f())
}

export function usePrefs(): CasaPrefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}
