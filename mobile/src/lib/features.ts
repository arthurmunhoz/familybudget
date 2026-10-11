// Per-platform feature switches, read from the native config that was built.
//
// WHEREABOUTS on Android is OFF for the first Play release (2026-10): the
// feature is fully built and tested (see __tests__/whereabouts/), but Arthur is
// shipping Android v1 without it. The switch lives in ONE place —
// `WHEREABOUTS_ON_ANDROID` in mobile/app.config.js — because it has to flip the
// NATIVE side too (location permissions + the location foreground service in
// the Android manifest, which is what Google Play reviews) and the JS side
// together. app.config.js publishes it as `extra.whereaboutsAndroid`; this file
// only reads it, so the two can never disagree inside one build.
//
// To bring it back: set WHEREABOUTS_ON_ANDROID = true in app.config.js and
// rebuild (there is no OTA path — this is native config). iOS is unaffected.
import Constants from 'expo-constants'
import { Platform } from 'react-native'

/** Whereabouts (family map, sharing, places, safety radius, live mode). */
export const WHEREABOUTS_ENABLED: boolean =
  Platform.OS !== 'android' || Constants.expoConfig?.extra?.whereaboutsAndroid === true
