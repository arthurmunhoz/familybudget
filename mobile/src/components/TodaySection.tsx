// The Hub's "Today" section — sits between the greeting and the app grid. Shows
// the date + current weather (from the home city set in Settings, via
// lib/weather), then a compact agenda: today's calendar events (birthdays and
// anniversaries highlighted with their marker + "turns N"/"N years") and any
// pet-care items due today or overdue. Tapping a row opens the relevant app.
// Reloads on focus so it reflects new events / a changed home city.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
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

import { Card, Txt } from './ui'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/format'
import {
  KIND_EMOJI,
  compareOccurrences,
  formatTime,
  occurrencesByDay,
  yearsAt,
} from '../lib/calendar'
import { overdueEvents } from '../lib/petCare'
import { TYPE_ICON } from '../apps/pets/petUi'
import type { CalendarEvent, PetEvent } from '../lib/types'
import { useHomeWeather, weatherIcon, type WeatherAlertKind } from '../lib/weather'
import { syncTodayWidget, type TodayWidgetItem } from '../lib/widget'
import type { TKey } from '../lib/i18n'
import { fonts, radius, sp, useTheme } from '../theme/theme'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es', pt: 'pt-BR' }
const MAX_ROWS = 5

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

// A subtly-pulsing placeholder that holds the weather/alert area while the
// forecast loads, so the card doesn't jump when the value lands.
function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  const o = useRef(new Animated.Value(0.5)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [o])
  return <Animated.View style={[{ backgroundColor: c.surface2, borderRadius: 6, opacity: o }, style]} />
}

// Matches the top-right weather block (icon + temp, then the city line).
function WeatherSkeleton() {
  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Shimmer style={{ width: 20, height: 20, borderRadius: 10 }} />
        <Shimmer style={{ width: 34, height: 15 }} />
      </View>
      <Shimmer style={{ width: 52, height: 10 }} />
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
      <Shimmer style={{ width: 18, height: 18, borderRadius: 9 }} />
      <View style={{ flex: 1 }}>
        <Shimmer style={{ width: '70%', height: 11 }} />
      </View>
    </View>
  )
}

export default function TodaySection() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const locale = LOCALE[lang] ?? 'en-US'
  const today = todayISO()

  const unit = lang === 'en' ? 'fahrenheit' : 'celsius'
  const {
    location,
    weather,
    alert: weatherAlert,
    loading: weatherLoading,
    reload: reloadWeather,
  } = useHomeWeather(unit)

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
  // Fill the agenda from calendar first, then pet-care, up to MAX_ROWS.
  const shownOcc = todaysOcc.slice(0, MAX_ROWS)
  const shownPet = petDue.slice(0, Math.max(0, MAX_ROWS - shownOcc.length))
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

  useEffect(() => {
    const [y, m, d] = today.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    syncTodayWidget({
      todayLabel: t('home.today'),
      dateLong: dt.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
      dateShort: dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }),
      temp: weather?.temperature ?? null,
      unit: weather?.unit ?? null,
      code: weather?.code ?? null,
      city: cityShort || null,
      items: widgetItems,
      emptyLabel: t('home.nothingToday'),
    })
  }, [widgetItems, weather, cityShort, locale, t, today])

  return (
    <Card style={{ gap: sp.md, marginBottom: sp.lg }}>
      {/* date + weather */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label">{t('home.today')}</Txt>
          <Txt style={{ fontFamily: fonts.display, fontSize: 18 }} numberOfLines={1}>
            {dateLabel}
          </Txt>
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/settings', params: { highlight: 'weather' } })}
          hitSlop={6}
          accessibilityRole="button"
          style={{ alignItems: 'flex-end', gap: 1 }}
        >
          {weather && WIcon ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <WIcon size={22} color={c.accent} />
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>
                  {weather.temperature}
                  {weather.unit}
                </Txt>
              </View>
              {cityShort ? (
                <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
                  {t('home.inCity', { city: cityShort })}
                </Txt>
              ) : null}
            </>
          ) : weatherLoading ? (
            <WeatherSkeleton />
          ) : (
            <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13 }}>
              {location ? '—' : t('home.setCity')}
            </Txt>
          )}
        </Pressable>
      </View>

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
          }}
        >
          <AlertIcon size={18} color={c.accent} />
          <Txt style={{ flex: 1, fontSize: 13, color: c.text }}>{t(alertMeta.key)}</Txt>
        </View>
      ) : weatherLoading ? (
        <AlertSkeleton />
      ) : null}

      {/* agenda */}
      {totalItems === 0 ? (
        <Txt variant="faint">{t('home.nothingToday')}</Txt>
      ) : (
        <View style={{ gap: sp.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md }}>
          {shownOcc.map((o) => {
            const ev = o.event
            const emoji = KIND_EMOJI[ev.kind]
            const time = ev.all_day ? null : ev.start_time ? formatTime(ev.start_time, locale) : null
            const years = ev.kind === 'birthday' || ev.kind === 'anniversary' ? yearsAt(ev, o.start) : 0
            const suffix =
              ev.kind === 'birthday' && years > 0
                ? t('home.turns', { n: years })
                : ev.kind === 'anniversary' && years > 0
                  ? t('home.years', { n: years })
                  : null
            return (
              <Pressable
                key={`${ev.id}:${o.start}`}
                onPress={() => router.push('/calendar')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
              >
                <Txt style={{ width: 22, textAlign: 'center', fontSize: emoji ? 15 : 8, color: c.accent }}>
                  {emoji || '●'}
                </Txt>
                <Txt style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {ev.title}
                  {suffix ? <Txt variant="muted"> · {suffix}</Txt> : null}
                </Txt>
                {time ? <Txt variant="faint">{time}</Txt> : null}
              </Pressable>
            )
          })}

          {shownPet.map((e) => {
            const Icon = TYPE_ICON[e.type]
            const pet = petById[e.pet_id]
            const isOverdue = (e.next_due ?? '') < today
            return (
              <Pressable
                key={e.id}
                onPress={() => router.push('/pets')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
              >
                <View style={{ width: 22, alignItems: 'center' }}>
                  <Icon size={16} color={c.textMuted} />
                </View>
                <Txt style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                  {pet?.emoji ? `${pet.emoji} ` : ''}
                  {e.title}
                </Txt>
                <View
                  style={{
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    backgroundColor: isOverdue ? c.expense : c.surface,
                  }}
                >
                  <Txt
                    style={{
                      fontSize: 11,
                      fontFamily: fonts.semibold,
                      color: isOverdue ? '#ffffff' : c.textMuted,
                    }}
                  >
                    {isOverdue ? t('home.overdue') : t('home.dueToday')}
                  </Txt>
                </View>
              </Pressable>
            )
          })}

          {overflow > 0 ? (
            <Pressable onPress={() => router.push('/calendar')}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13 }}>
                {t('home.moreItems', { n: overflow })}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}
    </Card>
  )
}
