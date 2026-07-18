// Per-user hub app preferences: which apps are hidden and their order.
// Backed by user_settings.hidden_apps (migration 014) + app_order (migration
// 029) — the SAME columns the PWA uses, so the choice follows the user across
// devices and platforms. AsyncStorage caches the last known prefs for an
// instant hub on cold start (mirrors useI18n's read-then-adopt pattern).
// Hide-only model: a newly shipped app appears for everyone by default.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { track } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

interface AppPrefsState {
  /** App ids the user turned off. */
  hiddenApps: string[]
  /** Preferred hub order (app ids). Apps missing from it keep registry order. */
  appOrder: string[]
  toggleApp: (id: string) => void
  setAppOrder: (ids: string[]) => void
}

const Ctx = createContext<AppPrefsState>({
  hiddenApps: [],
  appOrder: [],
  toggleApp: () => {},
  setAppOrder: () => {},
})

const CACHE = 'oneroof-app-prefs'

export function AppPrefsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const email = profile?.email ?? null
  const [hiddenApps, setHidden] = useState<string[]>([])
  const [appOrder, setOrder] = useState<string[]>([])

  // Cached copy first (instant), then the server's (authoritative).
  useEffect(() => {
    let active = true
    AsyncStorage.getItem(CACHE).then((v) => {
      if (!active || !v) return
      try {
        const p = JSON.parse(v) as { hidden?: string[]; order?: string[] }
        setHidden(p.hidden ?? [])
        setOrder(p.order ?? [])
      } catch {
        /* stale cache — ignore */
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!email) return
    let active = true
    supabase
      .from('user_settings')
      .select('hidden_apps, app_order')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return
        const hidden = (data.hidden_apps ?? []) as string[]
        const order = (data.app_order ?? []) as string[]
        setHidden(hidden)
        setOrder(order)
        AsyncStorage.setItem(CACHE, JSON.stringify({ hidden, order })).catch(() => {})
      })
    return () => {
      active = false
    }
  }, [email])

  const persist = useCallback(
    (hidden: string[], order: string[]) => {
      setHidden(hidden)
      setOrder(order)
      AsyncStorage.setItem(CACHE, JSON.stringify({ hidden, order })).catch(() => {})
      if (email) {
        void supabase
          .from('user_settings')
          .upsert({ email, hidden_apps: hidden, app_order: order, updated_at: new Date().toISOString() })
          .then(() => {})
      }
      track('apps.customized', { hidden: hidden.length, ordered: order.length > 0 })
    },
    [email],
  )

  const toggleApp = useCallback(
    (id: string) => {
      persist(
        hiddenApps.includes(id) ? hiddenApps.filter((h) => h !== id) : [...hiddenApps, id],
        appOrder,
      )
    },
    [hiddenApps, appOrder, persist],
  )

  const setAppOrder = useCallback((ids: string[]) => persist(hiddenApps, ids), [hiddenApps, persist])

  return (
    <Ctx.Provider value={{ hiddenApps, appOrder, toggleApp, setAppOrder }}>{children}</Ctx.Provider>
  )
}

export function useAppPrefs(): AppPrefsState {
  return useContext(Ctx)
}
