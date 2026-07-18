// Pet Care — routine-first redesign (replaces the old carousel + month
// calendar). Top: pet chips (photo/emoji + name; red dot = something overdue;
// "+" adds a pet). Then, for the selected pet:
//   • Today — the daily checklist (morning walk, breakfast, dinner…) in the
//     configured order, resetting each day and showing WHO did each item — so
//     nobody double-feeds the dog.
//   • Care routines — every-N-days items (bath, nails, flea…) with a due pill;
//     Done logs today and rolls the next due automatically.
//   • History — pet_events (vet visits, vaccines…), add/edit/delete kept via
//     the existing EventForm.
// The routine itself is configurable per pet (RoutineSheet). Every mutation
// also feeds the Pet Care home-screen widget: a fresh App Group snapshot +
// a best-effort ?action=petcare-notify so OTHER members' widgets reload ASAP.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, AppState, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Image } from 'expo-image'
import { Check, PawPrint, Pencil, Plus, Trash2 } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { track } from '@/lib/analytics'
import { addDaysISO, formatDay, shortName, todayISO } from '@/lib/format'
import { dailyChecklist, routineStatus } from '@/lib/petCare'
import { getSignedUrls } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet, PetCareTask, PetEvent, PetTaskDone } from '@/lib/types'
import { File, Paths } from 'expo-file-system'

import { APP_GROUP, reloadPetCareWidget, syncPetCareWidget, type PetCareWidgetPet } from '@/lib/widget'
import { radius, sp, useTheme } from '@/theme/theme'
import { CARE_ICONS, TYPE_ICON } from './petUi'
import { speciesEmoji } from './petMeta'
import EventForm, { type EventDraft } from './EventForm'
import PetForm from './PetForm'
import { RoutineSheet } from './RoutineSheet'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''
const HISTORY_PREVIEW = 5

/** Local HH:MM for a timestamptz — when a task was checked off. */
function doneTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const emptyDraft: EventDraft = {
  pet: '',
  type: 'medication',
  title: '',
  date: todayISO(),
  nextDue: '',
  notes: '',
}

// Which photo_path each pet's widget thumbnail was mirrored from — module-level
// so re-mounts don't re-download unchanged photos.
const mirroredPhotos: Record<string, string> = {}

/** Mirror a pet photo into the shared App Group CONTAINER (a real file — the
 *  canonical way to hand an image to a widget; UserDefaults strings proved
 *  unreliable for photo-sized payloads). The widget reads
 *  petcare_photo_<id>.jpg via its own container access. Photos are already
 *  ≤512px JPEG at upload. Best-effort; failures leave the initial-letter tile. */
async function mirrorPetPhoto(petId: string, photoPath: string, url: string): Promise<void> {
  try {
    const container = Paths.appleSharedContainers[APP_GROUP]
    if (!container) return // Android / Expo Go — no widget to feed
    const dest = new File(container, `petcare_photo_${petId}.jpg`)
    await File.downloadFileAsync(url, dest, { idempotent: true })
    mirroredPhotos[petId] = photoPath
    reloadPetCareWidget()
  } catch {
    /* ignore — the widget falls back to the initial */
  }
}

/** Best-effort: tell the server someone changed pet care, so it silent-pushes
 *  every OTHER member's device and their widgets reload. Failures are ignored —
 *  widgets still catch up on their own timeline. */
function notifyPetCareChange(): void {
  void (async () => {
    try {
      const { data } = await supabase.rpc('widget_token')
      const token = typeof data === 'string' ? data : null
      if (!token || !API_BASE) return
      await fetch(`${API_BASE}/api/widget?action=petcare-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    } catch {
      /* ignore */
    }
  })()
}

export default function PetCare() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const today = todayISO()

  const [selectedPet, setSelectedPet] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [showPetForm, setShowPetForm] = useState(false)
  // Which section's editor is open (each pencil opens ONLY its own group).
  const [routineOpen, setRoutineOpen] = useState<'daily' | 'interval' | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  // Optimistic overlay for checklist taps, cleared when fresh data lands.
  const [overlay, setOverlay] = useState<Record<string, boolean>>({})

  // Pet chips start big and shrink as the list scrolls up (JS-driven — these
  // interpolations feed layout props, which the native driver can't animate).
  const scrollY = useRef(new Animated.Value(0)).current
  const chipAvatar = scrollY.interpolate({ inputRange: [0, 80], outputRange: [52, 22], extrapolate: 'clamp' })
  const chipInitial = scrollY.interpolate({ inputRange: [0, 80], outputRange: [21, 10], extrapolate: 'clamp' })
  const chipFont = scrollY.interpolate({ inputRange: [0, 80], outputRange: [18, 13], extrapolate: 'clamp' })
  const chipPadV = scrollY.interpolate({ inputRange: [0, 80], outputRange: [12, 7], extrapolate: 'clamp' })

  type Data = {
    pets: Pet[]
    tasks: PetCareTask[]
    done: PetTaskDone[]
    events: PetEvent[]
    petPhotoUrls: Record<string, string>
  }
  const {
    data: { pets, tasks, done, events, petPhotoUrls } = {
      pets: [],
      tasks: [],
      done: [],
      events: [],
      petPhotoUrls: {},
    },
    loading,
    revalidate: load,
  } = useCachedQuery<Data>('pets', async () => {
    const [petsRes, tasksRes, doneRes, eventsRes] = await Promise.all([
      supabase.from('pets').select('*').order('name'),
      supabase.from('pet_care_tasks').select('*').order('sort_order'),
      // 370d back covers the longest sane interval (yearly) for due math.
      supabase.from('pet_task_done').select('*').gte('done_on', addDaysISO(todayISO(), -370)),
      supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    ])
    const petRows = (petsRes.data ?? []) as Pet[]
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
    return {
      pets: petRows,
      tasks: (tasksRes.data ?? []) as PetCareTask[],
      done: (doneRes.data ?? []) as PetTaskDone[],
      events: (eventsRes.data ?? []) as PetEvent[],
      petPhotoUrls: photoUrls,
    }
  })

  // Fresh data replaces the optimistic overlay.
  useEffect(() => {
    setOverlay({})
  }, [done])

  // useCachedQuery fetches on MOUNT only, so two real-world paths went stale:
  // returning to this (still-mounted) screen, and — the widget repro — marking
  // a task from the Home Screen while the app sits backgrounded ON Pet Care.
  // Focus doesn't fire for background→foreground, so both hooks are needed.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load()
    })
    return () => sub.remove()
  }, [load])

  // Mirror pet photos into the App Group for the widget (only when changed).
  useEffect(() => {
    for (const p of pets) {
      const url = petPhotoUrls[p.id]
      if (p.photo_path && url && mirroredPhotos[p.id] !== p.photo_path) {
        void mirrorPetPhoto(p.id, p.photo_path, url)
      }
    }
  }, [pets, petPhotoUrls])

  const petsSorted = useMemo(() => [...pets].sort((a, b) => a.name.localeCompare(b.name)), [pets])
  const petById = useMemo(() => Object.fromEntries(pets.map((p) => [p.id, p])), [pets])
  const nameFor = (email: string) =>
    shortName(profiles.find((p) => p.email === email)?.display_name ?? email)

  useEffect(() => {
    if (petsSorted.length === 0) {
      if (selectedPet !== null) setSelectedPet(null)
    } else if (!selectedPet || !petsSorted.some((p) => p.id === selectedPet)) {
      setSelectedPet(petsSorted[0].id)
    }
  }, [petsSorted, selectedPet])

  const pet = selectedPet ? (petById[selectedPet] ?? null) : null
  const checklist = useMemo(
    () => (pet ? dailyChecklist(tasks, done, pet.id, today) : []),
    [tasks, done, pet, today],
  )
  const routines = useMemo(
    () => (pet ? routineStatus(tasks, done, pet.id, today) : []),
    [tasks, done, pet, today],
  )
  const petTasks = useMemo(() => (pet ? tasks.filter((tk) => tk.pet_id === pet.id) : []), [tasks, pet])
  const history = useMemo(() => (pet ? events.filter((e) => e.pet_id === pet.id) : []), [events, pet])

  /** Overdue count per pet — drives the red dot on the chips. */
  const overduePets = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of pets) {
      map[p.id] = routineStatus(tasks, done, p.id, today).filter((r) => r.dueIn <= 0 && r.lastDone !== null).length
    }
    return map
  }, [pets, tasks, done, today])

  // Feed the home-screen widget an up-to-date snapshot on every data change.
  useEffect(() => {
    if (loading) return
    const snapshot: PetCareWidgetPet[] = petsSorted.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji || speciesEmoji(p.species),
      daily: dailyChecklist(tasks, done, p.id, today).map(({ task, done: d }) => ({
        id: task.id,
        title: task.title,
        icon: task.icon,
        done: !!d,
        doneBy: d ? nameFor(d.done_by) : null,
      })),
      routines: routineStatus(tasks, done, p.id, today).map(({ task, dueIn }) => ({
        id: task.id,
        title: task.title,
        icon: task.icon,
        dueIn,
      })),
    }))
    syncPetCareWidget(today, snapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, petsSorted, tasks, done, today])

  const afterMutation = () => {
    void load()
    notifyPetCareChange()
  }

  /** Tap a Today row: mark done, or undo if already done. */
  async function toggleDaily(task: PetCareTask, current: PetTaskDone | null) {
    const marking = !current && overlay[task.id] !== true
    setOverlay((o) => ({ ...o, [task.id]: marking }))
    if (marking) {
      const { error } = await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: today })
      // 23505 = already marked by someone else in the meantime — that's fine.
      if (error && error.code !== '23505') {
        setOverlay((o) => ({ ...o, [task.id]: false }))
        Alert.alert(t('pets.saveFailed'))
        return
      }
      track('petcare.task_done', { title: task.title, pet: petById[task.pet_id]?.name })
    } else if (current) {
      const { error } = await supabase.from('pet_task_done').delete().eq('id', current.id)
      if (error) {
        Alert.alert(t('pets.saveFailed'))
        return
      }
    }
    afterMutation()
  }

  /** "Done" on an interval routine: log today, which rolls the next due. */
  async function markRoutineDone(task: PetCareTask) {
    const { error } = await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: today })
    if (error && error.code !== '23505') {
      Alert.alert(t('pets.saveFailed'))
      return
    }
    track('petcare.task_done', { title: task.title, pet: petById[task.pet_id]?.name })
    afterMutation()
  }

  function dueText(dueIn: number): { text: string; color: string } {
    if (dueIn < 0) return { text: t('pets.overdue', { days: -dueIn }), color: c.expense }
    if (dueIn === 0) return { text: t('pets.dueToday'), color: c.accent }
    return { text: t('pets.inDays', { days: dueIn }), color: dueIn <= 3 ? c.accent : c.income }
  }

  function openNewEvent() {
    setEditingEvent(null)
    setDraft({ ...emptyDraft, pet: selectedPet ?? pets[0]?.id ?? '', date: todayISO() })
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
    const p = petById[event.pet_id]
    Alert.alert(t('pets.deleteConfirm', { title: event.title, pet: p?.name ?? '' }), undefined, [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('pet_events').delete().eq('id', event.id)
          track('pet.event_deleted', { title: event.title })
          await load()
        },
      },
    ])
  }

  const allDone = checklist.length > 0 && checklist.every(({ task, done: d }) => (overlay[task.id] ?? !!d))

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('pets.title')} />
      </View>

      {loading ? (
        <Loader />
      ) : pets.length === 0 ? (
        <>
          <EmptyState title={t('pets.noPets')} subtitle={t('pets.noPetsHint')} />
          <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <View style={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
              <Btn title={t('pets.addPet')} onPress={() => setShowPetForm(true)} />
            </View>
          </SafeAreaView>
        </>
      ) : (
        <>
          {/* pet chips — fixed above the list; big on load, shrink on scroll.
              Tapping the SELECTED pet's chip again opens its profile. */}
          <View style={{ paddingBottom: sp.sm }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: sp.sm, paddingHorizontal: sp.lg }}
            >
              {petsSorted.map((p) => {
                const on = p.id === selectedPet
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => (on ? router.push(`/pets/${p.id}`) : setSelectedPet(p.id))}
                  >
                    <Animated.View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 12,
                        paddingVertical: chipPadV,
                        borderRadius: radius.pill,
                        backgroundColor: on ? c.accent : c.surface,
                      }}
                    >
                      {petPhotoUrls[p.id] ? (
                        <Animated.View
                          style={{ width: chipAvatar, height: chipAvatar, borderRadius: 26, overflow: 'hidden' }}
                        >
                          <Image source={{ uri: petPhotoUrls[p.id] }} style={{ width: '100%', height: '100%' }} />
                        </Animated.View>
                      ) : (
                        <Animated.View
                          style={{
                            width: chipAvatar,
                            height: chipAvatar,
                            borderRadius: 26,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: on ? 'rgba(255,255,255,0.28)' : c.accentSoft,
                          }}
                        >
                          <Animated.Text
                            style={{ fontSize: chipInitial, fontWeight: '700', color: on ? '#fff' : c.accent }}
                          >
                            {(p.name.trim().charAt(0) || '?').toUpperCase()}
                          </Animated.Text>
                        </Animated.View>
                      )}
                      <Animated.Text
                        style={{ fontWeight: '700', fontSize: chipFont, color: on ? '#fff' : c.textMuted }}
                      >
                        {p.name}
                      </Animated.Text>
                      {(overduePets[p.id] ?? 0) > 0 ? (
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: on ? '#fff' : c.expense }} />
                      ) : null}
                    </Animated.View>
                  </Pressable>
                )
              })}
              <Pressable
                onPress={() => setShowPetForm(true)}
                accessibilityLabel={t('pets.addPet')}
                style={{ justifyContent: 'center' }}
              >
                {/* avatar-sized placeholder — reads as "a photo goes here" */}
                <Animated.View
                  style={{
                    width: chipAvatar,
                    height: chipAvatar,
                    borderRadius: 26,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: c.textFaint,
                    backgroundColor: c.surface,
                  }}
                >
                  <Plus size={18} color={c.textMuted} />
                </Animated.View>
              </Pressable>
            </ScrollView>
          </View>

        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xl * 2, gap: sp.md }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: false,
          })}
          scrollEventThrottle={16}
        >
          {pet ? (
            <>
              {/* Today */}
              <Card style={{ gap: 2 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: sp.sm,
                  }}
                >
                  <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: sp.xs }}>
                    {t('petcare.today')} · {pet.name}
                  </Txt>
                  <Pressable onPress={() => setRoutineOpen('daily')} hitSlop={10} accessibilityLabel={t('petcare.editRoutine')}>
                    <Pencil size={15} color={c.textFaint} />
                  </Pressable>
                </View>

                {checklist.length === 0 ? (
                  <View style={{ gap: sp.sm, paddingTop: sp.sm }}>
                    <Txt variant="muted">{t('petcare.noDaily')}</Txt>
                    <Btn title={t('petcare.editRoutine')} variant="secondary" onPress={() => setRoutineOpen('daily')} />
                  </View>
                ) : (
                  <>
                    {checklist.map(({ task, done: d }, i) => {
                      const isDone = overlay[task.id] ?? !!d
                      const Icon = CARE_ICONS[task.icon] ?? PawPrint
                      return (
                        <Pressable
                          key={task.id}
                          onPress={() => void toggleDaily(task, d)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isDone }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: sp.md,
                            paddingVertical: 9,
                            borderTopWidth: i === 0 ? 0 : 1,
                            borderTopColor: c.border,
                          }}
                        >
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: isDone ? c.income : 'transparent',
                              borderWidth: isDone ? 0 : 1.5,
                              borderColor: c.textFaint,
                            }}
                          >
                            {isDone ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                          </View>
                          <Txt
                            style={{
                              flex: 1,
                              fontWeight: '500',
                              color: isDone ? c.textMuted : c.text,
                              textDecorationLine: isDone ? 'line-through' : 'none',
                            }}
                            numberOfLines={1}
                          >
                            {task.title}
                          </Txt>
                          {d ? (
                            <Txt variant="faint" style={{ fontSize: 11 }}>
                              {nameFor(d.done_by)} · {doneTime(d.created_at)}
                            </Txt>
                          ) : (
                            <Icon size={16} color={c.textFaint} />
                          )}
                        </Pressable>
                      )
                    })}
                    {allDone ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6 }}>
                        <Check size={14} color={c.income} strokeWidth={3} />
                        <Txt style={{ color: c.income, fontWeight: '600', fontSize: 13 }}>
                          {t('petcare.allDoneToday')}
                        </Txt>
                      </View>
                    ) : null}
                  </>
                )}
              </Card>

              {/* Care routines */}
              <Card style={{ gap: 2 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: sp.sm,
                  }}
                >
                  <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: sp.xs }}>
                    {t('petcare.routines')}
                  </Txt>
                  <Pressable onPress={() => setRoutineOpen('interval')} hitSlop={10} accessibilityLabel={t('petcare.editRoutine')}>
                    <Pencil size={15} color={c.textFaint} />
                  </Pressable>
                </View>
                {routines.length === 0 ? (
                  <View style={{ gap: sp.sm, paddingTop: sp.sm }}>
                    <Txt variant="muted">{t('petcare.noRoutines')}</Txt>
                    <Btn title={t('petcare.editRoutine')} variant="secondary" onPress={() => setRoutineOpen('interval')} />
                  </View>
                ) : (
                  routines.map(({ task, dueIn, lastDone }, i) => {
                    const Icon = CARE_ICONS[task.icon] ?? PawPrint
                    const urgent = dueIn <= 0
                    const { text, color } = dueText(dueIn)
                    return (
                      <View
                        key={task.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: sp.md,
                          paddingVertical: 9,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: c.border,
                        }}
                      >
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: radius.md,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: urgent ? c.accentSoft : c.surface,
                          }}
                        >
                          <Icon size={16} color={urgent ? c.expense : c.accent} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                            {task.title}
                          </Txt>
                          <Txt variant="faint" style={{ fontSize: 11 }}>
                            {t('petcare.every', { days: task.interval_days ?? 0 })}
                            {lastDone ? ` · ${formatDay(lastDone)}` : ''}
                          </Txt>
                        </View>
                        <Txt style={{ fontSize: 12, fontWeight: '600', color }}>{text}</Txt>
                        <Pressable
                          onPress={() => void markRoutineDone(task)}
                          accessibilityLabel={`${t('common.done')} ${task.title}`}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: radius.pill,
                            backgroundColor: urgent ? c.accent : c.surface,
                          }}
                        >
                          <Txt style={{ fontSize: 12, fontWeight: '700', color: urgent ? '#fff' : c.textMuted }}>
                            {t('common.done')}
                          </Txt>
                        </Pressable>
                      </View>
                    )
                  })
                )}
              </Card>

              {/* History — the log-event action lives HERE (it only ever adds
                  history entries), not in a global bottom bar. */}
              <Card style={{ gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: sp.sm,
                    }}
                  >
                    <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: sp.xs }}>
                      {t('pets.history')}
                    </Txt>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                      {history.length > HISTORY_PREVIEW ? (
                        <Pressable onPress={() => setShowAllHistory((v) => !v)} hitSlop={8}>
                          <Txt style={{ color: c.textMuted, fontWeight: '600', fontSize: 12 }}>
                            {showAllHistory ? t('common.close') : t('petcare.seeAll')}
                          </Txt>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={openNewEvent}
                        hitSlop={8}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: radius.pill,
                          backgroundColor: c.accentSoft,
                        }}
                      >
                        <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 12 }}>
                          {t('petcare.logEvent')}
                        </Txt>
                      </Pressable>
                    </View>
                  </View>
                  {history.length === 0 ? (
                    <Txt variant="muted" style={{ paddingTop: sp.sm }}>
                      {t('petcare.noHistory')}
                    </Txt>
                  ) : null}
                  {(showAllHistory ? history : history.slice(0, HISTORY_PREVIEW)).map((e, i) => {
                    const Icon = TYPE_ICON[e.type]
                    return (
                      <Pressable
                        key={e.id}
                        onPress={() => openEditEvent(e)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: sp.md,
                          paddingVertical: 8,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: c.border,
                        }}
                      >
                        <Icon size={16} color={c.textMuted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontWeight: '500', fontSize: 14 }} numberOfLines={1}>
                            {e.title}
                          </Txt>
                          <Txt variant="faint" style={{ fontSize: 11 }}>
                            {formatDay(e.event_date)}
                          </Txt>
                        </View>
                        <Pressable onPress={() => removeEvent(e)} hitSlop={8} accessibilityLabel={t('common.delete')}>
                          <Trash2 size={15} color={c.textFaint} />
                        </Pressable>
                      </Pressable>
                    )
                  })}
                </Card>
            </>
          ) : null}
        </Animated.ScrollView>
        </>
      )}

      {showPetForm ? (
        <PetForm
          pet={null}
          onClose={() => setShowPetForm(false)}
          onSaved={() => {
            setShowPetForm(false)
            load()
          }}
        />
      ) : null}

      {routineOpen && pet ? (
        <RoutineSheet
          pet={pet}
          tasks={petTasks}
          section={routineOpen}
          onClose={() => setRoutineOpen(null)}
          onChanged={afterMutation}
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
          onDelete={(ev) => {
            setShowEventForm(false)
            setEditingEvent(null)
            removeEvent(ev)
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}
