// Which screens are in front right now, for the foreground push handler
// (lib/backgroundNotifications): a push about something you're already
// looking at is dropped instead of shown. Owner, 2026-11: a "X opened a room"
// banner popped up while the Games screen was listing that very room.
import { useCallback } from 'react'
import { useFocusEffect } from 'expo-router'

const active = new Set<string>()

export function setOnScreen(key: string, on: boolean) {
  if (on) active.add(key)
  else active.delete(key)
}

export function isOnScreen(key: string) {
  return active.has(key)
}

/** Marks `key` as on screen while the calling screen is focused. */
export function useOnScreen(key: string) {
  useFocusEffect(
    useCallback(() => {
      setOnScreen(key, true)
      return () => setOnScreen(key, false)
    }, [key]),
  )
}
