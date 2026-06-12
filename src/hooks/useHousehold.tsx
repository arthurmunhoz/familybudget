import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Household } from '../lib/types'
import { useAuth } from './useAuth'

const EVT = 'oneroof-household-changed'

/** Call after updating the household row so every useHousehold() instance
 *  (hub header, backdrop, drawer) refreshes immediately. */
export function notifyHouseholdChanged() {
  window.dispatchEvent(new Event(EVT))
}

/** The signed-in user's household row, cached in localStorage so the hub
 *  header and backdrop render instantly on later opens. */
export function useHousehold() {
  const { profile } = useAuth()
  const hid = profile?.household_id ?? null

  const [household, setHousehold] = useState<Household | null>(() => {
    if (!hid) return null
    try {
      return JSON.parse(localStorage.getItem(`household:${hid}`) ?? 'null')
    } catch {
      return null
    }
  })

  const load = useCallback(async () => {
    if (!hid) return
    const { data } = await supabase
      .from('households')
      .select('*')
      .eq('id', hid)
      .single()
    if (data) {
      localStorage.setItem(`household:${hid}`, JSON.stringify(data))
      setHousehold(data)
    }
  }, [hid])

  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load])

  return { household, reload: load }
}
