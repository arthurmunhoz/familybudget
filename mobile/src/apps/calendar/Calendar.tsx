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
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react-native'

import { AppHeader, Btn, Card, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { daysBetweenISO, todayISO } from '@/lib/format'
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
import type { CalendarEvent } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
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
  const today = todayISO()
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
      .channel('calendar_events')
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
  const monthLabel = new Date(view.y, view.m - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  })
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

  function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={t('calendar.title')}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <Pressable
                onPress={goToday}
                hitSlop={8}
                accessibilityRole="button"
                style={{
                  backgroundColor: c.surface,
                  borderRadius: radius.pill,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <Txt variant="label">{t('calendar.today')}</Txt>
              </Pressable>
              <Pressable
                onPress={() => router.push('/google-calendar')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('calendar.google')}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GoogleIcon size={18} color={googleConnected ? undefined : c.textFaint} />
              </Pressable>
              {isAppleCalendarAvailable ? (
                <Pressable
                  onPress={() => router.push('/apple-calendar')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('calendar.apple')}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: c.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AppleIcon size={17} color={appleConnected ? c.text : c.textFaint} />
                </Pressable>
              ) : null}
            </View>
          }
        />
      </View>

      {loading ? (
        <Loader />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 120, gap: sp.md }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Month / Upcoming toggle */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: c.surface,
              borderRadius: radius.pill,
              padding: 4,
              gap: 4,
            }}
          >
            {(['month', 'upcoming'] as const).map((m) => {
              const active = mode === m
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 8,
                    borderRadius: radius.pill,
                    backgroundColor: active ? c.accent : 'transparent',
                  }}
                >
                  <Txt
                    style={{
                      color: active ? '#fff' : c.textMuted,
                      fontWeight: '600',
                    }}
                  >
                    {t(m === 'month' ? 'calendar.tabMonth' : 'calendar.tabUpcoming')}
                  </Txt>
                </Pressable>
              )
            })}
          </View>

          {mode === 'month' ? (
            <>
              {/* month grid */}
              <Card style={{ padding: sp.md }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: sp.sm,
                  }}
                >
                  <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityLabel="Previous month">
                    <ChevronLeft size={22} color={c.textMuted} />
                  </Pressable>
                  <Txt variant="h2" style={{ textTransform: 'capitalize' }}>
                    {monthLabel}
                  </Txt>
                  <Pressable onPress={() => shift(1)} hitSlop={10} accessibilityLabel="Next month">
                    <ChevronRight size={22} color={c.textMuted} />
                  </Pressable>
                </View>

                {/* weekday header */}
                <View style={{ flexDirection: 'row' }}>
                  {weekdays.map((w, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 4 }}>
                      <Txt variant="faint" style={{ fontSize: 11, fontWeight: '600' }}>
                        {w}
                      </Txt>
                    </View>
                  ))}
                </View>

                {/* day cells, 7 per row */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {cells.map((day, i) => {
                    if (day === null) {
                      return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 46 }} />
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
                        style={{ width: `${100 / 7}%`, height: 46, alignItems: 'center' }}
                      >
                        <View
                          style={{
                            height: 32,
                            width: 32,
                            borderRadius: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isSelected ? c.accent : 'transparent',
                            borderWidth: !isSelected && isToday ? 1 : 0,
                            borderColor: c.accent,
                          }}
                        >
                          <Txt
                            style={{
                              fontSize: 14,
                              color: isSelected ? '#fff' : isToday ? c.accent : c.text,
                              fontWeight: isSelected || isToday ? '700' : '400',
                            }}
                          >
                            {day}
                          </Txt>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 2, marginTop: 2, height: 6 }}>
                          {occs?.slice(0, 3).map((o, j) => (
                            <View
                              key={j}
                              style={{
                                height: 6,
                                width: 6,
                                borderRadius: 3,
                                backgroundColor: eventColor(o.event, memberEmails),
                              }}
                            />
                          ))}
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </Card>

              {/* selected-day agenda */}
              <Txt variant="h2" style={{ textTransform: 'capitalize' }}>
                {selectedLabel}
              </Txt>
              {dayOccs.length === 0 ? (
                <View style={{ alignItems: 'center', gap: 4, paddingVertical: sp.lg }}>
                  <Txt variant="muted">{t('calendar.empty')}</Txt>
                  <Txt variant="faint">{t('calendar.emptyHint')}</Txt>
                </View>
              ) : (
                <View style={{ gap: sp.sm }}>
                  {dayOccs.map((o) => (
                    <EventRow
                      key={`${o.event.id}:${o.start}`}
                      event={o.event}
                      color={eventColor(o.event, memberEmails)}
                      title={`${KIND_EMOJI[o.event.kind] ? `${KIND_EMOJI[o.event.kind]} ` : ''}${o.event.title}`}
                      subtitle={[
                        timeLabel(o.event),
                        o.event.owner_email
                          ? ownerName(o.event.owner_email)
                          : t('calendar.everyone'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      location={o.event.location}
                      onPress={() => openEdit(o.event)}
                    />
                  ))}
                </View>
              )}
            </>
          ) : upcoming.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 4, paddingVertical: sp.lg }}>
              <Txt variant="muted">{t('calendar.upcomingEmpty')}</Txt>
              <Txt variant="faint">{t('calendar.emptyHint')}</Txt>
            </View>
          ) : (
            <View style={{ gap: sp.sm }}>
              {upcoming.map((o) => {
                const days = daysBetweenISO(today, o.start)
                const emoji = KIND_EMOJI[o.event.kind]
                const age =
                  o.event.kind === 'birthday' || o.event.kind === 'anniversary'
                    ? yearsAt(o.event, o.start)
                    : 0
                const subtitle = [
                  shortDate(o.start),
                  age > 0
                    ? t('calendar.turns', { years: age })
                    : !o.event.all_day
                      ? timeLabel(o.event)
                      : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <EventRow
                    key={`${o.event.id}:${o.start}`}
                    event={o.event}
                    color={eventColor(o.event, memberEmails)}
                    title={`${emoji ? `${emoji} ` : ''}${o.event.title}`}
                    subtitle={subtitle}
                    countdown={countdownLabel(days)}
                    soon={days <= 14}
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

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn title={t('calendar.addBtn')} onPress={openNew} />
        </View>
      </SafeAreaView>

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

function EventRow({
  event,
  color,
  title,
  subtitle,
  location,
  countdown,
  soon,
  onPress,
}: {
  event: CalendarEvent
  color: string
  title: string
  subtitle: string
  location?: string | null
  countdown?: string
  soon?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: sp.md,
        backgroundColor: pressed ? c.cardActive : c.card,
        borderRadius: radius.md,
        paddingHorizontal: sp.md,
        paddingVertical: sp.md,
      })}
    >
      <View style={{ width: 5, borderRadius: 3, backgroundColor: color }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="faint" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
        {location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <MapPin size={12} color={c.textMuted} />
            <Txt variant="muted" numberOfLines={1}>
              {location}
            </Txt>
          </View>
        ) : null}
      </View>
      {countdown ? (
        <View
          style={{
            alignSelf: 'center',
            borderRadius: radius.pill,
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: soon ? c.accent : c.surface,
          }}
        >
          <Txt style={{ fontSize: 12, fontWeight: '700', color: soon ? '#fff' : c.textMuted }}>
            {countdown}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  )
}
