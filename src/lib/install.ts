// Add-to-Home-Screen support. There's no Play Store listing yet, so installing
// the PWA IS the install path on Android — worth making one tap instead of a
// hunt through the browser menu.
//
// Chrome fires `beforeinstallprompt` once, early, and only if the app is
// installable (manifest + service worker + not already installed). React isn't
// mounted yet at that point, so the listener has to be registered at import time
// from main.tsx and the event stashed for whoever asks later. Calling .prompt()
// still needs a user gesture, which is why we keep the event rather than the
// browser's own banner.
import { isStandalone } from './push'

/** The slice of BeforeInstallPromptEvent we use (not in lib.dom yet). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Registered from main.tsx at startup — the event fires before React mounts. */
export function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's own mini-infobar so our card is the single prompt.
    e.preventDefault()
    deferred = e as InstallPromptEvent
    emit()
  })
  // Installed (from our button or the browser menu) → nothing left to offer.
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

export function canInstall(): boolean {
  return deferred !== null
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Show the native install dialog. Returns true if they accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  // The event is single-use — Chrome won't hand it to us again this page load.
  deferred = null
  emit()
  return outcome === 'accepted'
}

/** iOS Safari never fires beforeinstallprompt; installing is a manual
 *  Share → "Add to Home Screen". Detect it so we can say so instead of
 *  showing a button that can't work. */
export function needsIosInstructions(): boolean {
  const ua = navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua)
  // Only real Safari can add to the Home Screen; in-app webviews can't.
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  return isIos && isSafari && !isStandalone()
}

const DISMISS_KEY = 'oneroof-install-dismissed'

export function isInstallPromptDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === '1'
}

export function dismissInstallPrompt() {
  localStorage.setItem(DISMISS_KEY, '1')
}
