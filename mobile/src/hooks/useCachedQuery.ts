import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

/**
 * Stale-while-revalidate data fetching with an in-memory cache. Ported from the
 * PWA (src/hooks/useCachedQuery.ts), plus the native-only foreground refresh
 * below — pure React otherwise, no web deps.
 *
 * On mount it returns the last cached value for `key` immediately (no empty
 * loader flash when a screen re-mounts), then re-fetches in the background and
 * only updates state if the result actually changed — so unchanged data causes
 * no re-render and no "blink". The cache is module-level: it survives component
 * unmount/remount within a session and clears on a full app reload.
 *
 * `loading` is true only on the very first fetch for a key (when there's no
 * cache yet). `revalidate()` forces a refresh (e.g. from a Realtime handler or
 * after a mutation).
 *
 * IT ALSO REFETCHES WHEN THE APP RETURNS FROM THE BACKGROUND. On the web a
 * screen is re-created often enough that mount-only fetching is close to
 * honest; on iOS it is not. The OS SUSPENDS the app rather than killing it, so
 * reopening it days later re-renders the exact component tree that was on
 * screen when it was put away: nothing re-mounts, no navigation focus event
 * fires, and any Realtime socket that died while suspended never replays what
 * it missed. Without this, whichever screen you left open keeps showing the
 * snapshot it fetched last session (reported: used the app on the 10th, opened
 * it on the 12th, still saw the 10th's data). Screens that keep their own state
 * instead of a cached query use `useRevalidateOnForeground` for the same reason.
 */
const cache = new Map<string, unknown>()

/** Every mounted `useCachedQuery` for a key, so a value fetched or written by
 *  ONE of them reaches all of them. Without this each instance kept its own
 *  copy in state and only the module cache was shared: the Hub's Safety Radius
 *  banner and the Whereabouts screen both read `location:watch`, Whereabouts
 *  refetched after the watch was stopped, and the Hub — mounted underneath the
 *  whole time — kept rendering the stopped watch until its own next poll
 *  (2026-11-22). Same trap for any two screens sharing a key. */
const keySubs = new Map<string, Set<(value: unknown) => void>>()

/** Store `value` for `key` and hand it to every mounted query on that key. */
function publish(key: string, value: unknown): void {
  cache.set(key, value)
  const subs = keySubs.get(key)
  if (subs) for (const fn of [...subs]) fn(value)
}

/** Callbacks to run when the app comes back from the background. One shared
 *  AppState listener rather than one per query — a busy screen has several. */
const foregroundSubs = new Set<() => void>()
let wasBackgrounded = false

AppState.addEventListener('change', (state) => {
  // Only a REAL background→active round trip counts. Control Centre, the
  // notification shade, the Face ID overlay and permission dialogs all fire
  // `inactive` and return straight to `active` without ever backgrounding;
  // treating those as a return would refetch every mounted screen several
  // times a minute for nothing.
  if (state === 'background') {
    wasBackgrounded = true
    return
  }
  if (state !== 'active' || !wasBackgrounded) return
  wasBackgrounded = false
  for (const fn of [...foregroundSubs]) fn()
})

/**
 * Run `fn` each time the app returns from the background. For screens that hold
 * their own optimistic/Realtime state and so have their own `load()` rather than
 * a `useCachedQuery` (ShoppingList, Nudges) — `useCachedQuery` calls this
 * internally, so anything built on it already refreshes and must NOT add a
 * second listener of its own.
 */
export function useRevalidateOnForeground(fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const run = () => ref.current()
    foregroundSubs.add(run)
    return () => {
      foregroundSubs.delete(run)
    }
  }, [])
}

/** Read/write the same in-memory cache directly. For screens that keep their
 *  own optimistic/Realtime state but still want instant render on return
 *  (seed from readCache, write-through on every update). */
export function readCache<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined
}
export function writeCache<T>(key: string, value: T): void {
  publish(key, value)
}
/** Wipe the whole cache. Called on sign-out: unlike the PWA (which reloads the
 *  page on logout), the native app keeps its JS context alive, so without this a
 *  second account signing in on the same session would see the first's cached
 *  data before revalidation. */
export function clearCache(): void {
  cache.clear()
}
/** Refetch EVERYTHING that is mounted: every `useCachedQuery` and every
 *  `useRevalidateOnForeground` screen (they share the foreground set). Used when
 *  the active household changes (migration 099) — RLS now answers for another
 *  household, so every screen in the stack, not just the visible one, must
 *  reload. Pair it with `clearCache()` so a remount can't show the old one. */
export function revalidateAll(): void {
  for (const fn of [...foregroundSubs]) fn()
}
/** Drop every cached key starting with `prefix`. For a mutation on one screen
 *  that invalidates another's data (deleting a household from its detail screen
 *  invalidates the admin list). The other screen still refetches on focus — this
 *  just stops it rendering the deleted row for the length of that round trip. */
export function invalidateCache(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

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

  // Follow the key: whichever instance fetches (or a writeCache) updates this
  // one too. The functional update keeps an unchanged value from re-rendering.
  useEffect(() => {
    const fn = (value: unknown) => setData((prev) => (sameValue(prev, value) ? prev : (value as T)))
    let subs = keySubs.get(key)
    if (!subs) keySubs.set(key, (subs = new Set()))
    subs.add(fn)
    return () => {
      subs.delete(fn)
      if (!subs.size) keySubs.delete(key)
    }
  }, [key])

  const revalidate = useCallback(async () => {
    const result = await fetcherRef.current()
    publish(key, result)
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
        publish(key, result)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  // Reopening the app is the other moment this data can be arbitrarily old —
  // see the header. Swallow failures: coming back with no signal must leave the
  // last-known value on screen, exactly like the mount fetch does.
  useRevalidateOnForeground(() => {
    void revalidate().catch(() => {})
  })

  return { data, loading, revalidate }
}
