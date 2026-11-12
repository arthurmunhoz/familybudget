// The photo frame itself: full screen, the screen kept awake, photos played
// from the LOCAL cache with a slow crossfade and a Ken Burns drift, "Added by
// Ana" under each, the clock and date, and — optional — the next calendar
// event and the pet care still to do. Night mode dims (or blacks out) the
// frame between two hours. On a member's birthday their tagged photos lead.
//
// Layout follows the window (useWindowDimensions): phone, tablet, the iPad
// app on a Mac, either way up. The app is portrait-locked on phones, so a
// phone standing sideways uses "Turn sideways" (`rotated`): the whole stage is
// drawn rotated 90° inside the portrait window.
//
// Two image layers: the incoming one is loaded underneath at opacity 0 and
// only revealed once expo-image says it's decoded (onLoad) — never a blank
// frame mid-fade. Tap anywhere for the controls; they hide on their own.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, Easing, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { CalendarDays, Cake, PawPrint, RotateCw, Settings2, WifiOff, X } from 'lucide-react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useToday } from '@/hooks/useToday'
import { useI18n } from '@/hooks/useI18n'
import { petsDue, type PetDue } from '@/lib/assistant'
import { useAuth } from '@/lib/auth'
import { nextBirthday } from '@/lib/birthday'
import { addDays, compareOccurrences, formatTime, occurrencesInRange, type Occurrence } from '@/lib/calendar'
import { supabase } from '@/lib/supabase'
import type { CalendarEvent } from '@/lib/types'
import { fonts, sp } from '@/theme/theme'
import { Avatar } from '@/apps/family/Avatar'
import { useMembers } from '@/apps/games/members'
import { FrameArt } from './FrameArt'
import { applyOrder, buildDeck, fitFor, isNight, kenBurns, type Slide } from './frameLogic'
import { cachedUri, deviceUri, loadDevicePhotos, loadOrder, loadSettings, saveSettings, type DevicePhoto, type FrameOrder, type FrameSettings } from './frameStore'
import { keepAwakeOff, keepAwakeOn } from './keepAwake'
import { useFrameAlbum } from './useFrameAlbum'

const FADE_MS = 1800
const CONTROLS_MS = 5000
const EXTRAS_EVERY_MS = 5 * 60 * 1000
const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

type Layer = { slide: Slide; key: number } | null

export function FrameShow() {
  const { t, lang } = useI18n()
  const locale = LOCALE[lang] ?? 'en-US'
  const { profile, profiles } = useAuth()
  const win = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const today = useToday()

  const [settings, setSettings] = useState<FrameSettings | null>(null)
  const [device, setDevice] = useState<DevicePhoto[]>([])
  const [order, setOrder] = useState<FrameOrder>({ family: [], device: [] })
  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadDevicePhotos().then(setDevice)
    void loadOrder().then(setOrder)
  }, [])

  const usesFamily = !!settings && settings.source !== 'device'
  const usesDevice = !!settings && settings.source !== 'family'
  const album = useFrameAlbum(usesFamily ? profile?.household_id : undefined, { cache: true })

  // ── screen on while open (and while the app is in front) ──────────────────
  const [awake, setAwake] = useState(true)
  useEffect(() => {
    void keepAwakeOn().then(setAwake)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void keepAwakeOn()
    })
    return () => {
      sub.remove()
      keepAwakeOff()
    }
  }, [])

  // ── the clock (ticks on the minute) ───────────────────────────────────────
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const d = new Date()
      setNow(d)
      timer = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50)
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
  const minutes = now.getHours() * 60 + now.getMinutes()
  const night = !!settings?.night && isNight(minutes, settings.nightStart, settings.nightEnd)

  // ── birthdays today (member_profiles.birthday) ────────────────────────────
  const [birthdays, setBirthdays] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void supabase
      .from('member_profiles')
      .select('email, birthday')
      .then(({ data }) => {
        if (!alive) return
        const rows = (data ?? []) as { email: string; birthday: string | null }[]
        setBirthdays(rows.filter((r) => r.birthday && nextBirthday(r.birthday, today).inDays === 0).map((r) => r.email))
      })
    return () => {
      alive = false
    }
  }, [today])

  // ── what can play: only photos that are ON DISK ────────────────────────────
  const members = useMembers()
  const nameOf = useCallback((email: string | null) => profiles.find((p) => p.email === email)?.display_name ?? null, [profiles])
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = []
    if (usesFamily) {
      for (const r of applyOrder(album.rows, order.family)) {
        const uri = cachedUri(r.id)
        if (uri) out.push({ id: r.id, uri, source: 'family', addedBy: r.added_by, memberEmail: r.member_email, width: r.width, height: r.height })
      }
    }
    if (usesDevice) {
      for (const p of applyOrder(device, order.device)) out.push({ id: `d:${p.id}`, uri: deviceUri(p.id), source: 'device', width: p.width, height: p.height })
    }
    return out
    // cacheTick: a newly downloaded file becomes playable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesFamily, usesDevice, album.rows, album.cacheTick, device, order])
  const slidesRef = useRef(slides)
  useEffect(() => {
    slidesRef.current = slides
  }, [slides])
  const pendingDownloads = usesFamily ? album.rows.length - slides.filter((s) => s.source === 'family').length : 0

  // ── the deck + two layers ─────────────────────────────────────────────────
  const deck = useRef<Slide[]>([])
  const lastId = useRef<string | null>(null)
  const birthdaysRef = useRef(birthdays)
  const randomRef = useRef(true)
  useEffect(() => {
    if (settings && settings.random !== randomRef.current) {
      randomRef.current = settings.random
      deck.current = []
    }
  }, [settings])
  const nextSlide = useCallback((): Slide | null => {
    const all = slidesRef.current
    if (!all.length) return null
    const live = new Set(all.map((s) => s.id))
    deck.current = deck.current.filter((s) => live.has(s.id))
    if (!deck.current.length) {
      deck.current = buildDeck(all, birthdaysRef.current, Math.random, randomRef.current)
      // don't show the same photo twice in a row across a reshuffle
      if (deck.current.length > 1 && deck.current[0].id === lastId.current) deck.current.push(deck.current.shift()!)
    }
    const s = deck.current.shift()!
    // the deck holds slide snapshots — hand out the current one (names/uris)
    const fresh = all.find((x) => x.id === s.id) ?? s
    lastId.current = fresh.id
    return fresh
  }, [])
  // A new birthday (midnight) or a newly cached photo reshuffles next pass.
  useEffect(() => {
    birthdaysRef.current = birthdays
    deck.current = []
  }, [birthdays])

  const [layers, setLayers] = useState<[Layer, Layer]>([null, null])
  const [top, setTop] = useState<0 | 1>(0)
  const [opacity] = useState(() => [new Animated.Value(0), new Animated.Value(0)] as const)
  const [motion] = useState(() => [new Animated.Value(0), new Animated.Value(0)] as const)
  const keyRef = useRef(0)
  const waiting = useRef<0 | 1 | null>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const topRef = useRef<0 | 1>(0)
  const shownRef = useRef(false)
  const hasFirst = layers[0] !== null || layers[1] !== null

  const seconds = settings?.seconds ?? 15
  const holdMs = seconds * 1000

  const reveal = useCallback(
    (i: 0 | 1) => {
      if (waiting.current !== i) return
      waiting.current = null
      if (revealTimer.current) clearTimeout(revealTimer.current)
      const other = (i === 0 ? 1 : 0) as 0 | 1
      motion[i].setValue(0)
      Animated.timing(motion[i], { toValue: 1, duration: holdMs + FADE_MS * 2, easing: Easing.linear, useNativeDriver: true }).start()
      opacity[i].setValue(0)
      topRef.current = i
      setTop(i)
      Animated.timing(opacity[i], { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
        if (finished) opacity[other].setValue(0)
      })
    },
    [holdMs, motion, opacity],
  )

  const advance = useCallback(() => {
    const s = nextSlide()
    if (!s) return
    const i = (!shownRef.current ? 0 : topRef.current === 0 ? 1 : 0) as 0 | 1
    shownRef.current = true
    keyRef.current += 1
    const key = keyRef.current
    waiting.current = i
    setLayers((cur) => {
      const next: [Layer, Layer] = [cur[0], cur[1]]
      next[i] = { slide: s, key }
      return next
    })
    // A file that never reports onLoad (corrupt?) mustn't stall the frame.
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = setTimeout(() => reveal(i), 4000)
  }, [nextSlide, reveal])

  // First photo as soon as there is one; then one every `seconds`. Night
  // pauses the show (nothing to see, and no work for the device).
  const playing = slides.length > 0 && !night
  const first = !hasFirst && slides.length > 0
  useEffect(() => {
    if (!first) return
    const id = setTimeout(advance, 0)
    return () => clearTimeout(id)
  }, [first, advance])
  useEffect(() => {
    if (!playing || !hasFirst) return
    const id = setInterval(advance, holdMs + FADE_MS)
    return () => clearInterval(id)
  }, [playing, hasFirst, holdMs, advance])
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current)
    },
    [],
  )

  // ── extras: next event + pet care (refreshed every 5 min) ─────────────────
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [pets, setPets] = useState<PetDue[]>([])
  const loadExtras = useCallback(async () => {
    if (!settings) return
    if (settings.nextEvent) {
      const { data } = await supabase.from('calendar_events').select('*')
      if (data) setEvents(data as CalendarEvent[])
    }
    if (settings.pets) {
      try {
        const r = await petsDue(today)
        setPets(r.rows)
      } catch {
        // offline: keep the last answer
      }
    }
  }, [settings, today])
  useEffect(() => {
    const first = setTimeout(() => void loadExtras(), 0)
    const id = setInterval(() => void loadExtras(), EXTRAS_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [loadExtras])

  const nextEvent = useMemo<Occurrence | null>(() => {
    if (!settings?.nextEvent || !events.length) return null
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const occ = occurrencesInRange(events, today, addDays(today, 14))
      .filter((o) => {
        if (o.end < today) return false
        if (o.start > today || o.end > today) return true
        const ev = o.event
        if (ev.all_day || !ev.start_time) return true
        return (ev.end_time ?? ev.start_time).slice(0, 5) >= hhmm
      })
      .sort((a, b) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : compareOccurrences(a, b)))
    return occ[0] ?? null
  }, [settings?.nextEvent, events, today, now])

  // ── controls ──────────────────────────────────────────────────────────────
  const [controls, setControls] = useState(false)
  const [controlsFade] = useState(() => new Animated.Value(0))
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showControls = useCallback(() => {
    setControls(true)
    Animated.timing(controlsFade, { toValue: 1, duration: 200, useNativeDriver: true }).start()
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsFade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setControls(false))
    }, CONTROLS_MS)
  }, [controlsFade])
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )

  const rotated = !!settings?.rotated
  function toggleRotate() {
    if (!settings) return
    const next = { ...settings, rotated: !settings.rotated }
    setSettings(next)
    void saveSettings(next)
    showControls()
  }
  const exit = () => (router.canGoBack() ? router.back() : router.replace('/calc/frame'))

  // The stage: the window, or the window turned 90°.
  const W = rotated ? win.height : win.width
  const H = rotated ? win.width : win.height
  const stageStyle = rotated
    ? { position: 'absolute' as const, width: W, height: H, left: (win.width - W) / 2, top: (win.height - H) / 2, transform: [{ rotate: '90deg' }] }
    : { position: 'absolute' as const, width: W, height: H, left: 0, top: 0 }
  // Safe-area padding in STAGE coordinates (rotated: the notch is on a side).
  const pad = rotated
    ? { top: Math.max(insets.left, sp.lg), bottom: Math.max(insets.right, sp.lg), left: Math.max(insets.bottom, sp.lg), right: Math.max(insets.top, sp.lg) }
    : { top: Math.max(insets.top, sp.lg), bottom: Math.max(insets.bottom, sp.lg), left: Math.max(insets.left, sp.lg), right: Math.max(insets.right, sp.lg) }
  const unit = Math.min(W, H)
  const large = unit >= 600

  const current = layers[top]?.slide ?? null
  // Who added it: just their avatar, bottom-right (owner, 2026-11 — no text).
  const adder = current?.addedBy ? { name: members.name(current.addedBy), path: members.avatar(current.addedBy) } : null
  const birthdayName =
    current?.memberEmail && birthdays.includes(current.memberEmail) ? nameOf(current.memberEmail) : null
  const showOverlay = !night || settings?.nightStyle === 'dim'
  const timeText = now.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const dateText = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ animation: 'fade', gestureEnabled: true }} />
      <StatusBar hidden />
      <Pressable accessibilityRole="button" accessibilityLabel={t('frame.title')} onPress={showControls} style={stageStyle}>
        <View style={StyleSheet.absoluteFill}>
          {([0, 1] as const).map((i) => {
            const l = layers[i]
            if (!l) return null
            return (
              <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity: opacity[i], zIndex: top === i ? 2 : 1 }]}>
                <SlideView slide={l.slide} width={W} height={H} progress={motion[i]} onLoad={() => reveal(i)} />
              </Animated.View>
            )
          })}
        </View>

        {!slides.length && settings ? (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <FrameArt size={Math.min(unit * 0.32, 180)} />
            <Txt style={[styles.emptyTitle, { fontSize: large ? 30 : 24 }]}>
              {pendingDownloads > 0 ? t('frame.downloading') : t('frame.empty')}
            </Txt>
            <Txt style={styles.emptySub}>
              {pendingDownloads > 0 ? t('frame.downloadingSub', { n: pendingDownloads }) : t('frame.emptySub')}
            </Txt>
          </View>
        ) : null}

        {/* scrim so white text reads on any photo */}
        {hasFirst && showOverlay ? <Scrim width={W} height={H} /> : null}

        {night ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: settings?.nightStyle === 'off' ? 1 : 0.82, zIndex: 5 }]} />
        ) : null}

        {showOverlay ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 6, opacity: night ? 0.55 : 1 }]}>
            {/* top-right: what's next */}
            {!night ? (
              <View style={[styles.extras, { top: pad.top, right: pad.right, maxWidth: Math.min(W * 0.5, 420) }]}>
                {birthdayName ? <InfoPill icon={<Cake size={large ? 18 : 15} color="#fff" />} text={t('frame.happyBirthday', { name: birthdayName })} large={large} /> : null}
                {nextEvent ? (
                  <InfoPill
                    icon={<CalendarDays size={large ? 18 : 15} color="#fff" />}
                    text={eventLine(nextEvent, today, locale, t)}
                    large={large}
                  />
                ) : null}
                {settings?.pets && pets.length ? (
                  <InfoPill
                    icon={<PawPrint size={large ? 18 : 15} color="#fff" />}
                    text={
                      [pets[0].pet, pets[0].title].filter(Boolean).join(' · ') +
                      (pets.length > 1 ? `  ${t('frame.petsMore', { n: pets.length - 1 })}` : '')
                    }
                    large={large}
                  />
                ) : null}
                {album.offline && usesFamily ? <InfoPill icon={<WifiOff size={large ? 18 : 15} color="#fff" />} text={t('frame.offline')} large={large} /> : null}
              </View>
            ) : null}

            {/* bottom-left: clock + date; bottom-right: avatar of who added it */}
            <View style={[styles.bottom, { left: pad.left, right: pad.right, bottom: pad.bottom }]}>
              {settings?.clock ? (
                <View style={{ flexShrink: 1 }}>
                  <Txt style={[styles.time, { fontSize: Math.round(unit * (large ? 0.13 : 0.16)), lineHeight: Math.round(unit * (large ? 0.145 : 0.18)) }]}>
                    {timeText}
                  </Txt>
                  <Txt style={[styles.date, { fontSize: large ? 22 : 16 }]}>{capitalize(dateText)}</Txt>
                </View>
              ) : (
                <View />
              )}
              {!night && adder ? (
                <View
                  accessibilityLabel={t('frame.addedBy', { name: adder.name })}
                  style={[styles.adder, { borderRadius: (large ? 46 : 34) / 2 + 2 }]}
                >
                  <Avatar name={adder.name} avatarPath={adder.path} size={large ? 46 : 34} />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {controls ? (
          <Animated.View style={[styles.controls, { opacity: controlsFade, top: pad.top, left: pad.left, right: pad.right }]}>
            <RoundBtn label={t('frame.close')} onPress={exit}>
              <X size={22} color="#fff" />
            </RoundBtn>
            <View style={{ flex: 1 }} />
            {!awake ? (
              <Txt style={styles.warn} numberOfLines={2}>
                {t('frame.awakeMissing')}
              </Txt>
            ) : null}
            {win.height > win.width || rotated ? (
              <RoundBtn label={t('frame.rotate')} onPress={toggleRotate}>
                <RotateCw size={20} color="#fff" />
              </RoundBtn>
            ) : null}
            <RoundBtn label={t('frame.settings')} onPress={exit}>
              <Settings2 size={20} color="#fff" />
            </RoundBtn>
          </Animated.View>
        ) : null}
      </Pressable>
    </View>
  )
}

/** One photo, filling the stage — or shown whole over a blurred, darkened
 *  copy of itself when its shape fights the screen's — drifting slowly. */
function SlideView({
  slide,
  width,
  height,
  progress,
  onLoad,
}: {
  slide: Slide
  width: number
  height: number
  progress: Animated.Value
  onLoad: () => void
}) {
  const fit = fitFor(slide.width, slide.height, width, height)
  const kb = kenBurns(slide.id)
  const drift = Math.min(width, height) * 0.025
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: fit === 'cover' ? [kb.from, kb.to] : [1, 1 + (kb.to - kb.from) * 0.4] })
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, kb.dx * drift] })
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, kb.dy * drift] })
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {fit === 'contain' ? (
        <>
          <Image source={{ uri: slide.uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} transition={0} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        </>
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { translateY }, { scale }] }]}>
        <Image
          source={{ uri: slide.uri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          transition={0}
          recyclingKey={slide.id}
          onLoad={onLoad}
          onError={onLoad}
        />
      </Animated.View>
    </View>
  )
}

function Scrim({ width, height }: { width: number; height: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 4 }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="frameScrimTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="frameScrimBottom" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.55} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height * 0.25} fill="url(#frameScrimTop)" />
        <Rect x={0} y={height * 0.55} width={width} height={height * 0.45} fill="url(#frameScrimBottom)" />
      </Svg>
    </View>
  )
}

function InfoPill({ icon, text, large }: { icon: ReactNode; text: string; large: boolean }) {
  return (
    <View style={[styles.pill, large && { paddingHorizontal: 16, paddingVertical: 10 }]}>
      {icon}
      <Txt style={[styles.pillText, { fontSize: large ? 17 : 14 }]} numberOfLines={2}>
        {text}
      </Txt>
    </View>
  )
}

function RoundBtn({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.round, { opacity: pressed ? 0.7 : 1 }]}>
      {children}
    </Pressable>
  )
}

function eventLine(o: Occurrence, today: string, locale: string, t: (k: 'frame.today' | 'frame.tomorrow') => string): string {
  const ev = o.event
  const startDay = o.start < today ? today : o.start
  const day =
    startDay === today
      ? t('frame.today')
      : startDay === addDays(today, 1)
        ? t('frame.tomorrow')
        : capitalize(new Date(`${startDay}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }))
  const when = ev.all_day || !ev.start_time || o.start < today ? '' : ` ${formatTime(ev.start_time, locale)}`
  return `${ev.title} · ${day}${when}`
}

function capitalize(s: string): string {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: sp.sm },
  emptyTitle: { color: '#fff', fontFamily: fonts.display, textAlign: 'center', marginTop: sp.md },
  emptySub: { color: 'rgba(255,255,255,0.7)', fontSize: 15, textAlign: 'center', maxWidth: 420 },
  extras: { position: 'absolute', alignItems: 'flex-end', gap: sp.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pillText: { color: '#fff', fontFamily: fonts.medium, flexShrink: 1 },
  bottom: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: sp.lg },
  time: { color: '#fff', fontFamily: fonts.display, letterSpacing: -1, ...shadow },
  date: { color: 'rgba(255,255,255,0.9)', fontFamily: fonts.semibold, marginTop: 2, ...shadow },
  adder: { padding: 2, backgroundColor: 'rgba(255,255,255,0.85)', marginBottom: 4, ...shadow },
  controls: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: sp.sm, zIndex: 10 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  warn: { color: '#fff', fontSize: 12, maxWidth: 220, textAlign: 'right', ...shadow },
})
