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
const GOOGLE_SERVICES = path.join(__dirname, 'google-services.json')
const googleServicesFile = fs.existsSync(GOOGLE_SERVICES) ? './google-services.json' : undefined

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
          'android.permission.ACCESS_COARSE_LOCATION',
          'android.permission.ACCESS_FINE_LOCATION',
          'android.permission.ACCESS_BACKGROUND_LOCATION',
          'android.permission.FOREGROUND_SERVICE',
          'android.permission.FOREGROUND_SERVICE_LOCATION',
        ]),
      ),
    },
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
          isAndroidBackgroundLocationEnabled: true,
          isIosBackgroundLocationEnabled: true,
        },
      ],
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsDownloadToken: process.env.RNMAPBOX_DOWNLOAD_TOKEN ?? '',
        },
      ],
    ],
  }
}
