import { useEffect, useState } from 'react'
import { useHousehold } from '../hooks/useHousehold'
import { supabase } from '../lib/supabase'
import BeachBackdrop from './BeachBackdrop'

// Signed URLs live ~1h; cache them per path so navigating between pages
// doesn't re-request one on every mount.
const urlCache = new Map<string, { url: string; expires: number }>()

/**
 * The household's backdrop: nothing by default, the original beach scene for
 * the household that has 'builtin:beach', or an uploaded image rendered the
 * same way the beach scene is (bottom-anchored, low opacity, behind content).
 */
export default function Backdrop() {
  const { household } = useHousehold()
  const path = household?.backdrop_path ?? null

  const [url, setUrl] = useState<string | null>(() => {
    if (!path) return null
    const cached = urlCache.get(path)
    return cached && cached.expires > Date.now() ? cached.url : null
  })

  useEffect(() => {
    if (!path || path === 'builtin:beach') return
    const cached = urlCache.get(path)
    if (cached && cached.expires > Date.now()) {
      setUrl(cached.url)
      return
    }
    let cancelled = false
    supabase.storage
      .from('documents')
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (cancelled || !data) return
        urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 3_300_000 })
        setUrl(data.signedUrl)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return null
  if (path === 'builtin:beach') return <BeachBackdrop />
  if (!url) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 mx-auto max-w-md select-none"
      style={{ opacity: 0.25 }}
    >
      <img src={url} alt="" className="w-full" />
    </div>
  )
}
