// A MarkerView that GLIDES to a new coordinate instead of teleporting. Live
// mode delivers a fix every few seconds; snapping between them makes a moving
// member stutter across the map. Lerp over GLIDE_MS — but SNAP for the first
// fix and for big jumps (a batched background fix after a gap): animating a
// 3 km hop would show someone sliding through buildings.
//
// Used for MEMBER pins only; places are static and keep plain MarkerView.
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { MarkerView } from '@rnmapbox/maps'

import { haversineMeters } from '@/lib/location'

const GLIDE_MS = 800
const SNAP_METERS = 2000

export function GlidingMarker({
  coordinate,
  anchor,
  children,
}: {
  coordinate: [number, number] // [lng, lat] — Mapbox order
  anchor?: { x: number; y: number }
  children: ReactElement
}) {
  const [pos, setPos] = useState<[number, number]>(coordinate)
  const posRef = useRef<[number, number]>(coordinate)
  const rafRef = useRef<number | null>(null)
  const [lng, lat] = coordinate

  useEffect(() => {
    const from = posRef.current
    const to: [number, number] = [lng, lat]
    if (from[0] === to[0] && from[1] === to[1]) return
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    const jump = haversineMeters({ lat: from[1], lng: from[0] }, { lat: to[1], lng: to[0] })
    if (jump > SNAP_METERS) {
      posRef.current = to
      setPos(to)
      return
    }
    const start = Date.now()
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / GLIDE_MS)
      const e = 1 - Math.pow(1 - k, 3) // ease-out cubic
      // A newer fix mid-glide starts its own lerp from wherever this one got to
      // (posRef), so back-to-back live fixes chain smoothly.
      const next: [number, number] = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]
      posRef.current = next
      setPos(next)
      rafRef.current = k < 1 ? requestAnimationFrame(step) : null
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [lng, lat])

  return (
    <MarkerView coordinate={pos} anchor={anchor}>
      {children}
    </MarkerView>
  )
}
