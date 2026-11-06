// Shared Calendar — RN port of the PWA's Calendar. A Month / Upcoming toggle:
// Month is a 7-column grid (color dots per day) + the selected day's agenda;
// Upcoming is the "what's coming up" countdown list. Recurrence is expanded via
// occurrencesByDay / upcomingOccurrences; events are colored by member. Special
// kinds (birthday/anniversary/renewal/other) show an emoji marker and a
// "turns N" age. Tapping an event opens the add/edit form. The Google button in
// the header opens the Google Calendar sync screen (src/app/google-calendar.tsx,
// in-app OAuth via @/lib/googleCalendar, reusing the deployed /api/google-calendar-*
// endpoints). Google-sourced rows (source='google') render read-only; pulled
// events arrive via the calendar_events Realtime subscription.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { APP_GRADIENT } from '@/components/home/palette'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from 'lucide-react-native'

import { Loader, NewItemButton, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useToday } from '@/hooks/useToday'
import { daysBetweenISO } from '@/lib/format'
import {
  compareOccurrences,
  eventColor,
  formatTime,
  KIND_EMOJI,
  occurrencesByDay,
  upcomingOccurrences,
  yearsAt,
  type Occurrence,
} from '@/lib/calendar'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import { channelName } from '@/lib/realtime'
import type { CalendarEvent } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { getGoogleConnection } from '@/lib/googleCalendar'
import { getAppleConnection, isAppleCalendarAvailable, syncAppleCalendar } from '@/lib/appleCalendar'
import EventForm, { type EventDraft } from './EventForm'
import { GoogleIcon } from './GoogleIcon'
import { AppleIcon } from './AppleIcon'

// App language → BCP-47 locale for Intl date/time formatting.
const LOCALES: Record<string, string> = { en: 'en', es: 'es', pt: 'pt-BR' }

const pad = (n: number) => String(n).padStart(2, '0')

function emptyDraft(start: string, owner: string | null): EventDraft {
  return {
    title: '',
    allDay: true,
    start,
    end: start,
    startTime: '09:00',
    endTime: '10:00',
    owner,
    kind: 'event',
    repeat: 'none',
    remind: false,
    location: '',
    notes: '',
  }
}

export default function Calendar() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const locale = LOCALES[lang] ?? 'en'
  // Drives the "today" ring in the grid and the cut-off for Upcoming — both
  // silently wrong if the date is captured once at render and the app then
  // sits open (or suspended) across midnight. See useToday.
  const today = useToday()
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  const ownerName = (email: string) =>
    profiles.find((p) => p.email === email)?.display_name ?? email

  const {
    data: events = [],
    loading,
    revalidate: load,
  } = useCachedQuery<CalendarEvent[]>('calendar', async () => {
    const { data } = await supabase.from('calendar_events').select('*')
    return (data ?? []) as CalendarEvent[]
  })

  useEffect(() => {
    // Realtime: refetch when any household row changes (RLS scopes the stream).
    const channel = supabase
      .channel(channelName('calendar_events'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Colors the header Google button: full-color when a Google account is linked,
  // grey otherwise. Re-checked on focus so it updates after connect/disconnect.
  const [googleConnected, setGoogleConnected] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let active = true
      getGoogleConnection().then((v) => {
        if (active) setGoogleConnected(!!v)
      })
      return () => {
        active = false
      }
    }, []),
  )

  // Apple Calendar is on-device (EventKit). Color the header button, and when
  // linked, sync on open so pulled device events stay fresh, then refresh.
  const [appleConnected, setAppleConnected] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let active = true
      getAppleConnection().then((v) => {
        if (!active) return
        setAppleConnected(!!v)
        if (v) {
          syncAppleCalendar()
            .then(() => {
              if (active) load()
            })
            .catch(() => {})
        }
      })
      return () => {
        active = false
      }
    }, [load]),
  )

  const [selected, setSelected] = useState(today)
  const [mode, setMode] = useState<'month' | 'upcoming'>('month')
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { y, m } // m is 1-indexed
  })

  // Occurrences for the visible month (recurrence expanded + multi-day spread).
  const monthStart = `${view.y}-${pad(view.m)}-01`
  const monthEnd = `${view.y}-${pad(view.m)}-${pad(new Date(view.y, view.m, 0).getDate())}`
  const byDay = useMemo(
    () => occurrencesByDay(events, monthStart, monthEnd),
    [events, monthStart, monthEnd],
  )

  // The selected day's agenda (computed independently so it works even when the
  // selected day sits outside the month currently in view).
  const dayOccs: Occurrence[] = useMemo(() => {
    const m = occurrencesByDay(events, selected, selected)
    return (m.get(selected) ?? []).sort(compareOccurrences)
  }, [events, selected])

  // The next occurrence of each event, soonest first.
  const upcoming = useMemo(() => upcomingOccurrences(events, today), [events, today])

  // --- add / edit form ---
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(() => emptyDraft(today, null))

  function openNew() {
    setEditing(null)
    setDraft(emptyDraft(selected, profile?.email ?? null))
    setShowForm(true)
  }

  function openEdit(ev: CalendarEvent) {
    // Externally-sourced rows (Google / Apple device calendar) are read-only —
    // surface them but don't open the editor.
    if (ev.source !== 'oneroof') return
    setEditing(ev)
    setDraft({
      title: ev.title,
      allDay: ev.all_day,
      start: ev.start_date,
      end: ev.end_date,
      startTime: ev.start_time?.slice(0, 5) ?? '09:00',
      endTime: ev.end_time?.slice(0, 5) ?? '10:00',
      owner: ev.owner_email,
      kind: ev.kind,
      repeat: ev.recurrence,
      remind: ev.reminder_minutes != null,
      location: ev.location ?? '',
      notes: ev.notes ?? '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
  }

  async function remove(ev: CalendarEvent) {
    await supabase.from('calendar_events').delete().eq('id', ev.id)
    track('calendar.deleted', { title: ev.title })
    load()
  }

  // --- month grid scaffolding ---
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    // 2023-01-01 is a Sunday → label columns Sun…Sat.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)))
  }, [locale])
  const firstDow = new Date(view.y, view.m - 1, 1).getDay()
  const dim = new Date(view.y, view.m, 0).getDate()
  // First letter only: textTransform 'capitalize' upper-cased EVERY word,
  // giving "Novembro De 2026" in Portuguese/Spanish.
  const monthText = new Date(view.y, view.m - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
  const monthLabel = monthText.charAt(0).toUpperCase() + monthText.slice(1)
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: dim }, (_, i) => i + 1),
  ]

  function shift(delta: number) {
    setView((v) => {
      let m = v.m + delta
      let y = v.y
      if (m < 1) {
        m = 12
        y--
      } else if (m > 12) {
        m = 1
        y++
      }
      return { y, m }
    })
  }

  function goToday() {
    const [y, m] = today.split('-').map(Number)
    setView({ y, m })
    setSelected(today)
  }

  const selectedLabel = (() => {
    const [y, m, d] = selected.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  })()

  function timeLabel(ev: CalendarEvent): string {
    if (ev.all_day) return t('calendar.allDay')
    const start = ev.start_time ? formatTime(ev.start_time, locale) : ''
    const end = ev.end_time ? ` – ${formatTime(ev.end_time, locale)}` : ''
    return `${start}${end}`
  }

  function countdownLabel(days: number): string {
    if (days <= 0) return t('calendar.dueToday')
    if (days === 1) return t('calendar.tomorrow')
    if (days <= 45) return t('calendar.inDays', { days })
    return t('calendar.inMonths', { months: Math.round(days / 30) })
  }

  const red = APP_GRADIENT.calendar as [string, string]
  const tint = red[1]
  // the faded state line under the title: how the next week looks
  const soonCount = upcoming.filter((o) => daysBetweenISO(today, o.start) <= 7).length
  const stateLine =
    soonCount === 0 ? t('calendar.stateNone') : soonCount === 1 ? t('calendar.stateOne') : t('calendar.stateMany', { n: soonCount })

  const roundBtn = {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    backgroundColor: c.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {/* Home-style top bar: round back; Google / Apple sync as round buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <ChevronLeft size={22} color={c.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.push('/google-calendar')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('calendar.google')}
          style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <GoogleIcon size={18} color={googleConnected ? undefined : c.textFaint} />
        </Pressable>
        {isAppleCalendarAvailable ? (
          <Pressable
            onPress={() => router.push('/apple-calendar')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('calendar.apple')}
            style={({ pressed }) => [roundBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <AppleIcon size={17} color={appleConnected ? c.text : c.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <Loader />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
          keyboardShouldPersistTaps="handled"
        >
          {/* big title, state faded under it — the Home's voice */}
          <View>
            <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
              {t('calendar.title')}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>{stateLine}</Txt>
          </View>

          {/* Month / Upcoming */}
          <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: radius.pill, padding: 4, gap: 4 }}>
            {(['month', 'upcoming'] as const).map((m) => {
              const active = mode === m
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 9,
                    borderRadius: radius.pill,
                    backgroundColor: active ? c.card : 'transparent',
                    ...(active ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 } : {}),
                  }}
                >
                  <Txt style={{ color: active ? c.text : c.textMuted, fontFamily: fonts.semibold, fontSize: 14.5 }}>
                    {t(m === 'month' ? 'calendar.tabMonth' : 'calendar.tabUpcoming')}
                  </Txt>
                </Pressable>
              )
            })}
          </View>

          {mode === 'month' ? (
            <>
              {/* month grid */}
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, padding: sp.md }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingBottom: sp.sm }}>
                  <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: c.text, paddingLeft: 4 }}>
                    {monthLabel}
                  </Txt>
                  {view.y !== Number(today.slice(0, 4)) || view.m !== Number(today.slice(5, 7)) || selected !== today ? (
                    <Pressable
                      onPress={goToday}
                      hitSlop={6}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.todayPill, { backgroundColor: tint + '1F', opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: tint }}>{t('calendar.today')}</Txt>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => shift(-1)} hitSlop={8} accessibilityLabel="Previous month" style={[styles.navBtn, { backgroundColor: c.surface }]}>
                    <ChevronLeft size={18} color={c.text} />
                  </Pressable>
                  <Pressable onPress={() => shift(1)} hitSlop={8} accessibilityLabel="Next month" style={[styles.navBtn, { backgroundColor: c.surface }]}>
                    <ChevronRight size={18} color={c.text} />
                  </Pressable>
                </View>

                {/* weekday header */}
                <View style={{ flexDirection: 'row' }}>
                  {weekdays.map((w, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 6 }}>
                      <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.textFaint }}>{w}</Txt>
                    </View>
                  ))}
                </View>

                {/* day cells, 7 per row */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {cells.map((day, i) => {
                    if (day === null) {
                      return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 48 }} />
                    }
                    const dateStr = `${view.y}-${pad(view.m)}-${pad(day)}`
                    const occs = byDay.get(dateStr)
                    const isToday = dateStr === today
                    const isSelected = dateStr === selected
                    return (
                      <Pressable
                        key={day}
                        onPress={() => setSelected(dateStr)}
                        accessibilityLabel={dateStr}
                        style={{ width: `${100 / 7}%`, height: 48, alignItems: 'center' }}
                      >
                        {isSelected ? (
                          <GradientBox colors={red} radius={17} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                            <Txt style={{ fontSize: 14.5, color: '#fff', fontFamily: fonts.semibold }}>{day}</Txt>
                          </GradientBox>
                        ) : (
                          <View
                            style={{
                              height: 34,
                              width: 34,
                              borderRadius: 17,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: isToday ? tint + '1F' : 'transparent',
                            }}
                          >
                            <Txt style={{ fontSize: 14.5, color: isToday ? tint : c.text, fontFamily: isToday ? fonts.semibold : fonts.body }}>
                              {day}
                            </Txt>
                          </View>
                        )}
                        <View style={{ flexDirection: 'row', gap: 2, marginTop: 3, height: 5 }}>
                          {occs?.slice(0, 3).map((o, j) => (
                            <View key={j} style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: eventColor(o.event, memberEmails) }} />
                          ))}
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              {/* selected-day agenda: one card of rows */}
              <Txt style={[styles.section, { color: c.textMuted }]}>{selectedLabel}</Txt>
              {dayOccs.length === 0 ? (
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, alignItems: 'center', gap: 4, paddingVertical: sp.xl }]}>
                  <CalendarDays size={24} color={c.textFaint} />
                  <Txt style={{ fontFamily: fonts.display, fontSize: 17, color: c.text, marginTop: 4 }}>{t('calendar.empty')}</Txt>
                  <Txt variant="faint">{t('calendar.emptyHint')}</Txt>
                </View>
              ) : (
                <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
                  {dayOccs.map((o, i) => (
                    <EventRow
                      key={`${o.event.id}:${o.start}`}
                      first={i === 0}
                      color={eventColor(o.event, memberEmails)}
                      emoji={KIND_EMOJI[o.event.kind]}
                      time={o.event.all_day ? null : o.event.start_time ? formatTime(o.event.start_time, locale) : null}
                      allDayLabel={t('calendar.allDay')}
                      title={o.event.title}
                      subtitle={o.event.owner_email ? ownerName(o.event.owner_email) : t('calendar.everyone')}
                      location={o.event.location}
                      onPress={() => openEdit(o.event)}
                    />
                  ))}
                </View>
              )}
            </>
          ) : upcoming.length === 0 ? (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, alignItems: 'center', gap: 4, paddingVertical: sp.xl }]}>
              <CalendarDays size={24} color={c.textFaint} />
              <Txt style={{ fontFamily: fonts.display, fontSize: 17, color: c.text, marginTop: 4 }}>{t('calendar.upcomingEmpty')}</Txt>
              <Txt variant="faint">{t('calendar.emptyHint')}</Txt>
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {upcoming.map((o, i) => {
                const days = daysBetweenISO(today, o.start)
                const age =
                  o.event.kind === 'birthday' || o.event.kind === 'anniversary' ? yearsAt(o.event, o.start) : 0
                const subtitle = [
                  new Date(Number(o.start.slice(0, 4)), Number(o.start.slice(5, 7)) - 1, Number(o.start.slice(8, 10))).toLocaleDateString(locale, { weekday: 'long' }),
                  age > 0 ? t('calendar.turns', { years: age }) : !o.event.all_day ? timeLabel(o.event) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <EventRow
                    key={`${o.event.id}:${o.start}`}
                    first={i === 0}
                    color={eventColor(o.event, memberEmails)}
                    title={`${KIND_EMOJI[o.event.kind] ? `${KIND_EMOJI[o.event.kind]} ` : ''}${o.event.title}`}
                    subtitle={subtitle}
                    countdown={countdownLabel(days)}
                    soon={days <= 14}
                    tint={tint}
                    dateTile={{
                      month: new Date(Number(o.start.slice(0, 4)), Number(o.start.slice(5, 7)) - 1, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', ''),
                      day: Number(o.start.slice(8, 10)),
                    }}
                    onPress={() => {
                      setMode('month')
                      setView({ y: Number(o.start.slice(0, 4)), m: Number(o.start.slice(5, 7)) })
                      setSelected(o.start)
                      openEdit(o.event)
                    }}
                  />
                )
              })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Bottom action in NORMAL flow — the branch above is flex:1, so this
          stays pinned to the bottom and the list ends AT it, never under it. */}
      <NewItemButton label={t('calendar.addBtn')} onPress={openNew} colors={APP_GRADIENT.calendar} />

      {showForm && (
        <EventForm
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          profiles={profiles}
          memberEmails={memberEmails}
          locale={locale}
          onClose={closeForm}
          onSaved={(savedStart) => {
            setSelected(savedStart)
            closeForm()
            load()
          }}
          onDelete={remove}
        />
      )}
    </SafeAreaView>
  )
}

/** One event as a row of the day's (or Upcoming's) card: the time (or the
 *  kind's emoji) in a tile tinted with the owner's colour, the title, who /
 *  when, the place, and — in Upcoming — a countdown pill. */
function EventRow({
  first,
  color,
  emoji,
  time,
  allDayLabel,
  title,
  subtitle,
  location,
  countdown,
  soon,
  tint,
  dateTile,
  onPress,
}: {
  /** Upcoming: a tear-off calendar page (month + day) instead of the time. */
  dateTile?: { month: string; day: number }
  first: boolean
  color: string
  emoji?: string
  /** "5:00 PM" for a timed event on the day view; null = all day. */
  time?: string | null
  allDayLabel?: string
  title: string
  subtitle: string
  location?: string | null
  countdown?: string
  soon?: boolean
  tint?: string
  onPress: () => void
}) {
  const { c, dark } = useTheme()
  const [hm, ampm] = time ? time.split(/\s/u) : [null, null]
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        paddingHorizontal: sp.md,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 52, minHeight: 48, borderRadius: 14, backgroundColor: color + (dark ? '33' : '1F'), alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
        {dateTile ? (
          <>
            <Txt style={{ fontSize: 10.5, fontFamily: fonts.semibold, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {dateTile.month}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 23, color: c.text }}>{dateTile.day}</Txt>
          </>
        ) : emoji ? (
          <Txt style={{ fontSize: 22 }}>{emoji}</Txt>
        ) : time !== undefined ? (
          time ? (
            <>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color }}>{hm}</Txt>
              {ampm ? <Txt style={{ fontSize: 10, fontFamily: fonts.semibold, color }}>{ampm}</Txt> : null}
            </>
          ) : (
            <Txt style={{ fontSize: 10.5, fontFamily: fonts.semibold, color, textAlign: 'center' }} numberOfLines={2}>
              {allDayLabel}
            </Txt>
          )
        ) : (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 16.5, lineHeight: 21, color: c.text }} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="faint" style={{ fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
        {location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <MapPin size={12} color={c.textMuted} />
            <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
              {location}
            </Txt>
          </View>
        ) : null}
      </View>
      {countdown ? (
        <View style={{ borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: soon ? tint : c.surface }}>
          <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: soon ? '#fff' : c.textMuted }}>{countdown}</Txt>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginTop: sp.xs, paddingHorizontal: 2 },
  todayPill: { paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center' },
  navBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
})
