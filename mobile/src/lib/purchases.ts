// RevenueCat setup for One Roof Plus. The public SDK key is safe to embed (it's
// a publishable key). Entitlement is per HOUSEHOLD: we call Purchases.logIn with
// the household_id (see PlusProvider), so any member's purchase covers everyone
// and the server webhook keys off the same id.
//
// Env: EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (EAS
// secrets — see PLAY-STORE-RELEASE.md). Each store has its OWN publishable key;
// passing the iOS key on Android does not work. When the platform's key is unset,
// Purchases is never configured and the app simply behaves as free — no crashes,
// no paywall purchases. That's the deliberate degradation that lets a build ship
// (or a dev build run) before billing is wired.
import { Platform } from 'react-native'
import Purchases, { type CustomerInfo } from 'react-native-purchases'

export const PLUS_ENTITLEMENT = 'plus'

/** The publishable SDK key for the store this build talks to, '' if unset. */
function storeKey(): string {
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? ''
  return '' // web/other: no store to bill through
}

let configured = false

/** Configure the SDK once. Safe to call repeatedly; no-ops with no key for this
 *  platform, or on a platform with no store.
 *
 *  NOTE for Android testing: Google Play Billing only talks to an app that Play
 *  itself recognises — matching package name AND signature. A sideloaded APK
 *  configures fine but `getOfferings()` returns nothing, so the paywall shows as
 *  unavailable rather than broken (`available` in plus.tsx). Real purchase testing
 *  needs the build on an internal-testing track and a license-tested account. */
export function configurePurchases(): void {
  if (configured) return
  const apiKey = storeKey()
  if (!apiKey) return
  Purchases.configure({ apiKey })
  configured = true
}

/** True once the SDK is configured (this platform's key present on a real build). */
export function purchasesReady(): boolean {
  return configured
}

/** Does this customer's info carry an active Plus entitlement? */
export function hasPlus(info: CustomerInfo | null | undefined): boolean {
  return !!info?.entitlements.active[PLUS_ENTITLEMENT]
}
