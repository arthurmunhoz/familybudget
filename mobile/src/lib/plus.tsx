// One Roof Plus entitlement context. Configures RevenueCat, identifies the
// household (so Plus is shared across members), and exposes the current plan +
// purchase/restore. Gating screens use usePlus().isPlus; the paywall uses the
// offering + purchase(). Everything degrades gracefully to "free" when the SDK
// isn't configured (no key / not a native iOS build), so the app never blocks.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases'

import { useAuth } from './auth'
import { supabase } from './supabase'
import { configurePurchases, hasPlus, purchasesReady, PLUS_ENTITLEMENT } from './purchases'

interface PlusState {
  /** Active Plus entitlement for this household. */
  isPlus: boolean
  /** The current RevenueCat offering (plans to show on the paywall), or null. */
  offering: PurchasesOffering | null
  /** RevenueCat is configured (key present, real iOS build) — the paywall can sell. */
  available: boolean
  loading: boolean
  /** Buy a package. Returns true if Plus is now active, false if the user cancelled. */
  purchase: (pkg: PurchasesPackage) => Promise<boolean>
  /** Restore prior purchases (Apple-required). Returns true if Plus is now active. */
  restore: () => Promise<boolean>
  refresh: () => Promise<void>
}

const Ctx = createContext<PlusState | null>(null)

/** Shape of the current_household_plan() RPC (migration 060). */
type PlanSignal = { plus?: boolean; admin_free?: boolean }

export function PlusProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [info, setInfo] = useState<CustomerInfo | null>(null)
  const [offering, setOffering] = useState<PurchasesOffering | null>(null)
  const [loading, setLoading] = useState(true)
  // Server-side entitlement (household_subscriptions, via RPC). Covers comps/
  // promos and cross-member purchases that RevenueCat mirrors to the DB.
  const [serverPlus, setServerPlus] = useState(false)
  // An admin explicitly forced this household to Free for testing (admin_set_plan
  // wrote plan='free', product='admin_test'). When set, we suppress the live
  // RevenueCat OR below so the "preview the Free experience" toggle can actually
  // turn Plus off even while the admin holds a real (sandbox) entitlement.
  const [adminFree, setAdminFree] = useState(false)

  // Configure once, up front.
  useEffect(() => {
    configurePurchases()
  }, [])

  // Identify the household so the entitlement is shared across its members.
  const householdId = profile?.household_id ?? null
  useEffect(() => {
    let active = true
    // Server-side plan (works even when RevenueCat isn't configured, e.g. dev).
    if (householdId) {
      supabase.rpc('current_household_plan').then(({ data }) => {
        if (!active || !data) return
        const p = data as PlanSignal
        setServerPlus(p.plus === true)
        setAdminFree(p.admin_free === true)
      })
    } else {
      setServerPlus(false)
      setAdminFree(false)
    }

    if (!purchasesReady()) {
      setLoading(false)
      return () => {
        active = false
      }
    }
    ;(async () => {
      try {
        if (householdId) {
          const { customerInfo } = await Purchases.logIn(householdId)
          if (active) setInfo(customerInfo)
        } else {
          // Signed out — drop back to an anonymous RevenueCat user. Only if
          // we aren't already anonymous (e.g. before `profile` loads on first
          // mount) — RevenueCat logs a console.error for a no-op logOut().
          if (!(await Purchases.isAnonymous())) {
            await Purchases.logOut().catch(() => {})
          }
          const ci = await Purchases.getCustomerInfo()
          if (active) setInfo(ci)
        }
        const offerings = await Purchases.getOfferings()
        if (active) setOffering(offerings.current ?? null)
      } catch {
        /* offline / not configured — treat as free */
      } finally {
        if (active) setLoading(false)
      }
    })()

    const listener = (ci: CustomerInfo) => setInfo(ci)
    Purchases.addCustomerInfoUpdateListener(listener)
    return () => {
      active = false
      Purchases.removeCustomerInfoUpdateListener(listener)
    }
  }, [householdId])

  const refresh = useCallback(async () => {
    if (householdId) {
      const { data } = await supabase.rpc('current_household_plan')
      const p = (data ?? {}) as PlanSignal
      setServerPlus(p.plus === true)
      setAdminFree(p.admin_free === true)
    }
    if (!purchasesReady()) return
    try {
      setInfo(await Purchases.getCustomerInfo())
    } catch {
      /* ignore */
    }
  }, [householdId])

  // Re-check entitlement whenever the app returns to the foreground. Without this
  // an app left open across the subscription's expiry keeps showing Plus until it
  // re-mounts — `serverPlus` is otherwise only fetched on mount/household change.
  // This is what actually revokes Plus features promptly after a lapse/cancel,
  // since the server RPC (`current_household_is_plus`) guards on `expires_at`.
  const appState = useRef(AppState.currentState)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/)
      appState.current = next
      if (wasBackground && next === 'active') void refresh()
    })
    return () => sub.remove()
  }, [refresh])

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg)
      setInfo(customerInfo)
      return hasPlus(customerInfo)
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'userCancelled' in e && (e as { userCancelled?: boolean }).userCancelled) {
        return false
      }
      throw e
    }
  }, [])

  const restore = useCallback(async () => {
    const customerInfo = await Purchases.restorePurchases()
    setInfo(customerInfo)
    return hasPlus(customerInfo)
  }, [])

  const value: PlusState = {
    // Server plan wins; the live RevenueCat entitlement is ORed in for post-
    // purchase immediacy — but NOT when an admin has forced Free for testing.
    isPlus: serverPlus || (hasPlus(info) && !adminFree),
    offering,
    available: purchasesReady(),
    loading,
    purchase,
    restore,
    refresh,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlus(): PlusState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePlus must be used within PlusProvider')
  return ctx
}

export { PLUS_ENTITLEMENT }
