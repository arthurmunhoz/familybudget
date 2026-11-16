// The notes wall (migration 113): every hand-drawn note this member can see
// stays in the app after it leaves the Home, and a heart keeps one for good.
// RLS decides what comes back (pings_select: to everyone, to me, or mine).
import { supabase } from './supabase'
import type { Ping } from './types'

export type WallNote = Ping & { image_path: string }
export type Wall = {
  notes: WallNote[]
  favs: string[]
  /** false against a server without migration 113: no hearts, the wall still works. */
  canFavorite: boolean
}

const listeners = new Set<() => void>()
/** Told whenever a heart changes, so an open wall and viewer agree. */
export function onNotesChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const changed = () => listeners.forEach((cb) => cb())

export async function fetchWall(): Promise<Wall> {
  const [notesRes, favRes] = await Promise.all([
    supabase.from('pings').select('*').not('image_path', 'is', null).order('created_at', { ascending: false }).limit(200),
    supabase.from('note_favorites').select('ping_id'),
  ])
  return {
    notes: ((notesRes.data ?? []) as WallNote[]).filter((n) => !!n.image_path),
    favs: ((favRes.data ?? []) as { ping_id: string }[]).map((f) => f.ping_id),
    canFavorite: !favRes.error,
  }
}

/** null = hearts aren't available here (no migration 113). */
export async function isFavorite(pingId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('note_favorites').select('ping_id').eq('ping_id', pingId).maybeSingle()
  if (error) return null
  return !!data
}

export async function setFavorite(pingId: string, on: boolean): Promise<boolean> {
  const { error } = on
    ? await supabase.from('note_favorites').upsert({ ping_id: pingId }, { onConflict: 'ping_id,user_email', ignoreDuplicates: true })
    : await supabase.from('note_favorites').delete().eq('ping_id', pingId)
  if (!error) changed()
  return !error
}
