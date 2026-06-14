import { useEffect } from 'react'

/**
 * Locks page scroll while `active` (a modal/sheet/drawer is open), so the
 * content behind the overlay can't be dragged. Restores the previous overflow
 * on close or unmount.
 *
 * This is deliberately TRANSIENT — applied only while an overlay is open, never
 * as the base layout. The project's iOS standalone "dead band" bug came from a
 * permanently locked body with an inner scroll container; toggling overflow for
 * the duration of a modal doesn't recreate that, since it's restored on close.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    const { body } = document
    const prevRoot = root.style.overflow
    const prevBody = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = prevRoot
      body.style.overflow = prevBody
    }
  }, [active])
}
