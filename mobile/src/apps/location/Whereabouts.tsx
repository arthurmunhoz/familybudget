// Whereabouts — the live family map. Owns the member-location data + a single
// Realtime subscription, renders a Mapbox map with a pin per sharing member and
// a bottom sheet of member cards scrolled HORIZONTALLY (so the sheet's height is
// constant regardless of household size).
//
// Tapping a card or a pin EXPANDS that member's card in place (ETA-first detail,
// no sheet over the map) and frames them on the map, so what you're reading
// about stays visible behind the roster. Tapping again collapses it. Your own
// card expands the same way and holds the way into your sharing controls —
// that's why there's no sharing button in the header.
// Native-only: the map (@rnmapbox/maps) and background location need a dev build
// + EXPO_PUBLIC_MAPBOX_TOKEN — see mobile/WHEREABOUTS-SETUP.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Localization from 'expo-localization'
import * as Location from 'expo-location'
import { router } from 'expo-router'
import Mapbox, { Camera, FillLayer, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { MapPin, Crosshair, Landmark, ShieldAlert, ShieldCheck, Sparkles, X } from 'lucide-react-native'

import { AppHeader, Txt } from '@/components/ui'
import { Toast, type ToastData } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import {
  captureAndUpload,
  fetchMemberLocations,
  fetchMyLocation,
  formatDistance,
  haversineMeters,
  isPaused,
  isSharingEnabled,
  isSharingLive,
  setUseImperial,
} from '@/lib/location'
import { fetchPlaces, placeAt } from '@/lib/places'
import { syncGeofences } from '@/lib/placesTask'
import { usePlus } from '@/lib/plus'
import { requestLive } from '@/lib/liveLocation'
import { alertBreach, circlePolygon, fetchMyWatch, isOutside } from '@/lib/safetyRadius'
import type { MemberLocation, Place, Profile, SafetyWatch } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import {
  BatteryChip,
  buildMemberColors,
  CARD_H,
  CARD_W,
  FLOAT_SHADOW,
  MemberAvatar,
  Pulse,
  ROSTER_BOTTOM_GAP,
  ROSTER_CHROME,
  ROSTER_SHADOW_PAD,
  timeAgo,
  WatchingChip,
} from './locationUi'
import { MemberDetailCard } from './MemberDetailCard'
import { NavPicker } from './NavPicker'
import { NudgePicker } from './NudgePicker'
import { PlacesSheet } from './PlacesSheet'
import { SafetyRadiusSheet } from './SafetyRadiusSheet'
import { SharingControls } from './SharingControls'

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? ''
// Optional custom Mapbox Studio styles (e.g. a Warm Hearth theme). If only the
// light URL is set it's used for BOTH themes; set the _DARK one too for a proper
// Dusk map. Falls back to Mapbox's standard light/dark styles when unset.
const MAPBOX_STYLE_URL = process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? ''
const MAPBOX_STYLE_URL_DARK = process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL_DARK ?? ''
// One-time SDK auth. Safe no-op when the token is unset (the map just won't load
// and we show a setup hint instead).
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN).catch(() => {})
}

const DRIVING_SPEED_MS = 3.5 // ~12.6 km/h — above walking pace → "Driving"
const INITIAL_ZOOM = 13 // frame the user + their neighborhood on first open (not too tight)
const FOCUS_ZOOM = 15 // closer, for when you've picked one person to look at

/** How much map the floating roster covers, bottom-up. Drives where a focused
 *  member gets centred and where the breach banner sits. (The Mapbox/OSM credits
 *  used to be derived from this too, back when they sat above the roster; they
 *  live in the top-left now, so the roster can no longer cover them at all.) */
const ROSTER_HEIGHT = CARD_H + ROSTER_CHROME
/** Frame a place with room around its circle rather than flush to the edges. */
const PLACE_FRAME_MARGIN = 1.7

/** Member profiles' photo + phone, keyed by email (for pins + the Call button). */
async function fetchMemberMeta(): Promise<{
  avatars: Record<string, string | null>
  phones: Record<string, string>
}> {
  const { data } = await supabase.from('member_profiles').select('email, avatar_path, phone')
  const avatars: Record<string, string | null> = {}
  const phones: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; avatar_path: string | null; phone: string | null }[]) {
    avatars[r.email] = r.avatar_path
    if (r.phone) phones[r.email] = r.phone
  }
  return { avatars, phones }
}

/** Square header action. Every one of these looks IDENTICAL — same fill, same
 *  glyph weight — because a button that only some features can "light up" makes
 *  the others read as disabled (Places has no active state at all, and next to a
 *  filled Safety Radius it looked switched off). Activity is shown by pulsing
 *  the GLYPH instead, which reads as "running now" without restyling the button.
 *  Glyphs use c.text, not c.textMuted: over the translucent glass surface in
 *  Dusk, muted was too faint to look enabled. */
function HeaderButton({
  icon,
  label,
  active,
  badge,
  onPress,
}: {
  /** Rendered with the resolved foreground colour. */
  icon: (color: string) => React.ReactNode
  label: string
  /** The thing this opens is running right now → pulse the glyph. */
  active?: boolean
  /** Plus sparkle for a gated feature. */
  badge?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  const glyph = icon(active ? c.accent : c.text)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surface,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      {active ? <Pulse>{glyph}</Pulse> : glyph}
      {badge ? (
        <View style={{ position: 'absolute', top: -4, right: -4 }}>
          <Sparkles size={12} color={c.accent} />
        </View>
      ) : null}
    </Pressable>
  )
}

/** One member as a fixed-size card in the horizontal roster. Fixed height keeps
 *  the sheet exactly as tall for a household of 2 as for one of 10 — and as tall
 *  expanded as collapsed (see CARD_H). */
function MemberCard({
  name,
  avatarPath,
  color,
  status,
  hint,
  battery,
  watched,
  onPress,
}: {
  name: string
  avatarPath?: string | null
  color: string
  status: string
  /** Secondary line — used on your OWN card ("Manage location sharing"). */
  hint?: string
  battery: number | null
  /** In my active Safety Radius watch list. */
  watched: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // No selected-state border: on first load nothing should look "picked".
      style={({ pressed }) => [
        {
          width: CARD_W,
          height: CARD_H,
          // c.sheet, NOT c.surface — these float straight on the map now, and
          // surface is translucent under the glass skin (10% white in Dusk),
          // which would leave the card all but invisible over the tiles.
          backgroundColor: c.sheet,
          borderRadius: radius.lg,
          paddingVertical: sp.md,
          paddingHorizontal: sp.sm,
          alignItems: 'center',
          gap: 5,
          ...FLOAT_SHADOW,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <MemberAvatar name={name} avatarPath={avatarPath} color={color} size={44} />
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text }} numberOfLines={1}>
        {name}
      </Txt>
      <Txt variant="muted" style={{ fontSize: 11, textAlign: 'center' }} numberOfLines={2}>
        {status}
      </Txt>
      {hint ? (
        <Txt
          style={{ fontSize: 10, color: c.accent, fontFamily: fonts.semibold, textAlign: 'center' }}
          numberOfLines={2}
        >
          {hint}
        </Txt>
      ) : null}
      {/* Watching sits ABOVE the battery so the live state reads first. */}
      <View style={{ marginTop: 'auto', alignItems: 'center', gap: 4 }}>
        {watched ? <WatchingChip /> : null}
        {battery != null ? <BatteryChip level={battery} /> : null}
      </View>
    </Pressable>
  )
}

export default function Whereabouts() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const { isPlus } = usePlus()
  const myEmail = profile?.email ?? null

  const cameraRef = useRef<Camera>(null)
  const rosterRef = useRef<ScrollView>(null)
  /** A selection is waiting to be scrolled into view (see onExpandedLayout).
   *  A ref, not state, so it can't cause a render or fight a manual scroll. */
  const focusPending = useRef(false)
  const centeredOnce = useRef(false)
  const [meta, setMeta] = useState<{ avatars: Record<string, string | null>; phones: Record<string, string> }>({
    avatars: {},
    phones: {},
  })
  /** Email of the member whose roster card is expanded (null = all collapsed). */
  const [selected, setSelected] = useState<string | null>(null)
  /** Member we're picking a nudge for. */
  const [nudgeFor, setNudgeFor] = useState<Profile | null>(null)
  /** Member we're picking a map app for, with the destination captured at tap
   *  time so a live position update can't move it mid-choice. */
  const [navFor, setNavFor] = useState<{ profile: Profile; to: { lat: number; lng: number } } | null>(
    null,
  )
  /** Safety-radius breaches showing above the roster until dismissed. */
  const [breaches, setBreaches] = useState<{ email: string; title: string; dist: string }[]>([])
  const [sharingOpen, setSharingOpen] = useState(false)
  const [placesOpen, setPlacesOpen] = useState(false)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)

  // Where to frame the map on first load. Prefer MY position — even when I'm not
  // sharing — so it opens on me rather than on whoever happens to be live. Only
  // read the device position if permission is ALREADY granted (opening the map
  // must never trigger a prompt), and it's used for framing only, never uploaded.
  const [deviceCenter, setDeviceCenter] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync()
        if (!perm.granted) return
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        if (active) setDeviceCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      } catch {
        /* no fix — fall back to a live member, else the wide view */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const { data: locs = [], revalidate } = useCachedQuery<MemberLocation[]>(
    'location:members',
    fetchMemberLocations,
  )
  const { data: places = [], revalidate: reloadPlaces } = useCachedQuery<Place[]>(
    'location:places',
    fetchPlaces,
  )

  const { data: watch = null, revalidate: reloadWatch } = useCachedQuery<SafetyWatch | null>(
    'location:watch',
    fetchMyWatch,
  )

  // Keep the OS geofence registration in step with the saved places (and with
  // whether I'm sharing at all — syncGeofences tears them down if I'm not).
  useEffect(() => {
    void syncGeofences()
  }, [places])

  // While a safety watch runs, keep the watched members in live mode so their
  // positions are fresh enough for a boundary alert to mean something.
  useEffect(() => {
    if (!watch?.watched.length) return
    const ping = () => {
      for (const email of watch.watched) void requestLive(email)
    }
    ping()
    const id = setInterval(ping, 20_000)
    return () => clearInterval(id)
  }, [watch])

  // Miles vs km follows the device's measurement system.
  useEffect(() => {
    const system = Localization.getLocales()[0]?.measurementSystem
    setUseImperial(system === 'us' || system === 'uk')
  }, [])

  // On open: only refresh my own dot if I've actually opted into sharing —
  // opening the map must never silently start sharing (off by default). A brand
  // new user has no row → nothing captured, no permission prompt. Others still show.
  useEffect(() => {
    void (async () => {
      const mine = await fetchMyLocation()
      if (isSharingEnabled(mine)) {
        await captureAndUpload().catch(() => {})
        await revalidate()
      }
    })()
    void fetchMemberMeta().then(setMeta)
  }, [revalidate])

  // Live updates: one channel, debounced revalidate (mirrors the Nudges screen).
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const channel = supabase
      .channel('member_locations_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_locations' }, () => {
        if (loadTimer.current) clearTimeout(loadTimer.current)
        loadTimer.current = setTimeout(() => void revalidate(), 250)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [revalidate])

  const locByEmail = useMemo(() => {
    const m = new Map<string, MemberLocation>()
    for (const l of locs) m.set(l.user_email, l)
    return m
  }, [locs])

  const colors = useMemo(() => buildMemberColors(profiles.map((p) => p.email)), [profiles])
  const nameFor = useCallback(
    (email: string) =>
      email === myEmail
        ? t('location.you')
        : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0]),
    [myEmail, profiles, t],
  )

  // Safety Radius breach detection — lives here because this screen already has
  // the live member_locations feed. Alerts once per crossing: a member must come
  // back inside before they can trigger another alert (no re-alert spam).
  const breachedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!watch) {
      breachedRef.current = new Set()
      return
    }
    const centre = { lat: watch.center_lat, lng: watch.center_lng }
    for (const email of watch.watched) {
      const loc = locByEmail.get(email)
      if (!isSharingLive(loc)) continue
      const out = isOutside(watch, { lat: loc.lat, lng: loc.lng })
      const was = breachedRef.current.has(email)
      if (out && !was) {
        breachedRef.current.add(email)
        const title = t('location.safety.breach', { name: nameFor(email) })
        const dist = formatDistance(haversineMeters(centre, { lat: loc.lat, lng: loc.lng }))
        void alertBreach(title, t('location.safety.breachBody', { dist }))
        // A breach STAYS on screen until dismissed — a toast that faded after
        // three seconds was the one alert in this app you couldn't afford to
        // miss. Keyed by member so a second crossing can't stack duplicates.
        setBreaches((prev) =>
          prev.some((b) => b.email === email) ? prev : [...prev, { email, title, dist }],
        )
      } else if (!out && was) {
        breachedRef.current.delete(email)
      }
    }
  }, [watch, locByEmail, nameFor, t])

  const myLoc = myEmail ? locByEmail.get(myEmail) : undefined
  const myLive = isSharingLive(myLoc) ? myLoc : null

  // Members with a plottable fix (for the map + recenter bounds).
  const livePins = useMemo(
    () =>
      profiles
        .map((p) => ({ p, loc: locByEmail.get(p.email) }))
        .filter((x): x is { p: Profile; loc: MemberLocation & { lat: number; lng: number } } =>
          isSharingLive(x.loc),
        ),
    [profiles, locByEmail],
  )

  // Center once on the first data we get (me if available, else anyone live).
  const initialCenter = useMemo<[number, number]>(() => {
    if (myLive) return [myLive.lng, myLive.lat]
    if (deviceCenter) return [deviceCenter.lng, deviceCenter.lat]
    if (livePins[0]) return [livePins[0].loc.lng, livePins[0].loc.lat]
    return [-98.5, 39.5] // continental US fallback until a fix arrives
  }, [myLive, deviceCenter, livePins])

  // On first load, frame the user (or, if I'm not sharing, whoever is live) at a
  // comfortable neighborhood zoom — not zoomed in too tight. Runs once, so it
  // never fights the user's own panning afterward.
  useEffect(() => {
    if (centeredOnce.current) return
    const focus = myLive ?? deviceCenter ?? livePins[0]?.loc
    if (!focus) return
    centeredOnce.current = true
    cameraRef.current?.setCamera({
      centerCoordinate: [focus.lng, focus.lat],
      zoomLevel: INITIAL_ZOOM,
      animationDuration: 0,
    })
  }, [myLive, deviceCenter, livePins])

  /** Frame a saved place, fitting its RADIUS rather than picking a zoom: a 100 m
   *  Home and a 2 km "the lake" want very different ones, and guessing gets one
   *  of them wrong. Closes the Places sheet, since the map is what you asked to
   *  look at. */
  const showPlaceOnMap = useCallback((place: Place) => {
    setPlacesOpen(false)
    // Degrees per metre; longitude converges toward the poles, hence the cos.
    const latSpan = (place.radius_m / 111_320) * PLACE_FRAME_MARGIN
    // Floor the cosine: it heads to 0 at the poles, which would turn the
    // longitude span into a near-infinite one and zoom out to the whole globe.
    const cosLat = Math.max(0.01, Math.cos((place.lat * Math.PI) / 180))
    const lngSpan = (place.radius_m / (111_320 * cosLat)) * PLACE_FRAME_MARGIN
    cameraRef.current?.setCamera({
      bounds: {
        ne: [place.lng + lngSpan, place.lat + latSpan],
        sw: [place.lng - lngSpan, place.lat - latSpan],
      },
      padding: {
        paddingTop: sp.xl,
        paddingLeft: sp.xl,
        paddingRight: sp.xl,
        // Clear the floating roster, or the place lands behind it.
        paddingBottom: ROSTER_HEIGHT + sp.md,
      },
      animationDuration: 600,
    })
  }, [])

  const recenter = useCallback(() => {
    const pts = livePins.map((x) => [x.loc.lng, x.loc.lat] as [number, number])
    if (!pts.length) return
    if (pts.length === 1) {
      cameraRef.current?.setCamera({ centerCoordinate: pts[0], zoomLevel: 14, animationDuration: 500 })
      return
    }
    let minLng = pts[0][0]
    let maxLng = pts[0][0]
    let minLat = pts[0][1]
    let maxLat = pts[0][1]
    for (const [lng, lat] of pts) {
      minLng = Math.min(minLng, lng)
      maxLng = Math.max(maxLng, lng)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }
    cameraRef.current?.fitBounds([maxLng, maxLat], [minLng, minLat], 90, 600)
  }, [livePins])

  // Sheet ordering: me first, then live members, then paused/off.
  const rows = useMemo(() => {
    const order = (email: string): number => {
      if (email === myEmail) return 0
      const l = locByEmail.get(email)
      if (isSharingLive(l)) return 1
      if (isPaused(l)) return 2
      return 3
    }
    return [...profiles].sort((a, b) => order(a.email) - order(b.email) || a.email.localeCompare(b.email))
  }, [profiles, locByEmail, myEmail])

  /** Tap a card or a pin: expand that member in place (tapping the open one
   *  closes it), frame them on the map, and bring their card into view. */
  const select = useCallback(
    (email: string) => {
      const collapsing = selected === email
      setSelected(collapsing ? null : email)
      if (collapsing) return

      const loc = locByEmail.get(email)
      if (isSharingLive(loc)) {
        cameraRef.current?.setCamera({
          centerCoordinate: [loc.lng, loc.lat],
          zoomLevel: FOCUS_ZOOM,
          animationDuration: 600,
          // Push the centre up by the sheet's height, or we'd politely frame
          // them behind the very card you just opened.
          padding: {
            paddingTop: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingBottom: ROSTER_HEIGHT,
          },
        })
      }

      // Bring their card fully into view. NOT done here: at this point the card
      // is still 138pt wide and the content is still the old width, so any
      // offset we computed would be stale — and near the end of the roster the
      // scroll would be clamped short, leaving the expanded card cut off. Flag
      // it instead and let the card scroll itself once it has actually been laid
      // out at its final size (onExpandedLayout).
      focusPending.current = true
    },
    [selected, locByEmail],
  )

  /** The expanded card reporting where it ended up. Scrolling to its real x is
   *  what makes "entirely visible" true regardless of where it sits. */
  const onExpandedLayout = useCallback((x: number) => {
    if (!focusPending.current) return
    focusPending.current = false
    // Left-align it with the roster's padding: the card is 300pt and every
    // supported screen is wider, so left-aligned == fully on screen.
    rosterRef.current?.scrollTo({ x: Math.max(0, x - sp.lg), animated: true })
  }, [])

  const statusLine = useCallback(
    (email: string): string => {
      const loc = locByEmail.get(email)
      const me = email === myEmail
      if (isSharingLive(loc)) {
        const ago = timeAgo(loc.updated_at, t)
        // Being at a saved place is the most useful thing we can say — "At Home"
        // beats "0.2 mi away", for your own card as much as anyone else's.
        const here = placeAt(places, { lat: loc.lat, lng: loc.lng })
        if (here) return `${t('location.atPlace', { place: here.name })} · ${ago}`
        const driving = loc.speed != null && loc.speed > DRIVING_SPEED_MS
        const dist =
          !me && myLive
            ? t('location.away', { dist: formatDistance(haversineMeters(myLive, loc)) })
            : t('location.status.sharing')
        const head = driving ? `${t('location.status.driving')} · ` : ''
        return me ? `${t('location.status.sharing')} · ${ago}` : `${head}${dist} · ${ago}`
      }
      if (isPaused(loc)) return t('location.status.paused')
      return t('location.status.off')
    },
    [locByEmail, myEmail, myLive, places, t],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={t('app.location.name')}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              {/* Safety radius — a Plus feature: the sparkle marks it, a non-Plus
                  tap goes to the paywall, and the button fills while a watch runs. */}
              <HeaderButton
                label={t('location.safety.title')}
                active={!!watch}
                badge={!isPlus}
                icon={(col) => <ShieldCheck size={19} color={col} />}
                onPress={() => (isPlus ? setSafetyOpen(true) : router.push('/paywall'))}
              />
              <HeaderButton
                label={t('location.places.title')}
                icon={(col) => <Landmark size={19} color={col} />}
                onPress={() => setPlacesOpen(true)}
              />
            </View>
          }
        />
      </View>

      <View style={{ flex: 1 }}>
        {MAPBOX_TOKEN ? (
          <MapView
            style={{ flex: 1 }}
            styleURL={
              dark
                ? MAPBOX_STYLE_URL_DARK || MAPBOX_STYLE_URL || Mapbox.StyleURL.Dark
                : MAPBOX_STYLE_URL || Mapbox.StyleURL.Light
            }
            scaleBarEnabled={false}
            compassEnabled={false}
            // Mapbox's ToS requires the logo and OpenStreetMap's ODbL requires
            // the attribution, so both must stay visible. Top-left: the map's
            // own controls sit top-RIGHT and the roster floats along the bottom,
            // so this is the one corner nothing else wants. Their SIZE is not
            // adjustable — @rnmapbox/maps exposes only `*Enabled` and
            // `*Position` for the ornaments, so the (i) is as small as it comes.
            logoPosition={{ top: 8, left: 12 }}
            attributionPosition={{ top: 8, left: 92 }}
          >
            <Camera
              ref={cameraRef}
              // Wide fallback until a fix is known (avoids flashing a zoomed-in
              // random spot); the effect above snaps to the user at INITIAL_ZOOM.
              defaultSettings={{
                centerCoordinate: initialCenter,
                zoomLevel: myLive || deviceCenter || livePins.length ? INITIAL_ZOOM : 3,
              }}
            />
            {/* Safety radius circle — a real geographic polygon, so it stays
                accurate at every zoom (Mapbox circle radii are in pixels). */}
            {watch ? (
              <ShapeSource
                id="safety-radius"
                shape={circlePolygon(
                  { lat: watch.center_lat, lng: watch.center_lng },
                  watch.radius_m,
                )}
              >
                <FillLayer id="safety-radius-fill" style={{ fillColor: c.accent, fillOpacity: 0.12 }} />
                <LineLayer
                  id="safety-radius-line"
                  style={{ lineColor: c.accent, lineWidth: 2, lineDasharray: [2, 2] }}
                />
              </ShapeSource>
            ) : null}

            {/* Saved places — drawn first so member pins sit on top */}
            {places.map((pl) => (
              <MarkerView key={`place-${pl.id}`} coordinate={[pl.lng, pl.lat]} anchor={{ x: 0.5, y: 0.5 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    // Opaque so the place label stays readable over the map.
                    backgroundColor: c.sheet,
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Txt style={{ fontSize: 12 }}>{pl.icon}</Txt>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 11, color: c.textMuted }}>
                    {pl.name}
                  </Txt>
                </View>
              </MarkerView>
            ))}
            {livePins.map(({ p, loc }) => (
              <MarkerView key={p.email} coordinate={[loc.lng, loc.lat]} anchor={{ x: 0.5, y: 0.5 }}>
                <Pressable onPress={() => select(p.email)} accessibilityRole="button">
                  <View
                    style={
                      p.email === myEmail
                        ? { padding: 3, borderRadius: 28, backgroundColor: c.accentSoft }
                        : undefined
                    }
                  >
                    <MemberAvatar
                      name={nameFor(p.email)}
                      avatarPath={meta.avatars[p.email]}
                      color={colors[p.email] ?? c.accent}
                      size={44}
                    />
                  </View>
                </Pressable>
              </MarkerView>
            ))}
          </MapView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: 6 }}>
            <MapPin size={30} color={c.textFaint} />
            <Txt variant="h2" style={{ textAlign: 'center' }}>
              {t('location.needToken.title')}
            </Txt>
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              {t('location.needToken.body')}
            </Txt>
          </View>
        )}

        {/* Right-aligned overlays: a Live pill above the recenter button, kept on
            the right so Mapbox's top-left logo/attribution stay clear. */}
        {MAPBOX_TOKEN ? (
          <View style={{ position: 'absolute', top: sp.md, right: sp.lg, alignItems: 'flex-end', gap: sp.sm }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                backgroundColor: c.sheet,
                borderRadius: radius.pill,
                paddingVertical: 6,
                paddingHorizontal: 11,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.income }} />
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: c.text }}>{t('location.live')}</Txt>
            </View>
            <Pressable
              onPress={recenter}
              accessibilityRole="button"
              accessibilityLabel={t('location.recenter')}
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: c.sheet,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Crosshair size={20} color={c.text} />
            </Pressable>
          </View>
        ) : null}

        {/* Breach alerts — pinned directly above the roster and kept there until
            dismissed, one row per member who crossed out. */}
        {breaches.length ? (
          <View
            style={{
              position: 'absolute',
              left: sp.lg,
              right: sp.lg,
              bottom: ROSTER_HEIGHT + sp.sm,
              gap: sp.sm,
            }}
          >
            {breaches.map((b) => (
              <View
                key={b.email}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: sp.sm,
                  backgroundColor: c.sheet,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: c.expense,
                  paddingVertical: 10,
                  paddingHorizontal: sp.md,
                  ...FLOAT_SHADOW,
                }}
              >
                <ShieldAlert size={18} color={c.expense} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt
                    style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.text }}
                    numberOfLines={1}
                  >
                    {b.title}
                  </Txt>
                  <Txt variant="faint" style={{ fontSize: 11 }} numberOfLines={1}>
                    {t('location.safety.breachBody', { dist: b.dist })}
                  </Txt>
                </View>
                <Pressable
                  onPress={() => setBreaches((prev) => prev.filter((x) => x.email !== b.email))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                >
                  <X size={16} color={c.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* The roster FLOATS on the map — no panel behind it, so the map reads
            edge to edge and the cards look like they're sitting on top of it.
            Each card brings its own opaque fill + shadow instead.
            One card per member, scrolled HORIZONTALLY so the roster is exactly
            as tall for a household of 2 as for one of 10. Your own card is the
            entry point to your sharing controls.
            NOTE: this strip still swallows touches over its full width even
            though it now looks like open map — a horizontal ScrollView has to
            claim the gesture. It's kept to exactly the cards' height so the
            dead band is as small as possible; pan the map above it. */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: ROSTER_BOTTOM_GAP,
          }}
        >
          <ScrollView
            ref={rosterRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: sp.sm,
              paddingHorizontal: sp.lg,
              // Room for the cards' shadows — the scroll view clips to bounds.
              paddingVertical: ROSTER_SHADOW_PAD,
            }}
          >
            {rows.map((p) => {
              const loc = locByEmail.get(p.email)
              const live = isSharingLive(loc)
              const isMe = p.email === myEmail
              // The expanded card replaces the compact one in place — same
              // height, just wider, so the sheet never changes size.
              if (p.email === selected) {
                return (
                  <MemberDetailCard
                    key={p.email}
                    profile={p}
                    location={loc ?? null}
                    isMe={isMe}
                    color={colors[p.email] ?? c.accent}
                    avatarPath={meta.avatars[p.email]}
                    phone={meta.phones[p.email]}
                    myLive={myLive}
                    places={places}
                    watched={!!watch?.watched.includes(p.email)}
                    onCollapse={() => setSelected(null)}
                    onNavigate={() =>
                      isSharingLive(loc) && setNavFor({ profile: p, to: { lat: loc.lat, lng: loc.lng } })
                    }
                    onNudge={() => setNudgeFor(p)}
                    onManageSharing={() => setSharingOpen(true)}
                    onLaidOut={onExpandedLayout}
                  />
                )
              }
              return (
                <MemberCard
                  key={p.email}
                  name={isMe ? t('location.you') : p.display_name}
                  avatarPath={meta.avatars[p.email]}
                  color={colors[p.email] ?? c.accent}
                  status={statusLine(p.email)}
                  hint={isMe ? t('location.card.manage') : undefined}
                  battery={live && loc.battery != null ? loc.battery : null}
                  watched={!!watch?.watched.includes(p.email)}
                  onPress={() => select(p.email)}
                />
              )
            })}
          </ScrollView>
        </View>
      </View>

      {nudgeFor ? (
        <NudgePicker
          profile={nudgeFor}
          onClose={() => setNudgeFor(null)}
          onSent={(text) => setToast({ emoji: '👋', text })}
        />
      ) : null}

      {navFor ? (
        <NavPicker profile={navFor.profile} to={navFor.to} onClose={() => setNavFor(null)} />
      ) : null}

      {safetyOpen ? (
        <SafetyRadiusSheet
          watch={watch}
          profiles={profiles}
          colors={colors}
          locByEmail={locByEmail}
          myEmail={myEmail}
          myLive={myLive}
          avatars={meta.avatars}
          onChanged={() => void reloadWatch()}
          onClose={() => setSafetyOpen(false)}
        />
      ) : null}

      {placesOpen ? (
        <PlacesSheet
          profiles={profiles}
          myEmail={myEmail}
          colors={colors}
          onClose={() => setPlacesOpen(false)}
          onChanged={() => void reloadPlaces()}
          onShowOnMap={showPlaceOnMap}
        />
      ) : null}

      {sharingOpen ? (
        <SharingControls
          myLocation={myLoc ?? null}
          onChanged={() => revalidate()}
          onToast={setToast}
          onClose={() => setSharingOpen(false)}
        />
      ) : null}

      <Toast data={toast} />
    </SafeAreaView>
  )
}
