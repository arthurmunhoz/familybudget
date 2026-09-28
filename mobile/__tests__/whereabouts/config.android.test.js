/**
 * SPEC §A — the Android native config a background location feature needs.
 * Evaluates app.config.js the way `expo prebuild` / EAS do: with app.json as
 * the incoming config.
 * @jest-environment node
 */
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

function resolvedConfig(env = {}) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  try {
    jest.resetModules()
    const appJson = require(path.join(ROOT, 'app.json'))
    const mod = require(path.join(ROOT, 'app.config.js'))
    const fn = typeof mod === 'function' ? mod : mod.default
    const out = typeof fn === 'function' ? fn({ config: JSON.parse(JSON.stringify(appJson.expo)) }) : mod
    return out.expo ?? out
  } finally {
    process.env = saved
  }
}

function plugin(config, name) {
  for (const p of config.plugins ?? []) {
    if (p === name) return [name, {}]
    if (Array.isArray(p) && p[0] === name) return p
  }
  return null
}

const cfg = resolvedConfig({ GOOGLE_SERVICES_JSON: path.join(ROOT, 'app.json') })
const android = cfg.android ?? {}
const fs = require('fs')
const declared = (android.permissions ?? []).map((p) => p.replace(/^android\.permission\./, ''))
// What prebuild's manifest merge adds on top: the libraries' own manifests.
function libraryPermissions(pkg) {
  const file = path.join(ROOT, 'node_modules', pkg, 'android/src/main/AndroidManifest.xml')
  if (!fs.existsSync(file)) return []
  return [...fs.readFileSync(file, 'utf8').matchAll(/android\.permission\.([A-Z_]+)/g)].map((m) => m[1])
}
const perms = [...declared, ...libraryPermissions('expo-notifications'), ...libraryPermissions('expo-location')]

describe('A — Android native config', () => {
  it.each([
    'ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION',
    'ACCESS_BACKGROUND_LOCATION',
    'FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_LOCATION',
    'POST_NOTIFICATIONS',
  ])('A1 declares %s', (p) => {
    expect(perms).toContain(p)
  })

  it('A2 blocks none of the location / service / notification permissions', () => {
    const blocked = (android.blockedPermissions ?? []).map((p) => p.replace(/^android\.permission\./, ''))
    const needed = [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
    ]
    expect(blocked.filter((p) => needed.includes(p))).toEqual([])
  })

  it('A3 expo-location runs background updates through a foreground service', () => {
    const p = plugin(cfg, 'expo-location')
    expect(p).not.toBeNull()
    const opts = p[1] ?? {}
    expect(opts.isAndroidBackgroundLocationEnabled).toBe(true)
    // The plugin defaults the foreground-service flag to the background one.
    expect(opts.isAndroidForegroundServiceEnabled ?? opts.isAndroidBackgroundLocationEnabled).toBe(true)
  })

  it('A5 the location service is a location-type foreground service (Android 14)', () => {
    const xml = fs.readFileSync(
      path.join(ROOT, 'node_modules/expo-location/android/src/main/AndroidManifest.xml'),
      'utf8',
    )
    expect(xml).toMatch(/LocationTaskService[\s\S]*foregroundServiceType="location"/)
  })

  it('A4 expo-notifications is configured (silent live-wake + alerts)', () => {
    expect(plugin(cfg, 'expo-notifications')).not.toBeNull()
  })

  it('A4 FCM is wired when the google-services file is provided (EAS file env)', () => {
    expect(android.googleServicesFile).toBeTruthy()
  })
})
