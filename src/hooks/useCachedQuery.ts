import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Stale-while-revalidate data fetching with an in-memory cache.
 *
 * On mount it returns the last cached value for `key` immediately (no empty
 * flash when a screen re-mounts), then re-fetches in the background and only
 * updates state if the result actually changed — so unchanged data causes no
 * re-render and no "blink". The cache is module-level: it survives component
 * unmount/remount within a session and clears on a full page reload.
 *
 * `loading` is true only on the very first fetch for a key (when there's no
 * cache yet). `revalidate()` forces a refresh (e.g. from a Realtime handler or
 * after a mutation).
 */
const cache = new Map<string, unknown>()

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function useCachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): { data: T | undefined; loading: boolean; revalidate: () => Promise<void> } {
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined)
  const [loading, setLoading] = useState(!cache.has(key))

  // Keep the latest fetcher without making it an effect dependency (callers
  // pass inline closures; we don't want to refetch on every render).
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const revalidate = useCallback(async () => {
    const result = await fetcherRef.current()
    const prev = cache.get(key)
    cache.set(key, result)
    if (!sameValue(prev, result)) setData(result)
    setLoading(false)
  }, [key])

  useEffect(() => {
    let cancelled = false
    if (cache.has(key)) {
      setData(cache.get(key) as T)
      setLoading(false)
    } else {
      setLoading(true)
    }
    fetcherRef.current()
      .then((result) => {
        if (cancelled) return
        const prev = cache.get(key)
        cache.set(key, result)
        if (!sameValue(prev, result)) setData(result)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return { data, loading, revalidate }
}
