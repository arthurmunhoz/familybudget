// The top of the Hub (2026-11 "Comando" redesign): the date + weather line
// (home city from Settings, via lib/weather), a big greeting that says how many
// things today holds, the "ask anything" bar (lib/assistant, AskSheet), any
// weather alert, and today's agenda as a row of swipeable cards — calendar
// events (birthdays/anniversaries with "turns N"/"N years") and pet care due
// today or overdue. Tapping a card opens its app. Also owns the Today WIDGET
// sync (syncTodayConfig/syncTodayWidget below), so it must stay mounted on the
// Hub. Reloads on focus so it reflects new events / a changed home city.
import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import {
  CloudLightning,
  CloudRain,
  CloudSnow,
  ThermometerSnowflake,
  ThermometerSun,
  Wind,
  type LucideIcon,
} from 'lucide-react-native'

import { Txt } from './ui'
import { AGENDA_GRADIENT } from './home/palette'
import { AgendaCard, CARD_H, CARD_W, type AgendaFace } from './home/AgendaCard'
import { FamilyToday, type FamilyLane, type FamilyPetLine } from './home/FamilyToday'
import { Skeleton } from './Skeleton'
import { CityPickerSheet } from './CityPickerSheet'
import { useCachedQuery, useRevalidateOnForeground } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { useToday } from '../hooks/useToday'
import { supabase } from '../lib/supabase'
import {
  KIND_EMOJI,
  compareOccurrences,
  formatTime,
  memberColor,
  occurrencesByDay,
  yearsAt,
} from '../lib/calendar'
import { classifyAgenda, petTypeIcon } from '../lib/agendaKind'
import { useAuth } from '../lib/auth'
import { speciesEmoji } from '../apps/pets/petMeta'
import { overdueEvents } from '../lib/petCare'
import type { CalendarEvent, PetEvent } from '../lib/types'
import { useHomeWeather, weatherIcon, type WeatherAlertKind } from '../lib/weather'
import { WeatherScene } from './home/WeatherScene'
import { sceneFor } from './home/sceneKind'
import { syncTodayConfig, syncTodayWidget, type TodayWidgetItem } from '../lib/widget'
import type { TKey } from '../lib/i18n'
import { fonts, sp, useTheme } from '../theme/theme'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const MAX_CARDS = 8
/** How far the weather sky reaches below the status bar. */
const SCENE_H = 280

// Home-screen weather alert: an on-brand Lucide icon + localized message per kind.
const WEATHER_ALERT: Record<WeatherAlertKind, { icon: LucideIcon; key: TKey }> = {
  thunder: { icon: CloudLightning, key: 'home.weatherThunder' },
  snow: { icon: CloudSnow, key: 'home.weatherSnow' },
  heat: { icon: ThermometerSun, key: 'home.weatherHeat' },
  cold: { icon: ThermometerSnowflake, key: 'home.weatherCold' },
  wind: { icon: Wind, key: 'home.weatherWind' },
  rain: { icon: CloudRain, key: 'home.weatherRain' },
}

type PetLite = {
  id: string
  name: string
  emoji: string
  species: string | null
  photo_path: string | null
  tag_color: string | null
  birthday: string | null
}
type MemberLite = { email: string; avatar_path: string | null; birthday: string | null }

/** Whole years from an ISO birth date to an occurrence date (0 = unknown). */
function yearsFrom(birth: string | null | undefined, onISO: string): number {
  if (!birth) return 0
  const n = Number(onISO.slice(0, 4)) - Number(birth.slice(0, 4))
  return n > 0 ? n : 0
}

// Placeholders (shared Skeleton) hold the weather/alert area while the
// forecast loads, so the card doesn't jump when the value lands.
// Matches the top-right weather block (icon + temp, then the city line).
function WeatherSkeleton() {
  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Skeleton style={{ width: 20, height: 20, borderRadius: 10 }} />
        <Skeleton style={{ width: 34, height: 15 }} />
      </View>
      <Skeleton style={{ width: 52, height: 10 }} />
    </View>
  )
}

// Matches the alert banner (same height + accentSoft chip) so it doesn't reflow.

export default function TodaySection({
  name,
  household,
  below,
  right,
}: {
  /** First name for the greeting. */
  name: string
  household: string | null
  /** Open the ask sheet; `listen` = straight into voice (the mic). */
  /** Under the greeting: the family strip. */
  below?: ReactNode
  /** Header slot on the right (the Settings button). */
  right?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { c, dark } = useTheme()
  const { t, lang } = useI18n()
  const locale = LOCALE[lang] ?? 'en-US'
  // Not `todayISO()`: this card is on the Hub, the screen most likely to be the
  // one the app was left on, and a plain render-time date froze on whatever day
  // that was — the heading still read "Sunday, Aug 10" two days later, over the
  // 10th's agenda. useToday advances on foreground and at midnight.
  const today = useToday()

  const unit = lang === 'en' ? 'fahrenheit' : 'celsius'
  const {
    location,
    weather,
    alert: weatherAlert,
    loading: weatherLoading,
    reload: reloadWeather,
  } = useHomeWeather(unit)

  // No city yet → set one right here (keyboard up, one tap). Once a city IS set,
  // the same button goes to Settings' Weather section, which owns changing and
  // removing it.
  const [pickingCity, setPickingCity] = useState(false)

  type TodayData = { events: CalendarEvent[]; petEvents: PetEvent[]; pets: PetLite[]; members: MemberLite[] }
  const { data = { events: [], petEvents: [], pets: [], members: [] }, revalidate } =
    useCachedQuery<TodayData>('hub:today', async () => {
      const [ev, pe, pt, mp] = await Promise.all([
        supabase.from('calendar_events').select('*'),
        supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
        supabase.from('pets').select('id, name, emoji, species, photo_path, tag_color, birthday'),
        // Faces + ages for the cards; a failure just means initials, no "turns N".
        supabase.from('member_profiles').select('email, avatar_path, birthday'),
      ])
      return {
        events: (ev.data ?? []) as CalendarEvent[],
        petEvents: (pe.data ?? []) as PetEvent[],
        pets: (pt.data ?? []) as PetLite[],
        members: (mp.data ?? []) as MemberLite[],
      }
    })
  const { profile, profiles } = useAuth()
  const me = profile?.email ?? null
  // The clock for "Now" / what's still ahead today — refreshed on focus, not
  // read during render.
  const [nowHM, setNowHM] = useState(() => new Date().toTimeString().slice(0, 5))

  // Keep it fresh when returning to the Hub (e.g. after adding an event or
  // setting the home city in Settings).
  useFocusEffect(
    useCallback(() => {
      void reloadWeather()
      void revalidate()
      setNowHM(new Date().toTimeString().slice(0, 5))
    }, [reloadWeather, revalidate]),
  )

  // The agenda is a useCachedQuery and refreshes itself on foreground; the
  // forecast comes from useHomeWeather, which caches by hand and has no such
  // hook, so reopening the app showed the temperature it fetched last session.
  useRevalidateOnForeground(reloadWeather)

  const petById = useMemo(
    () => Object.fromEntries(data.pets.map((p) => [p.id, p])) as Record<string, PetLite>,
    [data.pets],
  )
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  const memberNames = useMemo(
    () => profiles.map((p) => ({ email: p.email, name: p.display_name || '' })),
    [profiles],
  )
  const memberMeta = useMemo(
    () => Object.fromEntries((data.members ?? []).map((m) => [m.email, m])) as Record<string, MemberLite>,
    [data.members],
  )
  const petFace = (pet: PetLite): AgendaFace => ({
    type: 'pet',
    name: pet.name,
    photoPath: pet.photo_path ?? null,
    emoji: pet.emoji || speciesEmoji(pet.species ?? null),
    color: pet.tag_color ?? null,
  })
  const memberFace = (email: string): AgendaFace | null => {
    const p = profiles.find((x) => x.email === email)
    if (!p) return null
    return {
      type: 'member',
      name: p.display_name || email,
      avatarPath: memberMeta[email]?.avatar_path ?? null,
      color: memberColor(email, memberEmails),
    }
  }
  const todaysOcc = useMemo(
    () => [...(occurrencesByDay(data.events, today, today).get(today) ?? [])].sort(compareOccurrences),
    [data.events, today],
  )
  const petDue = useMemo(() => overdueEvents(data.petEvents, today), [data.petEvents, today])

  const dateLabel = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  }, [today, locale])

  const WIcon = weather ? weatherIcon(weather.code) : null
  const alertMeta = weatherAlert ? WEATHER_ALERT[weatherAlert] : null
  const AlertIcon = alertMeta?.icon
  // "Westchase, Florida, US" → "Westchase" for the compact city line.
  const cityShort = location?.city.split(',')[0].trim() ?? ''
  const totalItems = todaysOcc.length + petDue.length

  // 2026-11: with other people in the family, the cards are only MINE ("For
  // you": my events + the whole household's); everyone else's — and the pets —
  // fold into the "Family today" card, one row per person. Alone, it's the
  // old single row of cards.
  const solo = profiles.length <= 1 || !me
  const isMine = (ev: CalendarEvent) => !ev.owner_email || ev.owner_email === me
  // What's over by now drops behind what's still ahead.
  const ended = (ev: CalendarEvent) => !ev.all_day && (ev.end_time ?? ev.start_time ?? '99').slice(0, 5) <= nowHM
  const live = (ev: CalendarEvent) =>
    !ev.all_day && !!ev.start_time && ev.start_time.slice(0, 5) <= nowHM && !ended(ev)
  const aheadFirst = <T extends { event: CalendarEvent }>(list: T[]) => [
    ...list.filter((o) => !ended(o.event)),
    ...list.filter((o) => ended(o.event)),
  ]
  const mineOcc = aheadFirst(solo ? todaysOcc : todaysOcc.filter((o) => isMine(o.event)))
  const mineCount = mineOcc.length + (solo ? petDue.length : 0)
  const cardMax = solo ? MAX_CARDS : 4
  // Cards: calendar first (time order, what's ahead first), then pet care.
  const shownOcc = mineOcc.slice(0, cardMax)
  const shownPet = solo ? petDue.slice(0, Math.max(0, cardMax - shownOcc.length)) : []
  const overflow = mineCount - (shownOcc.length + shownPet.length)

  // Everyone else's day as a summary (FamilyToday): one lane per person with
  // their timed events, the span of the day that holds them, what's on now /
  // next, and the pets' care due.
  const family = useMemo(() => {
    const empty = { lanes: [] as FamilyLane[], count: 0, span: null as { from: number; to: number } | null, nowLine: null as string | null, nextLine: null as string | null, pets: [] as FamilyPetLine[] }
    if (solo) return empty
    const theirs = todaysOcc.filter((o) => o.event.owner_email && o.event.owner_email !== me)
    const toMin = (hm: string | null | undefined) => (hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : null)
    const nowM = toMin(nowHM) ?? 0
    // a timed event's minutes on TODAY (multi-day spans clip to the day)
    const minutes = (o: (typeof theirs)[number]) => {
      const ev = o.event
      if (ev.all_day) return null
      const s0 = o.start === today ? (toMin(ev.start_time) ?? 0) : 0
      let e0 = o.end === today ? toMin(ev.end_time) : 1440
      if (e0 == null || e0 <= s0) e0 = Math.min(1440, s0 + 60)
      return { start: s0, end: e0 }
    }
    const firstName = (email: string) => (profiles.find((x) => x.email === email)?.display_name || email).trim().split(/\s+/)[0]
    const byOwner = new Map<string, typeof theirs>()
    for (const o of theirs) byOwner.set(o.event.owner_email!, [...(byOwner.get(o.event.owner_email!) ?? []), o])
    let from = 1440
    let to = 0
    const lanes: FamilyLane[] = [...byOwner.entries()].map(([email, occ]) => {
      const blocks = occ.map(minutes).filter((x): x is { start: number; end: number } => !!x)
      for (const b of blocks) {
        from = Math.min(from, b.start)
        to = Math.max(to, b.end)
      }
      const p = profiles.find((x) => x.email === email)
      const color = memberColor(email, memberEmails)
      return {
        key: email,
        face: { type: 'member' as const, name: p?.display_name || email, avatarPath: memberMeta[email]?.avatar_path ?? null, color },
        color,
        blocks,
        allDay: occ.some((o) => o.event.all_day),
      }
    })
    // lanes in order of each person's first event
    lanes.sort((a, b) => (a.blocks[0]?.start ?? 9999) - (b.blocks[0]?.start ?? 9999))
    let span: { from: number; to: number } | null = null
    if (to > from) {
      let f = Math.floor(from / 60) * 60
      let tt = Math.ceil(to / 60) * 60
      // at least 4 hours wide, so one short meeting isn't a full bar
      while (tt - f < 240) {
        if (f > 0) f -= 60
        if (tt - f < 240 && tt < 1440) tt += 60
        if (f === 0 && tt === 1440) break
      }
      span = { from: f, to: tt }
    }
    const fmt = (m: number) => formatTime(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, locale)
    const timed = theirs
      .map((o) => ({ o, m: minutes(o) }))
      .filter((x): x is { o: (typeof theirs)[number]; m: { start: number; end: number } } => !!x.m)
      .sort((a, b) => a.m.start - b.m.start)
    const nowOne = timed.find((x) => x.m.start <= nowM && x.m.end > nowM)
    const nextOne = timed.find((x) => x.m.start > nowM)
    const nowLine = nowOne
      ? t('home.familyNowLine', { name: firstName(nowOne.o.event.owner_email!), title: nowOne.o.event.title, time: fmt(nowOne.m.end) })
      : null
    const nextLine = nextOne
      ? t('home.familyNextLine', { name: firstName(nextOne.o.event.owner_email!), title: nextOne.o.event.title, time: fmt(nextOne.m.start) })
      : timed.length
        ? t('home.familyDone')
        : null
    const pets: FamilyPetLine[] = petDue
      .map((e) => {
        const overdue = (e.next_due ?? '') < today
        const pet = petById[e.pet_id]
        return {
          key: e.id,
          text: `${pet ? `${pet.name} · ` : ''}${e.title} · ${overdue ? t('home.overdue') : t('home.dueToday')}`,
          alert: overdue,
        }
      })
      .sort((a, b) => Number(b.alert) - Number(a.alert))
      .slice(0, 3)
    return { lanes, count: theirs.length, span, nowLine, nextLine, pets }
  }, [solo, todaysOcc, petDue, profiles, me, nowHM, memberMeta, memberEmails, petById, locale, t, today])
  const familySummary = [
    family.count === 1 ? t('home.familyEventsOne') : family.count > 1 ? t('home.familyEvents', { n: family.count }) : null,
    family.span
      ? t('home.familySpan', {
          from: formatTime(`${String(family.span.from / 60).padStart(2, '0')}:00`, locale),
          to: formatTime(`${String((family.span.to / 60) % 24).padStart(2, '0')}:00`, locale),
        })
      : null,
    !family.count && family.pets.length ? family.pets[0].text : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Home-screen "Today" widget: same agenda + weather, written to the App Group.
  const widgetItems: TodayWidgetItem[] = useMemo(() => {
    const evItems = todaysOcc.map((o) => {
      const ev = o.event
      const years = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
      const time = ev.all_day ? null : ev.start_time ? formatTime(ev.start_time, locale) : null
      const subtitle =
        ev.kind === 'birthday' && years > 0
          ? t('home.turns', { n: years })
          : ev.kind === 'anniversary' && years > 0
            ? t('home.years', { n: years })
            : time
      return { emoji: KIND_EMOJI[ev.kind] || '📅', title: ev.title, subtitle: subtitle ?? null }
    })
    const petItems = petDue.map((e) => ({
      emoji: petById[e.pet_id]?.emoji || '🐾',
      title: e.title,
      subtitle: (e.next_due ?? '') < today ? t('home.overdue') : t('home.dueToday'),
    }))
    return [...evItems, ...petItems].slice(0, 6)
  }, [todaysOcc, petDue, petById, locale, t, today])

  // What the widget needs to refresh itself with the app closed (weather coords,
  // locale, translated alert copy). Separate from the snapshot below because it
  // stays valid indefinitely — the snapshot goes stale the moment the day turns.
  useEffect(() => {
    syncTodayConfig({
      locale,
      unit,
      lat: location?.lat ?? null,
      lon: location?.lon ?? null,
      city: cityShort || null,
      alerts: Object.fromEntries(
        (Object.keys(WEATHER_ALERT) as WeatherAlertKind[]).map((k) => [k, t(WEATHER_ALERT[k].key)]),
      ),
    })
  }, [locale, unit, location, cityShort, t])

  useEffect(() => {
    const [y, m, d] = today.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    syncTodayWidget({
      todayLabel: t('home.today'),
      day: today,
      dateLong: dt.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
      dateShort: dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }),
      temp: weather?.temperature ?? null,
      unit: weather?.unit ?? null,
      code: weather?.code ?? null,
      city: cityShort || null,
      alert: weatherAlert ? t(WEATHER_ALERT[weatherAlert].key) : null,
      alertKind: weatherAlert ?? null,
      items: widgetItems,
      emptyLabel: t('home.nothingToday'),
    })
  }, [widgetItems, weather, weatherAlert, cityShort, locale, t, today])

  const headerLine = [
    dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    weather ? `${weather.temperature}${weather.unit}` : null,
    household,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {/* The current weather as a soft sky behind the header, from the very
          top of the screen (Hub drops its top safe-area edge for this). */}
      {weather ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: -insets.top, left: -sp.lg, right: -sp.lg, height: insets.top + SCENE_H }}
        >
          <WeatherScene kind={sceneFor(weather.code, weather.isDay)} height={insets.top + SCENE_H} />
        </View>
      ) : null}

      {/* date · weather · household — tap for the weather settings */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingTop: sp.sm }}>
        <Pressable
          onPress={() =>
            location
              ? router.push({ pathname: '/settings', params: { highlight: 'weather' } })
              : setPickingCity(true)
          }
          hitSlop={6}
          accessibilityRole="button"
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          {weather && WIcon ? createElement(WIcon, { size: 16, color: c.textMuted }) : null}
          {weatherLoading && !weather ? (
            <WeatherSkeleton />
          ) : (
            <Txt variant="muted" style={{ fontSize: 13.5 }} numberOfLines={1}>
              {headerLine}
              {!location ? <Txt style={{ color: c.accent, fontSize: 13.5 }}> · {t('home.setCity')}</Txt> : null}
            </Txt>
          )}
        </Pressable>
        {right}
      </View>

      {/* today's weather alert, up here with the weather (owner, 2026-11):
          centred in a faint glass chip so it reads apart from the date ·
          weather line above it, without turning into a banner. */}
      {alertMeta && AlertIcon ? (
        <View
          style={{
            alignSelf: 'center',
            maxWidth: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: sp.md,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.06)',
          }}
        >
          <AlertIcon size={15} color={c.text} />
          <Txt style={{ flexShrink: 1, fontSize: 13.5, fontFamily: fonts.semibold, color: c.text }} numberOfLines={1}>
            {t(alertMeta.key)}
          </Txt>
        </View>
      ) : null}

      {/* greeting + how the day looks */}
      <Txt style={{ fontFamily: fonts.display, fontSize: 38, lineHeight: 44, letterSpacing: -0.8, marginTop: sp.md }}>
        {t('home.hi', { name })}
      </Txt>
      <Txt style={{ fontFamily: fonts.display, fontSize: 38, lineHeight: 44, letterSpacing: -0.8, color: c.textFaint }}>
        {totalItems === 0
          ? t('home.calmDay')
          : totalItems === 1
            ? t('home.thingsOne')
            : t('home.thingsMany', { n: totalItems })}
      </Txt>

      {/* the family (the assistant moved to the bottom dock, by the thumb) */}
      {below}

      {/* today's agenda as cards */}
      {mineCount > 0 ? (
        <>
          <SectionLabel text={solo ? t('home.needsYou') : t('home.forYou')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + 10}
            decelerationRate="fast"
            style={{ marginHorizontal: -sp.lg }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, gap: 10 }}
          >
            {shownOcc.map((o, i) => {
              const ev = o.event
              const time = ev.all_day ? t('home.allDay') : ev.start_time ? formatTime(ev.start_time, locale) : ''
              const cls = classifyAgenda(ev, data.pets, memberNames)
              const pet = cls.petId ? petById[cls.petId] : undefined
              const special = cls.kind === 'birthday' || cls.kind === 'anniversary'
              // Whose card: the pet it names; for a birthday the person it names
              // (else its owner); otherwise the member the event belongs to.
              const faceEmail = pet ? null : special ? (cls.memberEmail ?? ev.owner_email) : ev.owner_email
              const face = pet ? petFace(pet) : faceEmail ? memberFace(faceEmail) : null
              // "turns N": from the event's own start year, else the person's /
              // pet's birthday on file.
              let years = special ? yearsAt(ev, o.start) : 0
              if (cls.kind === 'birthday' && years <= 0) {
                years = pet ? yearsFrom(pet.birthday, o.start) : faceEmail ? yearsFrom(memberMeta[faceEmail]?.birthday, o.start) : 0
              }
              const sub =
                cls.kind === 'birthday' && years > 0
                  ? t('home.turns', { n: years })
                  : cls.kind === 'anniversary' && years > 0
                    ? t('home.years', { n: years })
                    : (ev.location ?? '')
              const kindLabel = t(`home.kind.${cls.kind}` as TKey)
              const who = face ? face.name.trim().split(/\s+/)[0] : ''
              const timeLabel = live(ev) ? `${t('home.now')} · ${time}` : time
              return (
                <AgendaCard
                  key={`${ev.id}:${o.start}`}
                  index={i}
                  colors={AGENDA_GRADIENT[cls.kind]}
                  icon={cls.icon}
                  label={who ? t('home.kindWho', { kind: kindLabel, name: who }) : kindLabel}
                  time={timeLabel}
                  title={ev.title}
                  sub={sub}
                  face={face}
                  ended={ended(ev) ? t('home.ended') : undefined}
                  onPress={() => router.push('/calendar')}
                />
              )
            })}
            {shownPet.map((e, i) => {
              const pet = petById[e.pet_id]
              const isOverdue = (e.next_due ?? '') < today
              return (
                <AgendaCard
                  key={e.id}
                  index={shownOcc.length + i}
                  colors={AGENDA_GRADIENT.pet}
                  icon={petTypeIcon(e.type)}
                  label={pet ? t('home.kindWho', { kind: t('home.kind.pet'), name: pet.name }) : t('home.kind.pet')}
                  time={isOverdue ? t('home.overdue') : t('home.dueToday')}
                  title={e.title}
                  sub=""
                  face={pet ? petFace(pet) : null}
                  onPress={() => router.push('/pets')}
                />
              )
            })}
            {overflow > 0 ? (
              <Pressable
                onPress={() => router.push('/calendar')}
                style={{
                  width: 110,
                  height: CARD_H,
                  borderRadius: 24,
                  backgroundColor: c.card,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt style={{ fontFamily: fonts.display, fontSize: 22 }}>{t('home.moreItems', { n: overflow })}</Txt>
              </Pressable>
            ) : null}
          </ScrollView>
        </>
      ) : null}

      {/* everyone else's day — one row per person / pet */}
      {family.lanes.length || family.pets.length ? (
        <View style={{ marginTop: mineCount > 0 ? sp.lg : sp.xl }}>
          <FamilyToday
            lanes={family.lanes}
            summary={familySummary}
            span={family.span}
            nowMin={Number(nowHM.slice(0, 2)) * 60 + Number(nowHM.slice(3, 5))}
            nowLine={family.nowLine}
            nextLine={family.nextLine}
            pets={family.pets}
            onOpenDay={() => router.push({ pathname: '/calendar', params: { date: today, family: '1' } })}
            onOpenPets={() => router.push('/pets')}
          />
        </View>
      ) : null}

      {pickingCity ? (
        <CityPickerSheet
          onClose={() => setPickingCity(false)}
          onSaved={() => {
            setPickingCity(false)
            void reloadWeather()
          }}
        />
      ) : null}
    </>
  )
}

/** Small uppercase label above a Home section. */
export function SectionLabel({ text }: { text: string }) {
  const { c } = useTheme()
  return (
    <Txt
      style={{
        fontFamily: fonts.semibold,
        fontSize: 12,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: c.textMuted,
        marginTop: sp.xl,
        marginBottom: sp.md,
      }}
    >
      {text}
    </Txt>
  )
}
