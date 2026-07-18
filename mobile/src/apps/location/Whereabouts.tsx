// Whereabouts — the live family map. Owns the member-location data + a single
// Realtime subscription, renders a Mapbox map with a pin per sharing member and
// a bottom sheet listing everyone with their status. Tapping a pin or a row
// opens the member detail sheet (ETA-first). A header button opens the sharing
// controls. Native-only: the map (@rnmapbox/maps) and background location need a
// dev build + EXPO_PUBLIC_MAPBOX_TOKEN — see mobile/WHEREABOUTS-SETUP.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Localization from 'expo-localization'
import { router } from 'expo-router'
import Mapbox, { Camera, FillLayer, LineLayer, MapView, MarkerView, ShapeSource } from '@rnmapbox/maps'
import { MapPin, SlidersHorizontal, Crosshair, Landmark, ShieldCheck, Sparkles } from 'lucide-react-native'

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
import { fetchPlaces } from '@/lib/places'
import { syncGeofences } from '@/lib/placesTask'
import { usePlus } from '@/lib/plus'
import { requestLive } from '@/lib/liveLocation'
import { alertBreach, circlePolygon, fetchMyWatch, isOutside } from '@/lib/safetyRadius'
import type { MemberLocation, Place, Profile, SafetyWatch } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { BatteryChip, buildMemberColors, MemberAvatar, timeAgo } from './locationUi'
import { MemberSheet } from './MemberSheet'
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

export default function Whereabouts() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const { isPlus } = usePlus()
  const myEmail = profile?.email ?? null

  const cameraRef = useRef<Camera>(null)
  const centeredOnce = useRef(false)
  const [meta, setMeta] = useState<{ avatars: Record<string, string | null>; phones: Record<string, string> }>({
    avatars: {},
    phones: {},
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [sharingOpen, setSharingOpen] = useState(false)
  const [placesOpen, setPlacesOpen] = useState(false)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)

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
        setToast({ emoji: '⚠️', text: title })
      } else if (!out && was) {
        breachedRef.current.delete(email)
      }
    }
  }, [watch, locByEmail, nameFor, t])

  const myLoc = myEmail ? locByEmail.get(myEmail) : undefined
  const myLive = isSharingLive(myLoc) ? myLoc : null
  const iAmSharing = isSharingEnabled(myLoc)

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
    if (livePins[0]) return [livePins[0].loc.lng, livePins[0].loc.lat]
    return [-98.5, 39.5] // continental US fallback until a fix arrives
  }, [myLive, livePins])

  // On first load, frame the user (or, if I'm not sharing, whoever is live) at a
  // comfortable neighborhood zoom — not zoomed in too tight. Runs once, so it
  // never fights the user's own panning afterward.
  useEffect(() => {
    if (centeredOnce.current) return
    const focus = myLive ?? livePins[0]?.loc
    if (!focus) return
    centeredOnce.current = true
    cameraRef.current?.setCamera({
      centerCoordinate: [focus.lng, focus.lat],
      zoomLevel: INITIAL_ZOOM,
      animationDuration: 0,
    })
  }, [myLive, livePins])

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

  const statusLine = useCallback(
    (email: string): string => {
      const loc = locByEmail.get(email)
      const me = email === myEmail
      if (isSharingLive(loc)) {
        const driving = loc.speed != null && loc.speed > DRIVING_SPEED_MS
        const dist =
          !me && myLive
            ? t('location.away', { dist: formatDistance(haversineMeters(myLive, loc)) })
            : t('location.status.sharing')
        const ago = timeAgo(loc.updated_at, t)
        const head = driving ? `${t('location.status.driving')} · ` : ''
        return me ? `${t('location.status.sharing')} · ${ago}` : `${head}${dist} · ${ago}`
      }
      if (isPaused(loc)) return t('location.status.paused')
      return t('location.status.off')
    },
    [locByEmail, myEmail, myLive, t],
  )

  const selectedProfile = selected ? profiles.find((p) => p.email === selected) ?? null : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={t('app.location.name')}
          icon={<MapPin size={20} color={c.accent} />}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.lg }}>
              {/* Safety radius — a Plus feature: the sparkle badge marks it, and
                  a non-Plus tap goes to the paywall instead of the sheet. */}
              <Pressable
                onPress={() => (isPlus ? setSafetyOpen(true) : router.push('/paywall'))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('location.safety.title')}
              >
                <View>
                  <ShieldCheck size={22} color={watch ? c.accent : c.textMuted} />
                  {!isPlus ? (
                    <View style={{ position: 'absolute', top: -5, right: -7 }}>
                      <Sparkles size={12} color={c.accent} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => setPlacesOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('location.places.title')}
              >
                <Landmark size={22} color={c.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => setSharingOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('location.openSharing')}
              >
                <SlidersHorizontal size={22} color={c.textMuted} />
              </Pressable>
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
            // Keep Mapbox's logo + attribution up top so the bottom sheet can't
            // cover them (their ToS requires both stay visible).
            logoPosition={{ top: 12, left: 16 }}
            attributionPosition={{ top: 12, left: 96 }}
          >
            <Camera
              ref={cameraRef}
              // Wide fallback until a fix is known (avoids flashing a zoomed-in
              // random spot); the effect above snaps to the user at INITIAL_ZOOM.
              defaultSettings={{
                centerCoordinate: initialCenter,
                zoomLevel: myLive || livePins.length ? INITIAL_ZOOM : 3,
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
                    backgroundColor: c.card,
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
                <Pressable onPress={() => setSelected(p.email)} accessibilityRole="button">
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

        {/* Bottom sheet — everyone + status */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: sp.lg,
            paddingTop: sp.sm,
            paddingBottom: sp.xl,
            maxHeight: 320,
            borderTopWidth: 1,
            borderColor: c.border,
          }}
        >
          <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center', marginBottom: sp.sm }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>{t('location.everyone')}</Txt>
            <Txt variant="faint">{t('location.tapHint')}</Txt>
          </View>
          {!iAmSharing ? (
            <Pressable
              onPress={() => setSharingOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                {
                  marginVertical: sp.sm,
                  backgroundColor: c.accent,
                  borderRadius: radius.md,
                  paddingVertical: 12,
                  alignItems: 'center',
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Txt style={{ fontFamily: fonts.semibold, color: '#ffffff', fontSize: 14 }}>
                {t('location.share.toggle')}
              </Txt>
            </Pressable>
          ) : null}
          <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
            {rows.map((p) => {
              const loc = locByEmail.get(p.email)
              const live = isSharingLive(loc)
              return (
                <Pressable
                  key={p.email}
                  onPress={() => setSelected(p.email)}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 11,
                      paddingVertical: 9,
                      borderTopWidth: 1,
                      borderColor: c.border,
                    },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <MemberAvatar
                    name={nameFor(p.email)}
                    avatarPath={meta.avatars[p.email]}
                    color={colors[p.email] ?? c.accent}
                    size={38}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
                      {p.email === myEmail ? `${p.display_name} · ${t('location.you')}` : p.display_name}
                    </Txt>
                    <Txt variant="muted" numberOfLines={1} style={{ fontSize: 12 }}>
                      {statusLine(p.email)}
                    </Txt>
                  </View>
                  {live && loc.battery != null ? <BatteryChip level={loc.battery} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </View>

      {selectedProfile ? (
        <MemberSheet
          profile={selectedProfile}
          location={locByEmail.get(selectedProfile.email) ?? null}
          isMe={selectedProfile.email === myEmail}
          color={colors[selectedProfile.email] ?? c.accent}
          avatarPath={meta.avatars[selectedProfile.email]}
          phone={meta.phones[selectedProfile.email]}
          myLive={myLive}
          onClose={() => setSelected(null)}
        />
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
          colors={colors}
          onClose={() => setPlacesOpen(false)}
          onChanged={() => void reloadPlaces()}
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
