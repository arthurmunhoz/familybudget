import { useCallback, useEffect, useState } from 'react'

// Modo Casa on a browser (owner, 2026-11): a button hides the browser's bars,
// since a wall/kitchen device usually has no keyboard for F11. Uses the
// Fullscreen API (webkit-prefixed on Safari/iPad); hidden where the browser
// has none (iPhone Safari, or an installed PWA already full screen).
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

const doc = () => document as FsDoc
const current = () => !!(doc().fullscreenElement ?? doc().webkitFullscreenElement)
const standalone = () => window.matchMedia?.('(display-mode: standalone), (display-mode: fullscreen)').matches

export function useFullscreen() {
  const supported =
    typeof document !== 'undefined' && !standalone() && !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled)
  const [on, setOn] = useState(current)
  useEffect(() => {
    const sync = () => setOn(current())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  const toggle = useCallback(async () => {
    try {
      if (current()) {
        await (document.exitFullscreen ? document.exitFullscreen() : doc().webkitExitFullscreen?.())
      } else {
        const el = document.documentElement as FsEl
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.())
      }
    } catch {
      /* the browser said no — nothing to do */
    }
  }, [])
  return { supported, on, toggle }
}
