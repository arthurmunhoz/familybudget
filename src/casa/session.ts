// Modo Casa — the device's standing: its plan (home_plan rpc) and whether it
// is still paired (home_devices row, revoked from the phone).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEVICE_KEY, lsGet, lsSet } from './util'

export interface Plan {
  plus: boolean
  /** Days left of the free trial (null = no trial running / Plus). */
  trialDays: number | null
  /** Plus or still in the trial: everything works. False = display-only. */
  full: boolean
}

// Set to true to preview the display-only (trial over) state while developing.
const FORCE_FREE = false

export function usePlan(): Plan {
  const [plan, setPlan] = useState<Plan>({ plus: false, trialDays: null, full: true })
  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.rpc('home_plan')
      if (!alive) return
      // Not deployed yet / any error: treat as full (never lock the family out
      // because of our own outage).
      if (error || !data) {
        setPlan({ plus: false, trialDays: null, full: !FORCE_FREE })
        return
      }
      const p = data as { plus?: boolean; trial_ends?: string | null; full?: boolean }
      const ends = p.trial_ends ? new Date(p.trial_ends).getTime() : null
      const days = ends ? Math.ceil((ends - Date.now()) / 86_400_000) : null
      setPlan({
        plus: !!p.plus,
        trialDays: !p.plus && days !== null && days > 0 ? days : null,
        full: FORCE_FREE ? false : p.full !== false,
      })
    }
    void load()
    const id = setInterval(load, 30 * 60_000)
    const vis = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  return plan
}

const SEEN_KEY = 'casa.seen'

/** Watches this device's `home_devices` row: if it's gone or revoked (a member
 *  unpaired it from the phone), sign out and forget it → back to pairing.
 *  Also bumps last_seen_at at most every 10 minutes. Errors (table not
 *  deployed, offline) are ignored. */
export function useDeviceWatch(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const check = async () => {
      const id = lsGet(DEVICE_KEY)
      if (!id) return // a dev login / not a paired device
      const { data, error } = await supabase.from('home_devices').select('id, revoked_at').eq('id', id).maybeSingle()
      if (!alive || error) return
      const row = data as { id: string; revoked_at: string | null } | null
      if (!row || row.revoked_at) {
        lsSet(DEVICE_KEY, null)
        lsSet(SEEN_KEY, null)
        await supabase.auth.signOut({ scope: 'local' })
        return
      }
      const last = Number(lsGet(SEEN_KEY) ?? 0)
      if (Date.now() - last > 10 * 60_000) {
        lsSet(SEEN_KEY, String(Date.now()))
        await supabase.from('home_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', id)
      }
    }
    void check()
    const timer = setInterval(check, 5 * 60_000)
    const vis = () => document.visibilityState === 'visible' && void check()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('focus', vis)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('focus', vis)
    }
  }, [signedIn])
}
