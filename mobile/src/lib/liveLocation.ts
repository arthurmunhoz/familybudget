// Live location mode (migration 066). When you open a member's detail, we ask
// THEIR device to ramp up to high-frequency GPS so their pin moves smoothly;
// it relaxes back to the battery-saver cadence when no one is watching.
//
// Watcher side  → useWatchLive: upserts a live request for the target and
//                 heartbeats it while the sheet is open; cancels on close.
// Target side   → useLiveResponder (mounted globally in _layout): listens for
//                 requests aimed at ME and, WHILE I'M SHARING, runs a
//                 high-accuracy watchPositionAsync burst that self-terminates
//                 when the live window lapses.
//
// Reality check: this only fires while the target's app is running (foreground,
// or backgrounded with location permission + an active Realtime socket). A
// force-quit / OS-suspended app won't ramp up until it's active again — a silent
// push to wake it is the follow-up (see WHEREABOUTS-SETUP.md). Being watched
// never turns sharing ON; it only tightens cadence for someone already sharing.
import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

import { supabase } from './supabase'
import { fetchMyLocation, isSharingEnabled, upsertMyPosition } from './location'
import { useAuth } from './auth'

const LIVE_WINDOW_S = 45 // one heartbeat keeps the target live this long
const HEARTBEAT_MS = 20_000 // watcher re-requests this often while watching

async function myEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

/** Watcher: ask `target`'s device to go live (upsert; heartbeat re-calls this). */
export async function requestLive(target: string): Promise<void> {
  const me = await myEmail()
  if (!me || target === me) return
  await supabase.from('location_live_requests').upsert(
    {
      requester_email: me,
      target_email: target,
      expires_at: new Date(Date.now() + LIVE_WINDOW_S * 1000).toISOString(),
    },
    { onConflict: 'requester_email,target_email' },
  )
}

/** Watcher: cancel the live request for `target` (on closing the detail). */
export async function stopLive(target: string): Promise<void> {
  const me = await myEmail()
  if (!me) return
  await supabase
    .from('location_live_requests')
    .delete()
    .eq('requester_email', me)
    .eq('target_email', target)
}

/** Watcher hook: keep `target` live while mounted. Pass `null` to do nothing
 *  (e.g. viewing yourself or a member who isn't sharing). */
export function useWatchLive(target: string | null): void {
  useEffect(() => {
    if (!target) return
    let cancelled = false
    void requestLive(target)
    const id = setInterval(() => {
      if (!cancelled) void requestLive(target)
    }, HEARTBEAT_MS)
    return () => {
      cancelled = true
      clearInterval(id)
      void stopLive(target)
    }
  }, [target])
}

/** Target hook (mount ONCE, globally): while someone is watching me and I'm
 *  sharing, run a high-accuracy position burst so my pin moves in near real time. */
export function useLiveResponder(): void {
  const { profile } = useAuth()
  const myEmailAddr = profile?.email ?? null
  const subRef = useRef<Location.LocationSubscription | null>(null)
  const stopAtRef = useRef<number>(0)
  const [live, setLive] = useState(false)

  // Am I currently being watched? (any unexpired request aimed at me)
  useEffect(() => {
    if (!myEmailAddr) return
    let cancelled = false
    let expiryTimer: ReturnType<typeof setTimeout> | null = null

    const recompute = async () => {
      const { data } = await supabase
        .from('location_live_requests')
        .select('expires_at')
        .eq('target_email', myEmailAddr)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
      if (cancelled) return
      const rows = (data ?? []) as { expires_at: string }[]
      const latest = rows[0]?.expires_at
      stopAtRef.current = latest ? new Date(latest).getTime() : 0
      setLive(rows.length > 0)
      if (expiryTimer) clearTimeout(expiryTimer)
      if (latest) {
        expiryTimer = setTimeout(recompute, Math.max(1000, stopAtRef.current - Date.now()) + 500)
      }
    }

    void recompute()
    const channel = supabase
      .channel('live_requests_me')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'location_live_requests',
          filter: `target_email=eq.${myEmailAddr}`,
        },
        () => void recompute(),
      )
      .subscribe()

    return () => {
      cancelled = true
      if (expiryTimer) clearTimeout(expiryTimer)
      void supabase.removeChannel(channel)
    }
  }, [myEmailAddr])

  // Ramp the high-accuracy watcher up/down with `live`.
  useEffect(() => {
    let cancelled = false
    const stop = () => {
      subRef.current?.remove()
      subRef.current = null
    }
    const start = async () => {
      // Only if I'm actually sharing — being watched must never force location on.
      const mine = await fetchMyLocation()
      if (cancelled || subRef.current || !isSharingEnabled(mine)) return
      subRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 8 },
        (pos) => {
          // Self-terminate once the live window lapses — covers the case where the
          // expiry timer was suspended while the app was backgrounded.
          if (Date.now() > stopAtRef.current) {
            stop()
            return
          }
          void upsertMyPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            speed: pos.coords.speed ?? null,
          })
        },
      )
    }
    if (live) void start()
    else stop()
    return () => {
      cancelled = true
      stop()
    }
  }, [live])
}
