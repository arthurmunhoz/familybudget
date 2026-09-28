/**
 * SPEC §B — the background tasks must exist in a HEADLESS JS context.
 *
 * Model of what Android does when a location / geofence / data-only push event
 * arrives and the app's Activity isn't alive (swiped away, OS-killed, service
 * restarted): it boots a fresh JS runtime and evaluates the bundle's entry
 * module (package.json "main") — and renders NOTHING. So `_layout.tsx`, its
 * effects and every screen stay unevaluated.
 *
 * expo-router's entry only registers the root component, it doesn't render —
 * which is why it's mocked to a no-op here: that's exactly its headless effect.
 *
 * If a task isn't defined in that context, expo-task-manager UNREGISTERS it
 * (node_modules/expo-task-manager/src/TaskManager.ts) and sharing silently
 * stops until the app is next opened.
 */
import path from 'path'
import { resetWorld, world } from './helpers/world'

const ROOT = path.resolve(__dirname, '../..')

function bootHeadless(): Set<string> {
  resetWorld()
  jest.resetModules()
  jest.doMock('expo-router/entry', () => ({}))
  const main: string = require(path.join(ROOT, 'package.json')).main
  jest.isolateModules(() => {
    const local = path.join(ROOT, main)
    require(require('fs').existsSync(local) ? local : main)
  })
  return new Set(world().tasks.keys())
}

/** The task name the app registers for background notifications, however it names it. */
function notificationTaskName(): string | null {
  resetWorld()
  jest.resetModules()
  jest.isolateModules(() => {
    require('@/lib/backgroundNotifications').registerBackgroundNotifications()
  })
  return world().notificationTaskRegistered
}

describe('B — background tasks are defined without rendering React', () => {
  it('B1 the location-updates task', () => {
    const { LOCATION_TASK } = jest.requireActual('@/lib/locationTask')
    expect([...bootHeadless()]).toContain(LOCATION_TASK)
  })

  it('B2 the geofence task', () => {
    const { GEOFENCE_TASK } = jest.requireActual('@/lib/placesTask')
    expect([...bootHeadless()]).toContain(GEOFENCE_TASK)
  })

  it('B3 the background-notification (live-wake) task', async () => {
    const name = notificationTaskName()
    // registerTaskAsync is async in the app; give it a tick.
    await new Promise((r) => setTimeout(r, 0))
    const registered = name ?? world().notificationTaskRegistered
    expect(registered).toBeTruthy()
    expect([...bootHeadless()]).toContain(registered)
  })
})
