// Pet Care — a per-pet view. Top: a horizontal carousel to pick a pet (each in
// its calendar color). Below: the selected pet's info card, with a calendar-color
// swatch picker and an Edit button. Below that: a month calendar showing EVERY
// pet's events as small per-pet colored dots (tap a day to see it), then the
// upcoming reminders sorted by soonest, with a "done again" re-log on overdue.
// The bottom bar adds an event (or the first pet). Pet + event add/edit are
// bottom-sheet modals.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Check, ChevronLeft, ChevronRight, PawPrint, Pencil, Plus } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { addDaysISO, daysBetweenISO, formatDay, todayISO } from '@/lib/format'
import { reminderEvents } from '@/lib/petCare'
import { getSignedUrls } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { ageInMonths, speciesEmoji } from './petMeta'
import { TYPE_ICON } from './petUi'
import { PET_PALETTE, petColorMap } from './petColors'
import PetForm from './PetForm'
import EventForm, { type EventDraft } from './EventForm'

const emptyDraft: EventDraft = {
  pet: '',
  type: 'medication',
  title: '',
  date: todayISO(),
  nextDue: '',
  notes: '',
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function PetCare() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es' : 'pt-BR'
  const today = todayISO()

  const [selectedPet, setSelectedPet] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(today)
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { y, m } // m is 1-indexed
  })
  const [savingColor, setSavingColor] = useState(false)

  const [showPetForm, setShowPetForm] = useState(false)
  const [editingPet, setEditingPet] = useState<Pet | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)

  const {
    data: { pets, events, petPhotoUrls } = { pets: [], events: [], petPhotoUrls: {} },
    loading,
    revalidate: load,
  } = useCachedQuery<{ pets: Pet[]; events: PetEvent[]; petPhotoUrls: Record<string, string> }>(
    'pets',
    async () => {
      const [petsRes, eventsRes] = await Promise.all([
        supabase.from('pets').select('*').order('name'),
        supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
      ])
      const petRows = (petsRes.data ?? []) as Pet[]
      const eventRows = (eventsRes.data ?? []) as PetEvent[]
      const paths = petRows.map((p) => p.photo_path).filter(Boolean) as string[]
      let photoUrls: Record<string, string> = {}
      if (paths.length) {
        const byPath = await getSignedUrls(paths)
        photoUrls = Object.fromEntries(
          petRows
            .filter((p) => p.photo_path && byPath[p.photo_path])
            .map((p) => [p.id, byPath[p.photo_path as string]]),
        )
      }
      return { pets: petRows, events: eventRows, petPhotoUrls: photoUrls }
    },
  )

  // Pets sorted (stable roster order drives the fallback palette colors).
  const petsSorted = useMemo(() => [...pets].sort((a, b) => a.name.localeCompare(b.name)), [pets])
  const colorMap = useMemo(() => petColorMap(petsSorted), [petsSorted])
  const petById = useMemo(() => Object.fromEntries(pets.map((p) => [p.id, p])), [pets])

  // Default the selection to the first pet; reset if it disappears.
  useEffect(() => {
    if (petsSorted.length === 0) {
      if (selectedPet !== null) setSelectedPet(null)
    } else if (!selectedPet || !petsSorted.some((p) => p.id === selectedPet)) {
      setSelectedPet(petsSorted[0].id)
    }
  }, [petsSorted, selectedPet])

  const selPet = pets.find((p) => p.id === selectedPet) ?? null

  // Month grid: events grouped by their date within the visible month.
  const monthStart = `${view.y}-${pad(view.m)}-01`
  const monthEnd = `${view.y}-${pad(view.m)}-${pad(new Date(view.y, view.m, 0).getDate())}`
  const eventsByDay = useMemo(() => {
    const map = new Map<string, PetEvent[]>()
    for (const e of events) {
      if (e.event_date < monthStart || e.event_date > monthEnd) continue
      const arr = map.get(e.event_date)
      if (arr) arr.push(e)
      else map.set(e.event_date, [e])
    }
    return map
  }, [events, monthStart, monthEnd])

  const dayEvents = useMemo(
    () => events.filter((e) => e.event_date === selectedDay),
    [events, selectedDay],
  )
  const upcoming = useMemo(() => reminderEvents(events), [events])

  function dueLabel(due: string): { text: string; overdue: boolean } {
    const days = daysBetweenISO(today, due)
    if (days < 0) return { text: t('pets.overdue', { days: -days }), overdue: true }
    if (days === 0) return { text: t('pets.dueToday'), overdue: true }
    if (days <= 30) return { text: t('pets.inDays', { days }), overdue: false }
    return { text: formatDay(due), overdue: false }
  }

  function openNewEvent() {
    setEditingEvent(null)
    setDraft({ ...emptyDraft, pet: selectedPet ?? pets[0]?.id ?? '', date: todayISO() })
    setShowEventForm(true)
  }

  // "I did this again" — a NEW event copying the original but dated today,
  // rolling next-due forward by the previous interval.
  function logAgain(ev: PetEvent) {
    setEditingEvent(null)
    const interval = ev.next_due ? daysBetweenISO(ev.event_date, ev.next_due) : 0
    setDraft({
      pet: ev.pet_id,
      type: ev.type,
      title: ev.title,
      date: todayISO(),
      nextDue: interval > 0 ? addDaysISO(todayISO(), interval) : '',
      notes: ev.notes ?? '',
    })
    setShowEventForm(true)
  }

  function openEditEvent(ev: PetEvent) {
    setEditingEvent(ev)
    setDraft({
      pet: ev.pet_id,
      type: ev.type,
      title: ev.title,
      date: ev.event_date,
      nextDue: ev.next_due ?? '',
      notes: ev.notes ?? '',
    })
    setShowEventForm(true)
  }

  function removeEvent(event: PetEvent) {
    const pet = petById[event.pet_id]
    Alert.alert(t('pets.deleteConfirm', { title: event.title, pet: pet?.name ?? '' }), undefined, [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('pet_events').delete().eq('id', event.id)
          await load()
        },
      },
    ])
  }

  async function setPetColor(hex: string) {
    if (!selPet || savingColor) return
    setSavingColor(true)
    await supabase.from('pets').update({ tag_color: hex }).eq('id', selPet.id)
    setSavingColor(false)
    load()
  }

  // Month-grid scaffolding.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
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
  function shiftMonth(delta: number) {
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

  // Info-card detail rows (only the filled ones).
  const info: { label: string; value: string }[] = []
  if (selPet) {
    if (selPet.species)
      info.push({ label: t('pets.species'), value: t(`pets.species.${selPet.species}` as TKey) })
    if (selPet.breed) info.push({ label: t('pets.breed'), value: selPet.breed })
    if (selPet.birthday) {
      const mo = ageInMonths(selPet.birthday, today)
      const age =
        mo < 0 ? '' : mo < 12 ? t('pets.ageMo', { months: mo }) : t('pets.ageY', { years: Math.floor(mo / 12) })
      info.push({ label: t('pets.birthday'), value: formatDay(selPet.birthday) + (age ? ` · ${age}` : '') })
    }
    if (selPet.color)
      info.push({
        label: t('pets.color'),
        value: selPet.color + (selPet.color_secondary ? ` & ${selPet.color_secondary}` : ''),
      })
    if (selPet.weight) info.push({ label: t('pets.weight'), value: selPet.weight })
    if (selPet.length) info.push({ label: t('pets.length'), value: selPet.length })
    if (selPet.microchip) info.push({ label: t('pets.microchip'), value: selPet.microchip })
    if (selPet.notes) info.push({ label: t('pets.petNotes'), value: selPet.notes })
  }
  const selPetColor = selPet ? colorMap[selPet.id] : c.accent

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('pets.title')} icon={<PawPrint size={22} color={c.accent} />} />
      </View>

      {loading ? (
        <Loader />
      ) : pets.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState title={t('pets.noPets')} subtitle={t('pets.noPetsHint')} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* pet selector carousel */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, gap: sp.md }}
          >
            {petsSorted.map((p) => {
              const selected = selectedPet === p.id
              const dot = colorMap[p.id]
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedPet(p.id)}
                  style={{
                    width: 96,
                    borderRadius: radius.lg,
                    backgroundColor: c.card,
                    overflow: 'hidden',
                    borderWidth: 2,
                    borderColor: selected ? dot : 'transparent',
                  }}
                >
                  <View
                    style={{
                      height: 72,
                      width: '100%',
                      backgroundColor: c.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {petPhotoUrls[p.id] ? (
                      <Image
                        source={{ uri: petPhotoUrls[p.id] }}
                        style={{ height: 72, width: 96 }}
                        contentFit="cover"
                      />
                    ) : (
                      <Txt style={{ fontSize: 34 }}>{p.emoji || speciesEmoji(p.species)}</Txt>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: sp.sm }}>
                    <View style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: dot }} />
                    <Txt style={{ fontWeight: '600', fontSize: 12, flex: 1 }} numberOfLines={1}>
                      {p.name}
                    </Txt>
                  </View>
                </Pressable>
              )
            })}
            {/* add-pet card */}
            <Pressable
              onPress={() => {
                setEditingPet(null)
                setShowPetForm(true)
              }}
              style={{
                width: 72,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: c.surface2,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                paddingVertical: 12,
              }}
            >
              <Plus size={22} color={c.textFaint} />
              <Txt variant="label" style={{ color: c.textFaint, fontSize: 11 }}>
                {t('pets.addPet')}
              </Txt>
            </Pressable>
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, gap: sp.lg, marginTop: sp.sm }}>
            {/* selected pet info card */}
            {selPet ? (
              <Card style={{ gap: sp.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View
                    style={{
                      height: 56,
                      width: 56,
                      borderRadius: 28,
                      overflow: 'hidden',
                      backgroundColor: c.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 2,
                      borderColor: selPetColor,
                    }}
                  >
                    {petPhotoUrls[selPet.id] ? (
                      <Image
                        source={{ uri: petPhotoUrls[selPet.id] }}
                        style={{ height: 56, width: 56 }}
                        contentFit="cover"
                      />
                    ) : (
                      <Txt style={{ fontSize: 28 }}>{selPet.emoji || speciesEmoji(selPet.species)}</Txt>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="h2" numberOfLines={1}>
                      {selPet.name}
                    </Txt>
                    {info[0] ? (
                      <Txt variant="faint" numberOfLines={1}>
                        {[
                          selPet.species ? t(`pets.species.${selPet.species}` as TKey) : null,
                          selPet.breed,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Txt>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => {
                      setEditingPet(selPet)
                      setShowPetForm(true)
                    }}
                    hitSlop={8}
                    accessibilityLabel={t('pets.edit')}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      backgroundColor: c.surface,
                      borderRadius: radius.pill,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                    }}
                  >
                    <Pencil size={14} color={c.text} />
                    <Txt style={{ fontWeight: '600', fontSize: 13 }}>{t('pets.edit')}</Txt>
                  </Pressable>
                </View>

                {/* detail rows */}
                {info.length > 0 ? (
                  <View style={{ gap: sp.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md }}>
                    {info.map((it) => (
                      <View key={it.label} style={{ flexDirection: 'row', gap: sp.md }}>
                        <Txt variant="faint" style={{ width: 96 }}>
                          {it.label}
                        </Txt>
                        <Txt style={{ flex: 1 }}>{it.value}</Txt>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* calendar color picker */}
                <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md, gap: sp.sm }}>
                  <Txt variant="label">{t('pets.tagColor')}</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {PET_PALETTE.map((hex) => {
                      const active = selPetColor.toLowerCase() === hex.toLowerCase()
                      return (
                        <Pressable
                          key={hex}
                          onPress={() => setPetColor(hex)}
                          disabled={savingColor}
                          accessibilityLabel={hex}
                          style={{
                            height: 30,
                            width: 30,
                            borderRadius: 15,
                            backgroundColor: hex,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: active ? 2 : 0,
                            borderColor: c.text,
                          }}
                        >
                          {active ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              </Card>
            ) : null}

            {/* calendar of ALL pets' events */}
            <Card style={{ padding: sp.md, gap: sp.sm }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} accessibilityLabel={t('pets.calendar')}>
                  <ChevronLeft size={22} color={c.textMuted} />
                </Pressable>
                <Txt variant="h2" style={{ textTransform: 'capitalize' }}>
                  {monthLabel}
                </Txt>
                <Pressable onPress={() => shiftMonth(1)} hitSlop={10} accessibilityLabel={t('pets.calendar')}>
                  <ChevronRight size={22} color={c.textMuted} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row' }}>
                {weekdays.map((w, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center', paddingBottom: 4 }}>
                    <Txt variant="faint" style={{ fontSize: 11, fontWeight: '600' }}>
                      {w}
                    </Txt>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cells.map((day, i) => {
                  if (day === null) {
                    return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 46 }} />
                  }
                  const dateStr = `${view.y}-${pad(view.m)}-${pad(day)}`
                  const dayEvs = eventsByDay.get(dateStr)
                  // Unique per-pet colors for that day's events (up to 3 dots).
                  const dots = [...new Set((dayEvs ?? []).map((e) => colorMap[e.pet_id]))].slice(0, 3)
                  const isToday = dateStr === today
                  const isSelected = dateStr === selectedDay
                  return (
                    <Pressable
                      key={day}
                      onPress={() => setSelectedDay(dateStr)}
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
                        {dots.map((color, j) => (
                          <View
                            key={j}
                            style={{ height: 5, width: 5, borderRadius: 2.5, backgroundColor: color }}
                          />
                        ))}
                      </View>
                    </Pressable>
                  )
                })}
              </View>

              {/* selected day's events */}
              <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.sm, gap: sp.sm }}>
                <Txt variant="label">{formatDay(selectedDay)}</Txt>
                {dayEvents.length === 0 ? (
                  <Txt variant="faint">{t('pets.noDayEvents')}</Txt>
                ) : (
                  dayEvents.map((e) => {
                    const Icon = TYPE_ICON[e.type]
                    const pet = petById[e.pet_id]
                    return (
                      <Pressable
                        key={e.id}
                        onPress={() => openEditEvent(e)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
                      >
                        <View
                          style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: colorMap[e.pet_id] }}
                        />
                        <Icon size={16} color={c.textMuted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                            {e.title}
                          </Txt>
                          <Txt variant="faint" numberOfLines={1}>
                            {pet?.emoji} {pet?.name}
                          </Txt>
                        </View>
                      </Pressable>
                    )
                  })
                )}
              </View>
            </Card>

            {/* upcoming reminders (all pets) */}
            {upcoming.length > 0 ? (
              <View style={{ gap: sp.sm }}>
                <Txt
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    color: c.textFaint,
                  }}
                >
                  {t('pets.comingUp')}
                </Txt>
                {upcoming.map((e) => {
                  const due = dueLabel(e.next_due!)
                  const Icon = TYPE_ICON[e.type]
                  const pet = petById[e.pet_id]
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => openEditEvent(e)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.md,
                        backgroundColor: c.surface,
                        borderRadius: radius.sm,
                        borderLeftWidth: 4,
                        borderLeftColor: colorMap[e.pet_id] ?? c.accent,
                        paddingVertical: 10,
                        paddingHorizontal: sp.md,
                      }}
                    >
                      <Icon size={20} color={c.textMuted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                          {e.title}
                        </Txt>
                        <Txt variant="faint" numberOfLines={1}>
                          {pet?.emoji} {pet?.name} · {t('pets.lastDone')} {formatDay(e.event_date)}
                        </Txt>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View
                          style={{
                            borderRadius: radius.pill,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            backgroundColor: due.overdue ? c.expense : c.card,
                          }}
                        >
                          <Txt
                            style={{
                              fontSize: 12,
                              fontWeight: '700',
                              color: due.overdue ? '#fff' : c.textMuted,
                            }}
                          >
                            {due.text}
                          </Txt>
                        </View>
                        {due.overdue ? (
                          <Pressable
                            onPress={() => logAgain(e)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              borderRadius: radius.pill,
                              backgroundColor: c.accent,
                              paddingHorizontal: 12,
                              paddingVertical: 4,
                            }}
                          >
                            <Check size={14} color="#fff" strokeWidth={2.5} />
                            <Txt style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                              {t('pets.markDone')}
                            </Txt>
                          </Pressable>
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn
            title={pets.length === 0 ? t('pets.addPetBtn') : t('pets.newEventBtn')}
            onPress={() => {
              if (pets.length === 0) {
                setEditingPet(null)
                setShowPetForm(true)
              } else {
                openNewEvent()
              }
            }}
          />
        </View>
      </SafeAreaView>

      {showPetForm ? (
        <PetForm
          pet={editingPet}
          onClose={() => {
            setShowPetForm(false)
            setEditingPet(null)
          }}
          onSaved={() => {
            setShowPetForm(false)
            setEditingPet(null)
            load()
          }}
        />
      ) : null}

      {showEventForm && profile ? (
        <EventForm
          pets={pets}
          draft={draft}
          setDraft={setDraft}
          editingEvent={editingEvent}
          addedBy={profile.email}
          onClose={() => {
            setShowEventForm(false)
            setEditingEvent(null)
          }}
          onSaved={() => {
            setShowEventForm(false)
            setEditingEvent(null)
            load()
          }}
          onDelete={removeEvent}
        />
      ) : null}
    </SafeAreaView>
  )
}
