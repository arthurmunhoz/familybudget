// The notes wall (migration 113): every hand-drawn note this member can see
// stays in the app after it leaves the Home, and a heart keeps one for good.
// RLS decides what comes back (pings_select: to everyone, to me, or mine).
import { supabase } from './supabase'
import type { Ping } from './types'
import { reloadNoteWidget } from './widget'

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
  const [notesRes, favRes, hidden] = await Promise.all([
    supabase.from('pings').select('*').not('image_path', 'is', null).order('created_at', { ascending: false }).limit(200),
    supabase.from('note_favorites').select('ping_id'),
    fetchHiddenNotes(),
  ])
  return {
    notes: ((notesRes.data ?? []) as WallNote[]).filter((n) => !!n.image_path && !hidden.has(n.id)),
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

/** Notes this member took off their wall (migration 114). Empty set on a
 *  server without it — nothing is hidden then. */
export async function fetchHiddenNotes(): Promise<Set<string>> {
  const { data, error } = await supabase.from('note_hidden').select('ping_id')
  if (error) return new Set()
  return new Set(((data ?? []) as { ping_id: string }[]).map((r) => r.ping_id))
}

/** Takes a note off the wall. The SENDER deletes it for everyone (row, then
 *  the PNG); anyone else hides it for themselves only (and drops their heart). */
export async function removeNote(note: { id: string; image_path?: string | null; sender_email: string }, me: string | undefined): Promise<boolean> {
  if (me && note.sender_email === me) {
    const { error } = await supabase.from('pings').delete().eq('id', note.id)
    if (error) return false
    if (note.image_path) void supabase.storage.from('documents').remove([note.image_path])
  } else {
    const { error } = await supabase
      .from('note_hidden')
      .upsert({ ping_id: note.id }, { onConflict: 'ping_id,user_email', ignoreDuplicates: true })
    if (error) return false
    void supabase.from('note_favorites').delete().eq('ping_id', note.id)
  }
  reloadNoteWidget()
  changed()
  return true
}
