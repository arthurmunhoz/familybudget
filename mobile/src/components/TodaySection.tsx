// The top of the Hub (2026-11 "Comando" redesign): the date + weather line
// (home city from Settings, via lib/weather), a big greeting that says how many
// things today holds, the "ask anything" bar (lib/assistant, AskSheet), any
// weather alert, and today's agenda as a row of swipeable cards — calendar
// events (birthdays/anniversaries with "turns N"/"N years") and pet care due
// today or overdue. Tapping a card opens its app. Also owns the Today WIDGET
// sync (syncTodayConfig/syncTodayWidget below), so it must stay mounted on the
// Hub. Reloads on focus so it reflects new events / a changed home city.
import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import {
  Cake,
  CalendarDays,
  ChevronRight,
  PawPrint,
  Sparkles,
  Mic,
  CloudLightning,
  CloudRain,
  CloudSnow,
  ThermometerSnowflake,
  ThermometerSun,
  Wind,
  type LucideIcon,
} from 'lucide-react-native'

import { Txt } from './ui'
import { voiceSupported } from '../lib/voice'
import { CARD_GRADIENT } from './home/palette'
import { GradientBox } from './home/GradientBox'
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
  occurrencesByDay,
  yearsAt,
} from '../lib/calendar'
import { overdueEvents } from '../lib/petCare'
import type { CalendarEvent, PetEvent } from '../lib/types'
import { useHomeWeather, weatherIcon, type WeatherAlertKind } from '../lib/weather'
import { syncTodayConfig, syncTodayWidget, type TodayWidgetItem } from '../lib/widget'
import type { TKey } from '../lib/i18n'
import { fonts, radius, sp, useTheme } from '../theme/theme'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const MAX_CARDS = 8
const CARD_W = 236

// Home-screen weather alert: an on-brand Lucide icon + localized message per kind.
const WEATHER_ALERT: Record<WeatherAlertKind, { icon: LucideIcon; key: TKey }> = {
  thunder: { icon: CloudLightning, key: 'home.weatherThunder' },
  snow: { icon: CloudSnow, key: 'home.weatherSnow' },
  heat: { icon: ThermometerSun, key: 'home.weatherHeat' },
  cold: { icon: ThermometerSnowflake, key: 'home.weatherCold' },
  wind: { icon: Wind, key: 'home.weatherWind' },
  rain: { icon: CloudRain, key: 'home.weatherRain' },
}

type PetLite = { id: string; name: string; emoji: string }

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
function AlertSkeleton() {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.sm,
        backgroundColor: c.accentSoft,
        borderRadius: radius.md,
        paddingHorizontal: sp.md,
        paddingVertical: sp.sm,
      }}
    >
      <Skeleton style={{ width: 18, height: 18, borderRadius: 9 }} />
      <View style={{ flex: 1 }}>
        <Skeleton style={{ width: '70%', height: 11 }} />
      </View>
    </View>
  )
}

export default function TodaySection({
  name,
  household,
  onAsk,
  right,
}: {
  /** First name for the greeting. */
  name: string
  household: string | null
  /** Open the ask sheet; `listen` = straight into voice (the mic). */
  onAsk: (listen?: boolean) => void
  /** Header slot on the right (the Settings button). */
  right?: ReactNode
}) {
  const { c } = useTheme()
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

  type TodayData = { events: CalendarEvent[]; petEvents: PetEvent[]; pets: PetLite[] }
  const { data = { events: [], petEvents: [], pets: [] }, revalidate } =
    useCachedQuery<TodayData>('hub:today', async () => {
      const [ev, pe, pt] = await Promise.all([
        supabase.from('calendar_events').select('*'),
        supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
        supabase.from('pets').select('id, name, emoji'),
      ])
      return {
        events: (ev.data ?? []) as CalendarEvent[],
        petEvents: (pe.data ?? []) as PetEvent[],
        pets: (pt.data ?? []) as PetLite[],
      }
    })

  // Keep it fresh when returning to the Hub (e.g. after adding an event or
  // setting the home city in Settings).
  useFocusEffect(
    useCallback(() => {
      void reloadWeather()
      void revalidate()
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
  // Cards: calendar first (in time order), then pet care, up to MAX_CARDS.
  const shownOcc = todaysOcc.slice(0, MAX_CARDS)
  const shownPet = petDue.slice(0, Math.max(0, MAX_CARDS - shownOcc.length))
  const overflow = totalItems - (shownOcc.length + shownPet.length)

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

      {/* ask anything */}
      <Pressable
        onPress={() => onAsk(false)}
        accessibilityRole="button"
        accessibilityLabel={t('ask.title')}
        style={({ pressed }) => ({
          marginTop: sp.lg,
          height: 58,
          borderRadius: 20,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.border,
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.md,
          paddingLeft: sp.lg,
          paddingRight: 8,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Sparkles size={20} color={c.accent} />
        <Txt style={{ flex: 1, fontSize: 15, color: c.textFaint }} numberOfLines={1}>
          {t('ask.placeholder')}
        </Txt>
        {/* The mic: straight into listening. Without the voice module (an
            older build) it's the plain "open" chevron. */}
        <Pressable
          onPress={() => onAsk(voiceSupported())}
          accessibilityRole="button"
          accessibilityLabel={voiceSupported() ? t('ask.speak') : t('ask.title')}
          hitSlop={6}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: c.action,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {voiceSupported() ? (
            <Mic size={21} color={c.onAction} strokeWidth={2.3} />
          ) : (
            <ChevronRight size={22} color={c.onAction} strokeWidth={2.4} />
          )}
        </Pressable>
      </Pressable>

      {/* today's weather alert (rain / storm / extreme temp / wind) */}
      {alertMeta && AlertIcon ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.sm,
            backgroundColor: c.accentSoft,
            borderRadius: radius.md,
            paddingHorizontal: sp.md,
            paddingVertical: sp.sm,
            marginTop: sp.md,
          }}
        >
          <AlertIcon size={18} color={c.accent} />
          <Txt style={{ flex: 1, fontSize: 13, color: c.text }}>{t(alertMeta.key)}</Txt>
        </View>
      ) : weatherLoading ? (
        <View style={{ marginTop: sp.md }}>
          <AlertSkeleton />
        </View>
      ) : null}

      {/* today's agenda as cards */}
      {totalItems > 0 ? (
        <>
          <SectionLabel text={t('home.needsYou')} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={CARD_W + 10}
            decelerationRate="fast"
            style={{ marginHorizontal: -sp.lg }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, gap: 10 }}
          >
            {shownOcc.map((o) => {
              const ev = o.event
              const time = ev.all_day ? t('home.allDay') : ev.start_time ? formatTime(ev.start_time, locale) : ''
              const years = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
              const sub =
                ev.kind === 'birthday' && years > 0
                  ? t('home.turns', { n: years })
                  : ev.kind === 'anniversary' && years > 0
                    ? t('home.years', { n: years })
                    : (ev.location ?? '')
              const special = ev.kind === 'birthday' || ev.kind === 'anniversary'
              return (
                <AgendaCard
                  key={`${ev.id}:${o.start}`}
                  colors={special ? CARD_GRADIENT.birthday : CARD_GRADIENT.event}
                  icon={special ? <Cake size={15} color="#fff" /> : <CalendarDays size={15} color="#fff" />}
                  label={KIND_EMOJI[ev.kind] ? `${KIND_EMOJI[ev.kind]}` : ''}
                  time={time}
                  title={ev.title}
                  sub={sub}
                  onPress={() => router.push('/calendar')}
                />
              )
            })}
            {shownPet.map((e) => {
              const pet = petById[e.pet_id]
              const isOverdue = (e.next_due ?? '') < today
              return (
                <AgendaCard
                  key={e.id}
                  colors={CARD_GRADIENT.pet}
                  icon={<PawPrint size={15} color="#fff" />}
                  label={pet?.name ?? ''}
                  time={isOverdue ? t('home.overdue') : t('home.dueToday')}
                  title={e.title}
                  sub=""
                  onPress={() => router.push('/pets')}
                />
              )
            })}
            {overflow > 0 ? (
              <Pressable
                onPress={() => router.push('/calendar')}
                style={{
                  width: 110,
                  height: 132,
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

/** One of today's things as a bold gradient card. */
function AgendaCard({
  colors,
  icon,
  label,
  time,
  title,
  sub,
  onPress,
}: {
  colors: readonly [string, string]
  icon: ReactNode
  label: string
  time: string
  title: string
  sub: string
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <GradientBox colors={colors} radius={24} style={{ width: CARD_W, height: 132, padding: 16, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon}
          <Txt style={{ flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontFamily: fonts.semibold }} numberOfLines={1}>
            {label}
          </Txt>
          <Txt style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}>
            {time}
          </Txt>
        </View>
        <View>
          <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 19, lineHeight: 23 }} numberOfLines={2}>
            {title}
          </Txt>
          {sub ? (
            <Txt style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }} numberOfLines={1}>
              {sub}
            </Txt>
          ) : null}
        </View>
      </GradientBox>
    </Pressable>
  )
}
