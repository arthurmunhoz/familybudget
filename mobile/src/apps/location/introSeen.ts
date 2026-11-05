// Whether this DEVICE has seen the Whereabouts intro (WhereaboutsIntro). Per
// device, like the map mode: it's about learning this screen on this phone.
// Bump the key's version to show a reworked intro once more to everyone.
import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'oneroof-whereabouts-intro-v1'

/** `open` turns true once, on the first visit (after storage answered), and
 *  `show()` reopens it from the help button. `close()` remembers it was seen. */
export function useWhereaboutsIntro(): { open: boolean; show: () => void; close: () => void } {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(KEY)
      .then((v) => {
        // Let the map settle first — a sheet that slides in with the screen's
        // own transition reads as part of the push, not as a welcome.
        if (alive && !v) setTimeout(() => alive && setOpen(true), 600)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const show = useCallback(() => setOpen(true), [])
  const close = useCallback(() => {
    setOpen(false)
    void AsyncStorage.setItem(KEY, '1').catch(() => {})
  }, [])
  return { open, show, close }
}
