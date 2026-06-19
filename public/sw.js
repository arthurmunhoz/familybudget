// One Roof service worker — PUSH ONLY.
//
// Intentionally has NO `fetch` handler: it never caches or intercepts requests,
// so it cannot break the app or serve stale assets. Its only jobs are to show
// notifications pushed by api/send-digest and to focus/open the app on tap.

self.addEventListener('install', () => {
  // Activate immediately so a freshly-registered worker can receive pushes
  // without waiting for all tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
    data: { url: payload.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
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
