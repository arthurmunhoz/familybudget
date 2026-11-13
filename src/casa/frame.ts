// Modo Casa — the family photo album (table `frame_photos`, migration 100;
// bytes in the private `documents` bucket at <household>/frame/<uuid>.jpg),
// the same album the phone's Utilities › Photo frame fills. Read-only here:
// photos are added on the phone. Signed through lib/signedUrls (24 h URLs,
// reused → the browser cache serves every repeat). Mirrors the deck logic of
// mobile/src/apps/calc/frame/frameLogic.ts (shuffle; birthday photos lead).
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { getSignedUrls } from '../lib/signedUrls'
import { supabase } from '../lib/supabase'

export interface FramePhoto {
  id: string
  url: string
  addedBy: string | null
  memberEmail: string | null
  width: number | null
  height: number | null
}

async function loadAlbum(): Promise<FramePhoto[]> {
  const { data, error } = await supabase
    .from('frame_photos')
    .select('id, path, added_by, member_email, width, height, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data) return []
  const rows = data as { id: string; path: string; added_by: string | null; member_email: string | null; width: number | null; height: number | null }[]
  const urls: Record<string, string> = {}
  for (let i = 0; i < rows.length; i += 100) {
    Object.assign(urls, await getSignedUrls(rows.slice(i, i + 100).map((r) => r.path)).catch(() => ({})))
  }
  return rows
    .filter((r) => urls[r.path])
    .map((r) => ({ id: r.id, url: urls[r.path], addedBy: r.added_by, memberEmail: r.member_email, width: r.width, height: r.height }))
}

/** The album, kept live (Realtime + a slow poll). */
export function useFramePhotos(): { photos: FramePhoto[]; loaded: boolean } {
  const { profile } = useAuth()
  const hid = profile?.household_id ?? ''
  const q = useCachedQuery<FramePhoto[]>(`casa:frame:${hid}`, () => (hid ? loadAlbum() : Promise.resolve([])))
  const { revalidate } = q
  useEffect(() => {
    if (!hid) return
    const ch = supabase
      .channel(`casa-frame-${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'frame_photos' }, () => void revalidate())
      .subscribe()
    const poll = setInterval(() => void revalidate(), 15 * 60_000)
    return () => {
      clearInterval(poll)
      void supabase.removeChannel(ch)
    }
  }, [hid, revalidate])
  return { photos: q.data ?? [], loaded: !!q.data }
}

function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** One pass of the slideshow: shuffled; on someone's birthday the photos
 *  tagged with them lead and come back every other slide. */
export function buildDeck(photos: readonly FramePhoto[], birthdayEmails: readonly string[]): FramePhoto[] {
  const bday = new Set(birthdayEmails.map((e) => e.toLowerCase()))
  const isB = (p: FramePhoto) => !!p.memberEmail && bday.has(p.memberEmail.toLowerCase())
  const theirs = shuffle(photos.filter(isB))
  if (!theirs.length) return shuffle(photos)
  const others = shuffle(photos.filter((p) => !isB(p)))
  const out: FramePhoto[] = []
  for (let i = 0; i < Math.max(theirs.length, others.length); i++) {
    if (i < theirs.length) out.push(theirs[i])
    if (i < others.length) out.push(others[i])
  }
  return out
}

/** Deterministic slow Ken Burns move per photo (same shape as the phone's). */
export function kenBurns(id: string): { from: number; to: number; dx: number; dy: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const dir = Math.abs(h) % 4
  const zoomIn = (Math.abs(h) >> 2) % 3 !== 0
  const dx = dir % 2 === 0 ? 1 : -1
  const dy = dir < 2 ? 1 : -1
  // Never below 1.04 and a drift smaller than the overflow, so an edge never shows.
  return zoomIn ? { from: 1.04, to: 1.13, dx, dy } : { from: 1.13, to: 1.04, dx: -dx, dy: -dy }
}

/** cover unless the photo's shape fights the screen's (then contain over a
 *  blurred copy of itself). */
export function fitFor(w: number | null, h: number | null, sw: number, sh: number): 'cover' | 'contain' {
  if (!w || !h || !sw || !sh) return 'cover'
  const a = w / h
  const b = sw / sh
  return (a > b ? a / b : b / a) > 1.35 ? 'contain' : 'cover'
}

/** A rolling slideshow index over a deck rebuilt each pass; preloads the
 *  next photo so the crossfade never shows a half-loaded image. */
export function useSlideshow(photos: readonly FramePhoto[], birthdays: readonly string[], everyMs: number, running = true) {
  const key = photos.map((p) => p.id).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => buildDeck(photos, birthdays), [key, birthdays.join(',')])
  const [deck, setDeck] = useState(initial)
  const [i, setI] = useState(0)
  useEffect(() => {
    setDeck(initial)
    setI(0)
  }, [initial])
  useEffect(() => {
    if (!running || deck.length < 2) return
    const next = deck[(i + 1) % deck.length]
    const img = new Image()
    img.src = next.url
    const id = setTimeout(() => {
      if (i + 1 >= deck.length) {
        setDeck(buildDeck(photos, birthdays))
        setI(0)
      } else setI(i + 1)
    }, everyMs)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, deck, running, everyMs])
  return deck.length ? deck[i % deck.length] : null
}
