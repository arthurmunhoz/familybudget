import { useEffect, useState } from 'react'
import { useHousehold } from '../hooks/useHousehold'
import { useTheme } from '../hooks/useTheme'
import { supabase } from '../lib/supabase'
import BeachBackdrop from './BeachBackdrop'

/** Bundled One Roof default art, per theme. Not stored in the database, so it
 *  can never be deleted — households without a custom image always get it. */
export const DEFAULT_BACKDROP = {
  light: '/default-backdrop-light.png',
  dark: '/default-backdrop-dark.png',
}

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
  const { theme } = useTheme()
  const path = household?.backdrop_path ?? null

  // The beach scene's polaroid photo also lives in private storage, under a
  // well-known name in the household's backdrop folder.
  const storagePath = !household
    ? null
    : path === 'builtin:beach'
      ? `${household.id}/backdrop/beach-photo.jpg`
      : path

  const [url, setUrl] = useState<string | null>(() => {
    if (!storagePath) return null
    const cached = urlCache.get(storagePath)
    return cached && cached.expires > Date.now() ? cached.url : null
  })

  useEffect(() => {
    if (!storagePath) return
    const cached = urlCache.get(storagePath)
    if (cached && cached.expires > Date.now()) {
      setUrl(cached.url)
      return
    }
    let cancelled = false
    supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (cancelled || !data) return
        urlCache.set(storagePath, {
          url: data.signedUrl,
          expires: Date.now() + 3_300_000,
        })
        setUrl(data.signedUrl)
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  if (path === 'builtin:beach') return <BeachBackdrop photoUrl={url} />

  // No custom image → the bundled, theme-matched One Roof default.
  const src = !path ? DEFAULT_BACKDROP[theme] : url
  if (!src) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 mx-auto max-w-md select-none"
      style={{ opacity: 0.25 }}
    >
      <img src={src} alt="" className="w-full" />
    </div>
  )
}
