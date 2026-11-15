// Hand-drawn note (migration 112) — full-screen sheet of paper. Opened from
// the Nudges composer; `to` carries the recipients already picked there
// (comma-separated emails; empty = everyone).
import { useLocalSearchParams } from 'expo-router'

import DrawNote from '@/apps/pings/DrawNote'

export default function DrawNoteScreen() {
  const { to } = useLocalSearchParams<{ to?: string }>()
  const initialTo = typeof to === 'string' && to ? to.split(',').filter(Boolean) : []
  return <DrawNote initialTo={initialTo} />
}
