import { useCallback, useEffect, useMemo, useState } from 'react'
import { APPS, type HubApp } from '../lib/apps'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const EVT = 'oneroof-app-prefs-changed'

export type TileStyle = 'large' | 'compact'

interface AppPrefs {
  hidden: string[]
  tileStyle: TileStyle
  order: string[]
}

const DEFAULTS: AppPrefs = { hidden: [], tileStyle: 'compact', order: [] }

/** Apps in the user's saved order, with any not-yet-ordered apps (e.g. newly
 *  added ones) appended in the registry's natural order. */
export function orderApps(order: string[]): HubApp[] {
  const byId = new Map(APPS.map((a) => [a.id, a]))
  const known = order.map((id) => byId.get(id)).filter((a): a is HubApp => Boolean(a))
  const rest = APPS.filter((a) => !order.includes(a.id))
  return [...known, ...rest]
}

/** Per-user hub customization: which apps are hidden and how dense the tile
 *  grid is. Stored in user_settings (follows the user across devices) and
 *  cached in localStorage so the grid renders instantly. Hide-only model:
 *  new apps are visible until explicitly hidden. Every instance refreshes on
 *  change via a window event (same pattern as useHousehold). */
export function useAppPrefs() {
  const { profile } = useAuth()
  const email = profile?.email ?? null
  const cacheKey = email ? `app-prefs:${email}` : null

  const [prefs, setPrefs] = useState<AppPrefs>(() => {
    if (!cacheKey) return DEFAULTS
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(cacheKey) ?? '{}') }
    } catch {
      return DEFAULTS
    }
  })

  const apply = useCallback(
    (next: AppPrefs) => {
      setPrefs(next)
      if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(next))
    },
    [cacheKey],
  )

  const load = useCallback(async () => {
    if (!email) return
    const { data } = await supabase
      .from('user_settings')
      .select('hidden_apps, tile_style, app_order')
      .eq('email', email)
      .maybeSingle()
    apply({
      hidden: data?.hidden_apps ?? [],
      tileStyle: (data?.tile_style as TileStyle) ?? 'compact',
      order: data?.app_order ?? [],
    })
  }, [email, apply])

  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load])

  // Optimistic save of the full prefs row; rolls back if the write fails.
  const save = useCallback(
    async (next: AppPrefs) => {
      if (!email) return
      const prev = prefs
      apply(next)
      const { error } = await supabase.from('user_settings').upsert({
        email,
        hidden_apps: next.hidden,
        tile_style: next.tileStyle,
        app_order: next.order,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        apply(prev)
        return
      }
      window.dispatchEvent(new Event(EVT))
    },
    [email, prefs, apply],
  )

  const toggleApp = useCallback(
    (appId: string) =>
      save({
        ...prefs,
        hidden: prefs.hidden.includes(appId)
          ? prefs.hidden.filter((a) => a !== appId)
          : [...prefs.hidden, appId],
      }),
    [prefs, save],
  )

  const setTileStyle = useCallback(
    (tileStyle: TileStyle) => save({ ...prefs, tileStyle }),
    [prefs, save],
  )

  const reorderApps = useCallback(
    (order: string[]) => save({ ...prefs, order }),
    [prefs, save],
  )

  const orderedApps = useMemo(() => orderApps(prefs.order), [prefs.order])

  return {
    hidden: prefs.hidden,
    tileStyle: prefs.tileStyle,
    order: prefs.order,
    orderedApps,
    toggleApp,
    setTileStyle,
    reorderApps,
  }
}
