// Dynamic Expo config layered on top of app.json. Everything static still lives
// in app.json; this file adds the NATIVE pieces the Whereabouts location feature
// needs — the Mapbox SDK plugin, expo-location with background enabled, iOS
// background mode + Always-permission strings, and Android location permissions.
//
// Secrets stay OUT of source:
//   • RNMAPBOX_DOWNLOAD_TOKEN — Mapbox *secret* download token, needed only at
//     build time to fetch the native SDK. Set it as a shell env / EAS secret.
//   • EXPO_PUBLIC_MAPBOX_TOKEN — Mapbox *public* token, read at runtime by the
//     map + Directions call (see src/lib/location.ts, src/apps/location).
// None of this takes effect until a native rebuild (`npx expo prebuild` or an
// EAS dev build). See mobile/WHEREABOUTS-SETUP.md.
//
// It also wires FCM for Android push, but only if google-services.json is
// actually present — see the comment on googleServicesFile below.
const fs = require('node:fs')
const path = require('node:path')

// Android push (Nudges, the daily digest, ack + live-wake silent pushes) is
// delivered by FCM, which needs this Firebase config file in the build. Setting
// the key unconditionally would make `expo prebuild`/EAS FAIL on a missing file,
// so it's attached only when the file exists: drop it in and Android push wires
// itself up; leave it out and iOS builds carry on unaffected. The file is
// gitignored (it's per-Firebase-project config, not a secret but not ours to
// commit), so CI/EAS needs it supplied — see PLAY-STORE-RELEASE.md §1.1.
// EAS never uploads a gitignored file, even one referenced here — it warns
// "not checked in to your repository and won't be uploaded to the builder" and
// then builds WITHOUT it, so push dies silently. The supported route is a FILE
// env var: `GOOGLE_SERVICES_JSON` is materialised on the builder and its value is
// the absolute path to it. Locally that var is unset and we fall back to the file
// on disk, so `expo prebuild` / `run:android` still work.
//   npx eas env:create --name GOOGLE_SERVICES_JSON --type file \
//     --value ./google-services.json --visibility secret --scope project \
//     --environment production --environment preview --environment development
const GOOGLE_SERVICES = path.join(__dirname, 'google-services.json')
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (fs.existsSync(GOOGLE_SERVICES) ? './google-services.json' : undefined)

// WHEREABOUTS ON ANDROID — the one switch. OFF for the first Play release
// (2026-10): Android v1 ships without the family map. With it off, the Android
// build declares NO location permission and NO location foreground service
// (they're stripped from every library's manifest, Mapbox's and
// expo-location's included), so Play asks for no location declarations, and
// the JS hides the feature (`src/lib/features.ts` reads `extra.whereaboutsAndroid`).
// To bring it back: set this to true and rebuild. `WHEREABOUTS_ANDROID=1|0`
// overrides it for a one-off build without a commit. iOS is never affected.
const WHEREABOUTS_ON_ANDROID =
  process.env.WHEREABOUTS_ANDROID != null ? process.env.WHEREABOUTS_ANDROID === '1' : false

const ANDROID_LOCATION_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
]

/** With Whereabouts off on Android, drop expo-location's foreground service
 *  from the merged manifest. A declared `foregroundServiceType="location"`
 *  service is itself something Play asks you to justify, even if never started. */
function withoutAndroidLocationService(config) {
  const { withAndroidManifest } = require('expo/config-plugins')
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' }
    const app = manifest.application?.[0]
    if (app) {
      const name = 'expo.modules.location.services.LocationTaskService'
      app.service = (app.service ?? []).filter((s) => s.$?.['android:name'] !== name)
      app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } })
    }
    return mod
  })
}

module.exports = ({ config }) => {
  const ios = config.ios ?? {}
  const android = config.android ?? {}
  const infoPlist = ios.infoPlist ?? {}
  const bgModes = infoPlist.UIBackgroundModes ?? []

  return {
    ...config,
    ios: {
      ...ios,
      infoPlist: {
        ...infoPlist,
        NSLocationWhenInUseUsageDescription:
          'One Roof shows where your household is and shares your location with them.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'One Roof keeps your location up to date for your household — even in the background — so they can see where you are and get there.',
        // The legacy iOS-10 key. expo-location's plugin fills it with the
        // placeholder "Allow $(PRODUCT_NAME) to access your location", which is
        // exactly the kind of generic string App Review flags — say the same
        // thing the modern key says.
        NSLocationAlwaysUsageDescription:
          'One Roof keeps your location up to date for your household — even in the background — so they can see where you are and get there.',
        UIBackgroundModes: bgModes.includes('location') ? bgModes : [...bgModes, 'location'],
        // Lets Linking.canOpenURL reach the Google Maps / Waze apps for one-tap navigate.
        LSApplicationQueriesSchemes: Array.from(
          new Set([...(infoPlist.LSApplicationQueriesSchemes ?? []), 'comgooglemaps', 'waze']),
        ),
      },
    },
    android: {
      ...android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      permissions: Array.from(
        new Set([
          ...(android.permissions ?? []),
          ...(WHEREABOUTS_ON_ANDROID
            ? [...ANDROID_LOCATION_PERMISSIONS, 'android.permission.FOREGROUND_SERVICE']
            : []),
        ]),
      ),
      // `blockedPermissions` becomes tools:node="remove", which also strips the
      // permissions that LIBRARY manifests (Mapbox, expo-location) declare.
      ...(WHEREABOUTS_ON_ANDROID
        ? {}
        : {
            blockedPermissions: Array.from(
              new Set([...(android.blockedPermissions ?? []), ...ANDROID_LOCATION_PERMISSIONS]),
            ),
          }),
    },
    extra: { ...(config.extra ?? {}), whereaboutsAndroid: WHEREABOUTS_ON_ANDROID },
    plugins: [
      ...(config.plugins ?? []),
      // Keychain storage for the Supabase auth session (see lib/secureSessionStore.ts).
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'One Roof shows where your household is and shares your location with them.',
          locationAlwaysAndWhenInUsePermission:
            'One Roof keeps your location up to date for your household — even in the background.',
          isAndroidBackgroundLocationEnabled: WHEREABOUTS_ON_ANDROID,
          isAndroidForegroundServiceEnabled: WHEREABOUTS_ON_ANDROID,
          isIosBackgroundLocationEnabled: true,
        },
      ],
      ...(WHEREABOUTS_ON_ANDROID ? [] : [withoutAndroidLocationService]),
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken: process.env.RNMAPBOX_DOWNLOAD_TOKEN ?? '',
        },
      ],
    ],
  }
}
