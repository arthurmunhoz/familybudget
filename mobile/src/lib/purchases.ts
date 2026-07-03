// RevenueCat setup for One Roof Plus. The public SDK key is safe to embed (it's
// a publishable key). Entitlement is per HOUSEHOLD: we call Purchases.logIn with
// the household_id (see PlusProvider), so any member's purchase covers everyone
// and the server webhook keys off the same id.
//
// Env: EXPO_PUBLIC_REVENUECAT_IOS_KEY (add to eas.json env per profile). When
// unset, Purchases is never configured and the app simply behaves as free — no
// crashes, no paywall purchases.
import { Platform } from 'react-native'
import Purchases, { type CustomerInfo } from 'react-native-purchases'

export const PLUS_ENTITLEMENT = 'plus'
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''

let configured = false

/** Configure the SDK once. Safe to call repeatedly; no-ops off iOS or with no key. */
export function configurePurchases(): void {
  if (configured || Platform.OS !== 'ios' || !IOS_KEY) return
  Purchases.configure({ apiKey: IOS_KEY })
  configured = true
}

/** True once the SDK is configured (key present on a real iOS build). */
export function purchasesReady(): boolean {
  return configured
}

/** Does this customer's info carry an active Plus entitlement? */
export function hasPlus(info: CustomerInfo | null | undefined): boolean {
  return !!info?.entitlements.active[PLUS_ENTITLEMENT]
}
