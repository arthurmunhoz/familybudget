// Web Push opt-in helpers. The actual sending happens server-side in
// api/send-digest.ts; this module handles the browser side: registering the
// service worker, asking permission, subscribing, and storing the subscription
// in Supabase so the cron can reach this device.
//
// iOS NOTE: web push only works when the app is installed to the Home Screen
// (iOS 16.4+). In a normal Safari tab `Notification`/`PushManager` exist but
// permission can't be granted — `isStandalone()` lets the UI explain that.
import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied'

/** Running as an installed PWA (standalone), where iOS allows push. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(VAPID_PUBLIC_KEY)
  )
}

/** Current opt-in state, for rendering the toggle. */
export function pushState(): PushState {
  if (!isSupported()) return 'unsupported'
  // On iOS, push requires the installed PWA; flag that before permission.
  if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return 'needs-install'
  }
  return Notification.permission as PushState
}

/** True if THIS browser already has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!isSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return Boolean(sub)
}

// Returns a Uint8Array backed by a concrete ArrayBuffer so it satisfies
// BufferSource (applicationServerKey) under the strict lib types — same gotcha
// the WebAuthn helpers hit.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Register the push-only service worker (idempotent). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

/** Prompt for permission, subscribe, and persist the subscription. Returns the
 *  resulting state so the caller can show the right message. */
export async function enablePush(): Promise<PushState> {
  if (!isSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission as PushState

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  await navigator.serviceWorker.ready

  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    }))

  const json = sub.toJSON()
  const keys = json.keys ?? {}
  // household_id + user_email are stamped server-side by column defaults.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )
  if (error) {
    // Roll back the browser subscription so state stays consistent.
    await sub.unsubscribe().catch(() => {})
    throw error
  }
  return 'granted'
}

/** Unsubscribe this device and drop its row. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
}
