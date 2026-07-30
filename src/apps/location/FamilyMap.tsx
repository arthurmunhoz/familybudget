// The Mapbox GL map for Whereabouts. Lazy-imported by Whereabouts so neither
// mapbox-gl nor its CSS lands in the main bundle (it's ~250 kB gzipped).
//
// Only mounted when a token exists — Whereabouts renders a map-less roster
// otherwise, so this component can assume MAPBOX_TOKEN is set.
//
// Mapbox's logo AND the OpenStreetMap attribution must stay visible: Mapbox ToS
// plus OSM's ODbL license, where removing attribution is a license breach rather
// than merely a policy one. mapbox-gl draws both by default — don't disable them.
import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAPBOX_TOKEN, type LatLng } from '../../lib/location'
import type { Place } from '../../lib/types'

/** The two house styles. Kept in one place so the init and the theme-change
 *  effect can't drift apart (drift is what caused the blank-tiles bug). */
const styleFor = (dark: boolean) =>
  dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12'

export interface MapMember {
  email: string
  name: string
  color: string
  at: LatLng
  isMe: boolean
}

export default function FamilyMap({
  members,
  places,
  focus,
  dark,
  onSelect,
}: {
  members: MapMember[]
  places: Place[]
  /** Recentre here when it changes (a tapped roster card). */
  focus: LatLng | null
  dark: boolean
  onSelect: (email: string) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markers = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const placeMarkers = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Fit-to-everyone should happen once, not on every position update — otherwise
  // the camera yanks back the moment you pan.
  const fitted = useRef(false)
  /** Style currently applied, so a re-render can't re-issue the same setStyle. */
  const styleRef = useRef<string | null>(null)

  useEffect(() => {
    if (!holder.current || map.current) return
    // Copy the ref objects for the cleanup closure (the lint rule's point: the
    // ref's `.current` can be swapped before cleanup runs).
    const memberPins = markers.current
    const placePins = placeMarkers.current
    mapboxgl.accessToken = MAPBOX_TOKEN
    styleRef.current = styleFor(dark)
    map.current = new mapboxgl.Map({
      container: holder.current,
      style: styleRef.current,
      center: [-98, 39],
      zoom: 3,
    })
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    return () => {
      map.current?.remove()
      map.current = null
      memberPins.clear()
      placePins.clear()
    }
    // Style is applied on mount and via setStyle below; re-creating the map on a
    // theme flip would drop every marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-style ONLY on a real theme change, and only once the first style has
  // finished loading. Calling setStyle() while the initial style is still loading
  // runs _reloadImports on a half-initialised map and throws
  // "Cannot read properties of undefined (reading 'applyProjectionUpdate')",
  // which leaves the map mounted but with no tiles — a blank grey panel.
  useEffect(() => {
    const m = map.current
    const next = styleFor(dark)
    if (!m || styleRef.current === next) return
    styleRef.current = next
    if (m.isStyleLoaded()) m.setStyle(next)
    else m.once('style.load', () => m.setStyle(next))
  }, [dark])

  // Member pins — reuse a marker per email so panning doesn't rebuild the DOM.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const mem of members) {
      seen.add(mem.email)
      const existing = markers.current.get(mem.email)
      if (existing) {
        existing.setLngLat([mem.at.lng, mem.at.lat])
        continue
      }
      const el = document.createElement('button')
      el.type = 'button'
      el.setAttribute('aria-label', mem.name)
      el.style.cssText = `width:34px;height:34px;border-radius:50%;border:3px solid #fff;
        background:${mem.color};color:#fff;font:600 12px/1 system-ui;cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center`
      el.textContent = mem.name.slice(0, 2).toUpperCase()
      el.addEventListener('click', () => onSelect(mem.email))
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([mem.at.lng, mem.at.lat])
        .addTo(m)
      markers.current.set(mem.email, marker)
    }
    // Drop pins for members who stopped sharing.
    for (const [email, marker] of markers.current) {
      if (!seen.has(email)) {
        marker.remove()
        markers.current.delete(email)
      }
    }

    if (!fitted.current && members.length > 0) {
      fitted.current = true
      if (members.length === 1) {
        m.easeTo({ center: [members[0].at.lng, members[0].at.lat], zoom: 14 })
      } else {
        const b = new mapboxgl.LngLatBounds()
        for (const mem of members) b.extend([mem.at.lng, mem.at.lat])
        m.fitBounds(b, { padding: 70, maxZoom: 15 })
      }
    }
  }, [members, onSelect])

  // Place pins. Deliberately NO radius rings: on iOS a ring means "this boundary
  // is armed for me", and the web can't detect a crossing — drawing one here
  // would promise alerts that never fire.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const p of places) {
      seen.add(p.id)
      if (placeMarkers.current.has(p.id)) continue
      const el = document.createElement('div')
      el.style.cssText = `display:flex;align-items:center;gap:4px;padding:3px 7px;border-radius:999px;
        background:rgba(255,255,255,.92);color:#2b2521;font:600 11px/1.2 system-ui;
        box-shadow:0 1px 5px rgba(0,0,0,.25);white-space:nowrap`
      el.textContent = `${p.icon} ${p.name}`
      placeMarkers.current.set(
        p.id,
        new mapboxgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(m),
      )
    }
    for (const [id, marker] of placeMarkers.current) {
      if (!seen.has(id)) {
        marker.remove()
        placeMarkers.current.delete(id)
      }
    }
  }, [places])

  useEffect(() => {
    if (focus && map.current) {
      map.current.easeTo({ center: [focus.lng, focus.lat], zoom: 15 })
    }
  }, [focus])

  return <div ref={holder} className="h-full w-full" />
}
