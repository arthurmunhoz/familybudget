// Modo Casa — the data behind "Recados" (see NotesWall.tsx): notes sent to the
// WHOLE household, newest first, live.
import { useEffect } from 'react'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { supabase } from '../lib/supabase'

export interface CasaNote {
  id: string
  sender_email: string
  image_path: string
  created_at: string
}

async function loadNotes(): Promise<CasaNote[]> {
  const { data } = await supabase
    .from('pings')
    .select('id, sender_email, image_path, created_at, recipients')
    .not('image_path', 'is', null)
    .is('recipients', null)
    .order('created_at', { ascending: false })
    .limit(8)
  return ((data ?? []) as (CasaNote & { recipients: string[] | null })[]).filter((n) => !!n.image_path)
}

export function useCasaNotes(hid: string) {
  const q = useCachedQuery<CasaNote[]>(`casa:notes:${hid}`, () => (hid ? loadNotes() : Promise.resolve([])))
  const { revalidate } = q
  useEffect(() => {
    if (!hid) return
    const ch = supabase
      .channel(`casa-notes-${hid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () => void revalidate())
      .subscribe()
    const poll = setInterval(() => void revalidate(), 300_000)
    return () => {
      clearInterval(poll)
      void supabase.removeChannel(ch)
    }
  }, [hid, revalidate])
  return q.data ?? []
}
