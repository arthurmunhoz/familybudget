import { supabase } from './supabase'

// Signed-URL cache for the private `documents` bucket.
//
// Every screen used to mint fresh signed URLs on mount, which (a) added a
// network round-trip before any <img> could start loading and (b) produced a
// different token each time, so the browser/CDN re-downloaded every image on
// every visit. Stored objects are content-addressed (a uuid per upload — a
// path's bytes never change), so a signed URL is safe to reuse until it nears
// expiry. Caching + reusing the same URL skips the round-trip and lets the
// browser cache actually hit.
//
// In-memory only (cleared on full reload) — no tokens persisted to disk.

const BUCKET = 'documents'
const TTL_SECONDS = 24 * 60 * 60 // mint 24h URLs
const REFRESH_BEFORE_MS = 60 * 60 * 1000 // refresh when under 1h remains

const cache = new Map<string, { url: string; expires: number }>()

function fresh(path: string): string | undefined {
  const hit = cache.get(path)
  if (hit && hit.expires - Date.now() > REFRESH_BEFORE_MS) return hit.url
  return undefined
}

function store(path: string, url: string) {
  cache.set(path, { url, expires: Date.now() + TTL_SECONDS * 1000 })
}

/** Signed URL for one storage path, reused from cache when still valid. */
export async function getSignedUrl(path: string): Promise<string | null> {
  const hit = fresh(path)
  if (hit) return hit
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS)
  if (!data?.signedUrl) return null
  store(path, data.signedUrl)
  return data.signedUrl
}

/** Signed URLs for many paths; only the uncached/expiring ones hit the network. */
export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const need: string[] = []
  for (const p of paths) {
    const hit = fresh(p)
    if (hit) out[p] = hit
    else need.push(p)
  }
  if (need.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(need, TTL_SECONDS)
    for (const s of data ?? []) {
      if (s.signedUrl && s.path) {
        store(s.path, s.signedUrl)
        out[s.path] = s.signedUrl
      }
    }
  }
  return out
}
