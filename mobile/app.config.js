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
        UIBackgroundModes: bgModes.includes('location') ? bgModes : [...bgModes, 'location'],
        // Lets Linking.canOpenURL reach the Google Maps / Waze apps for one-tap navigate.
        LSApplicationQueriesSchemes: Array.from(
          new Set([...(infoPlist.LSApplicationQueriesSchemes ?? []), 'comgooglemaps', 'waze']),
        ),
      },
    },
    android: {
      ...android,
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
