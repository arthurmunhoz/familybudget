import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const EVT = 'oneroof-app-prefs-changed'

/** Per-user hub customization: which apps are hidden from the homepage.
 *  Stored in user_settings (follows the user across devices) and cached in
 *  localStorage so the grid renders instantly. Hide-only model: new apps are
 *  visible until explicitly hidden. Every instance refreshes on toggle via a
 *  window event (same pattern as useHousehold). */
export function useAppPrefs() {
  const { profile } = useAuth()
  const email = profile?.email ?? null
  const cacheKey = email ? `hidden-apps:${email}` : null

  const [hidden, setHidden] = useState<string[]>(() => {
    if (!cacheKey) return []
    try {
      return JSON.parse(localStorage.getItem(cacheKey) ?? '[]')
    } catch {
      return []
    }
  })

  const apply = useCallback(
    (apps: string[]) => {
      setHidden(apps)
      if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(apps))
    },
    [cacheKey],
  )

  const load = useCallback(async () => {
    if (!email) return
    const { data } = await supabase
      .from('user_settings')
      .select('hidden_apps')
      .eq('email', email)
      .maybeSingle()
    apply(data?.hidden_apps ?? [])
  }, [email, apply])

  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load])

  const toggleApp = useCallback(
    async (appId: string) => {
      if (!email) return
      const next = hidden.includes(appId)
        ? hidden.filter((a) => a !== appId)
        : [...hidden, appId]
      apply(next) // optimistic — the grid updates immediately
      const { error } = await supabase.from('user_settings').upsert({
        email,
        hidden_apps: next,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        apply(hidden) // roll back; the toggle visibly snaps back
        return
      }
      window.dispatchEvent(new Event(EVT))
    },
    [email, hidden, apply],
  )

  return { hidden, toggleApp }
}
