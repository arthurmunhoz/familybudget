// Pet Care — a per-pet view. Top: a horizontally-paging carousel where each
// page IS a pet's full info card (photo, details, calendar-color picker, Edit
// button) — swiping moves to the next pet; the last page adds a new one.
// Below: a month calendar showing EVERY pet's events as small per-pet colored
// dots (tap a day to see it), then the upcoming reminders sorted by soonest,
// with a "done again" re-log on overdue. The bottom bar adds an event (or the
// first pet). Pet + event add/edit are bottom-sheet modals.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Dimensions, Modal, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Check, ChevronDown, ChevronLeft, ChevronRight, PawPrint, Pencil, Plus } from 'lucide-react-native'

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

  // Upcoming "next due" dates grouped by day (within the visible month), so the
  // calendar also marks when things are due — not just when they were logged.
  const dueByDay = useMemo(() => {
    const map = new Map<string, PetEvent[]>()
    for (const e of upcoming) {
      const d = e.next_due
      if (!d || d < monthStart || d > monthEnd) continue
      const arr = map.get(d)
      if (arr) arr.push(e)
      else map.set(d, [e])
    }
    return map
  }, [upcoming, monthStart, monthEnd])
  const dayDue = useMemo(() => dueByDay.get(selectedDay) ?? [], [dueByDay, selectedDay])

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

  async function setPetColor(petId: string, hex: string) {
    if (savingColor) return
    setSavingColor(true)
    await supabase.from('pets').update({ tag_color: hex }).eq('id', petId)
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

  // Info-card detail rows for any pet (only the filled ones) — used for every
  // page of the carousel, not just the currently-selected one.
  function infoRowsFor(p: Pet): { label: string; value: string }[] {
    const rows: { label: string; value: string }[] = []
    if (p.species) rows.push({ label: t('pets.species'), value: t(`pets.species.${p.species}` as TKey) })
    if (p.breed) rows.push({ label: t('pets.breed'), value: p.breed })
    if (p.birthday) {
      const mo = ageInMonths(p.birthday, today)
      const age =
        mo < 0 ? '' : mo < 12 ? t('pets.ageMo', { months: mo }) : t('pets.ageY', { years: Math.floor(mo / 12) })
      rows.push({ label: t('pets.birthday'), value: formatDay(p.birthday) + (age ? ` · ${age}` : '') })
    }
    if (p.color)
      rows.push({
        label: t('pets.color'),
        value: p.color + (p.color_secondary ? ` & ${p.color_secondary}` : ''),
      })
    if (p.weight) rows.push({ label: t('pets.weight'), value: p.weight })
    if (p.length) rows.push({ label: t('pets.length'), value: p.length })
    if (p.microchip) rows.push({ label: t('pets.microchip'), value: p.microchip })
    if (p.notes) rows.push({ label: t('pets.petNotes'), value: p.notes })
    return rows
  }
  const subtitleFor = (p: Pet) =>
    [p.species ? t(`pets.species.${p.species}` as TKey) : null, p.breed].filter(Boolean).join(' · ')

  // Peek carousel: the card is narrower than the screen so the neighbor pets
  // peek on both sides, and each pet snaps dead-center. PEEK = the padding on
  // each side (= half the off-card space), which is what centers a snapped card.
  const winW = Dimensions.get('window').width
  const PEEK = 28
  const CARD_WIDTH = winW - PEEK * 2
  const carouselRef = useRef<ScrollView>(null)

  function scrollToPet(index: number) {
    const pet = petsSorted[index]
    if (!pet) return
    carouselRef.current?.scrollTo({ x: index * (CARD_WIDTH + sp.md), animated: true })
    setSelectedPet(pet.id)
  }

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
          {/* pet carousel — each page IS the full info card; swipe to the next
              pet, last page adds a new one. Snaps by momentum end, computing
              the nearest page from the scroll offset. */}
          <ScrollView
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={CARD_WIDTH + sp.md}
            snapToAlignment="start"
            contentContainerStyle={{ paddingHorizontal: PEEK, paddingVertical: sp.sm, gap: sp.md }}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + sp.md))
              const pet = petsSorted[Math.max(0, Math.min(idx, petsSorted.length - 1))]
              if (pet) setSelectedPet(pet.id)
            }}
          >
            {petsSorted.map((p) => {
              const color = colorMap[p.id]
              const pInfo = infoRowsFor(p)
              const subtitle = subtitleFor(p)
              return (
                <Card key={p.id} style={{ width: CARD_WIDTH, gap: sp.md }}>
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
                        borderColor: color,
                      }}
                    >
                      {petPhotoUrls[p.id] ? (
                        <Image
                          source={{ uri: petPhotoUrls[p.id] }}
                          style={{ height: 56, width: 56 }}
                          contentFit="cover"
                        />
                      ) : (
                        <Txt style={{ fontSize: 28 }}>{p.emoji || speciesEmoji(p.species)}</Txt>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="h2" numberOfLines={1}>
                        {p.name}
                      </Txt>
                      {subtitle ? (
                        <Txt variant="faint" numberOfLines={1}>
                          {subtitle}
                        </Txt>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => {
                        setEditingPet(p)
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
                  {pInfo.length > 0 ? (
                    <View style={{ gap: sp.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md }}>
                      {pInfo.map((it) => (
                        <View key={it.label} style={{ flexDirection: 'row', gap: sp.md }}>
                          <Txt variant="faint" style={{ width: 96 }}>
                            {it.label}
                          </Txt>
                          <Txt style={{ flex: 1 }}>{it.value}</Txt>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* calendar color — a dropdown that shows only the selected swatch */}
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                      paddingTop: sp.md,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Txt variant="label">{t('pets.tagColor')}</Txt>
                    <ColorDropdown
                      value={color}
                      onSelect={(hex) => setPetColor(p.id, hex)}
                      disabled={savingColor}
                    />
                  </View>
                </Card>
              )
            })}
            {/* add-pet page */}
            <Pressable
              onPress={() => {
                setEditingPet(null)
                setShowPetForm(true)
              }}
              style={{
                width: CARD_WIDTH,
                borderRadius: radius.lg,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: c.surface2,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 40,
              }}
            >
              <Plus size={28} color={c.textFaint} />
              <Txt variant="label" style={{ color: c.textFaint }}>
                {t('pets.addPet')}
              </Txt>
            </Pressable>
          </ScrollView>

          {/* page dots — tap to jump a pet to center */}
          {petsSorted.length > 1 ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 6,
                marginTop: sp.xs,
              }}
            >
              {petsSorted.map((p, i) => {
                const active = p.id === selectedPet
                return (
                  <Pressable key={p.id} onPress={() => scrollToPet(i)} hitSlop={8}>
                    <View
                      style={{
                        height: 7,
                        width: active ? 18 : 7,
                        borderRadius: 4,
                        backgroundColor: active ? colorMap[p.id] : c.surface2,
                      }}
                    />
                  </Pressable>
                )
              })}
            </View>
          ) : null}

          <View style={{ paddingHorizontal: sp.lg, gap: sp.lg, marginTop: sp.md }}>
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
                  // Per-pet colors for events on that day (logged) + next-due
                  // dates (upcoming), up to 3 dots.
                  const colorsSet = new Set<string>()
                  for (const e of eventsByDay.get(dateStr) ?? []) colorsSet.add(colorMap[e.pet_id])
                  for (const e of dueByDay.get(dateStr) ?? []) colorsSet.add(colorMap[e.pet_id])
                  const dots = [...colorsSet].slice(0, 3)
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
              <View style={{ marginTop: sp.md, borderTopWidth: 1, borderTopColor: c.surface2, paddingTop: sp.md, gap: sp.sm }}>
                <Txt variant="label">{formatDay(selectedDay)}</Txt>
                {dayEvents.length === 0 && dayDue.length === 0 ? (
                  <Txt variant="faint">{t('pets.noDayEvents')}</Txt>
                ) : (
                  <>
                    {dayEvents.map((e) => {
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
                    })}
                    {dayDue.map((e) => {
                      const Icon = TYPE_ICON[e.type]
                      const pet = petById[e.pet_id]
                      return (
                        <Pressable
                          key={`due-${e.id}`}
                          onPress={() => openEditEvent(e)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
                        >
                          {/* hollow dot = upcoming due (vs a filled dot = logged) */}
                          <View
                            style={{
                              height: 8,
                              width: 8,
                              borderRadius: 4,
                              borderWidth: 1.5,
                              borderColor: colorMap[e.pet_id],
                            }}
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
                          <View
                            style={{
                              borderRadius: radius.pill,
                              paddingHorizontal: 8,
                              paddingVertical: 2,
                              backgroundColor: c.accentSoft,
                            }}
                          >
                            <Txt style={{ fontSize: 11, fontWeight: '700', color: c.accent }}>
                              {t('pets.dueMarker')}
                            </Txt>
                          </View>
                        </Pressable>
                      )
                    })}
                  </>
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

/** Compact color picker: a pill showing only the selected swatch; the full
 *  palette lives in a dropdown anchored under it (measured in-window so it
 *  overlays without clipping the card). */
function ColorDropdown({
  value,
  onSelect,
  disabled,
}: {
  value: string
  onSelect: (hex: string) => void
  disabled?: boolean
}) {
  const { c } = useTheme()
  const ref = useRef<View>(null)
  const [open, setOpen] = useState(false)
  // Anchor the menu ABOVE the pill: it sits low on the pet card, so opening
  // downward would collide with the calendar below. `bottom` = distance from the
  // window bottom to the pill's top.
  const [pos, setPos] = useState({ bottom: 0, right: 0 })
  const { width: winW, height: winH } = Dimensions.get('window')

  const openMenu = () => {
    ref.current?.measureInWindow((x, y, w) => {
      setPos({ bottom: winH - y + 6, right: Math.max(8, winW - (x + w)) })
      setOpen(true)
    })
  }

  return (
    <>
      <Pressable
        ref={ref}
        onPress={openMenu}
        disabled={disabled}
        accessibilityLabel={value}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: c.surface,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 8,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <View style={{ height: 22, width: 22, borderRadius: 11, backgroundColor: value }} />
        <ChevronDown size={14} color={c.textMuted} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            style={{
              position: 'absolute',
              bottom: pos.bottom,
              right: pos.right,
              width: 168,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 10,
              padding: 12,
              backgroundColor: c.card,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            {PET_PALETTE.map((hex) => {
              const active = value.toLowerCase() === hex.toLowerCase()
              return (
                <Pressable
                  key={hex}
                  onPress={() => {
                    onSelect(hex)
                    setOpen(false)
                  }}
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
        </Pressable>
      </Modal>
    </>
  )
}
