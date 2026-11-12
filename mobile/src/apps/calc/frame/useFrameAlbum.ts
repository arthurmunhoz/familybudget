// The family album list, kept fresh: Realtime on frame_photos (another
// member's new photo shows up on every frame in the house), a refetch when
// the app comes back to the foreground, and — for the slideshow — the local
// cache sync, so each photo is downloaded once and then played from disk.
import { useCallback, useEffect, useRef, useState } from 'react'

import { readCache, useRevalidateOnForeground, writeCache } from '@/hooks/useCachedQuery'
import { channelName } from '@/lib/realtime'
import { supabase } from '@/lib/supabase'
import { fetchAlbum, fetchQuota, loadManifest, syncCache, type FramePhoto, type FrameQuota } from './frameStore'

const KEY = 'frame:album'

export function useFrameAlbum(householdId: string | undefined, opts: { cache?: boolean } = {}) {
  const wantCache = !!opts.cache
  const [rows, setRows] = useState<FramePhoto[]>(() => readCache<FramePhoto[]>(KEY) ?? [])
  const [quota, setQuota] = useState<FrameQuota | null>(null)
  const [loading, setLoading] = useState(!readCache(KEY))
  const [offline, setOffline] = useState(false)
  /** Bumps whenever a new file lands in the cache (slideshow re-reads). */
  const [cacheTick, setCacheTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!householdId) return
    try {
      const [list, q] = await Promise.all([fetchAlbum(), fetchQuota()])
      writeCache(KEY, list)
      setRows(list)
      setQuota(q)
      setOffline(false)
      if (wantCache) {
        void syncCache(householdId, list, () => setCacheTick((n) => n + 1)).then(() => setCacheTick((n) => n + 1))
      }
    } catch {
      // Offline (or the migration isn't there yet): keep whatever we had, and
      // the slideshow falls back to the last list this device saw.
      setOffline(true)
      if (wantCache) {
        const last = await loadManifest(householdId)
        setRows((cur) => (cur.length ? cur : last))
        setCacheTick((n) => n + 1)
      }
    } finally {
      setLoading(false)
    }
  }, [householdId, wantCache])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  useRevalidateOnForeground(() => void load())

  useEffect(() => {
    if (!householdId) return
    const ch = supabase
      .channel(channelName('frame_photos'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'frame_photos' }, () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(), 600)
      })
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(ch)
    }
  }, [householdId, load])

  return { rows, quota, loading, offline, cacheTick, reload: load, setRows }
}
