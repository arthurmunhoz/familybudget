// One Roof service worker — push + offline app shell.
//
// Caching is deliberately conservative so it can't serve a stale/broken app:
//   • Navigations (the HTML) are NETWORK-FIRST — a new deploy is always picked
//     up online; the cached shell is only a fallback when offline.
//   • Hashed build assets (/assets/*.js|css) are CACHE-FIRST — their filenames
//     are content-fingerprinted, so a given URL's bytes never change.
//   • Cross-origin requests (Supabase data/auth) are never touched.
//   • On localhost the fetch handler is a no-op, so dev/HMR is unaffected.
// Bump CACHE to invalidate everything on a breaking change.

const CACHE = 'one-roof-shell-v2'
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  // Activate immediately so a freshly-registered worker can receive pushes
  // without waiting for all tabs to close.
  self.skipWaiting()
  // Best-effort precache of the shell so the very first offline open works.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(SHELL))
      .catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Only the app's own origin; never Supabase or other cross-origin calls.
  if (url.origin !== self.location.origin) return
  // Leave the dev server alone (HMR, un-hashed modules).
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return

  // Navigations → network-first, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE)
          cache.put(SHELL, fresh.clone())
          return fresh
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match(SHELL)) || (await cache.match('/')) || Response.error()
        }
      })(),
    )
    return
  }

  // Everything else same-origin (hashed assets, icons, manifest) → cache-first.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      if (cached) return cached
      try {
        const fresh = await fetch(req)
        if (fresh.ok && fresh.type === 'basic') cache.put(req, fresh.clone())
        return fresh
      } catch {
        return cached || Response.error()
      }
    })(),
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'One Roof'
  const options = {
    body: payload.body || '',
    icon: '/roof-icon-180.png',
    badge: '/roof-icon-180.png',
    tag: payload.tag || 'one-roof-digest',
    data: { url: payload.url || '/', tel: payload.tel || null },
  }
  // A "Call" action when the sender has a phone on file. NOTE: action buttons
  // are ignored by iOS web-push today; the in-app Call button is the fallback.
  if (payload.tel) {
    options.actions = [{ action: 'call', title: '📞 Call' }]
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  // Tapping the "Call" action dials the sender directly.
  if (event.action === 'call' && data.tel) {
    event.waitUntil(self.clients.openWindow(`tel:${data.tel}`))
    return
  }
  const url = data.url || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        // Reuse an open tab if there is one; otherwise open a new window.
        for (const client of list) {
          if ('focus' in client) {
            if ('navigate' in client) client.navigate(url)
            return client.focus()
          }
        }
        return self.clients.openWindow(url)
      }),
  )
})
