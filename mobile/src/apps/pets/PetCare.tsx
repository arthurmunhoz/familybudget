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
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { Check, ChevronRight, PawPrint, Plus, SlidersHorizontal, X } from 'lucide-react-native'

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
import { syncPetCareWidget, type PetCareWidgetPet } from '@/lib/widget'
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
  const [routineOpen, setRoutineOpen] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  // Optimistic overlay for checklist taps, cleared when fresh data lands.
  const [overlay, setOverlay] = useState<Record<string, boolean>>({})

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
        <AppHeader
          title={t('pets.title')}
          right={
            pet ? (
              <Pressable onPress={() => setRoutineOpen(true)} hitSlop={10} accessibilityLabel={t('petcare.editRoutine')}>
                <SlidersHorizontal size={20} color={c.textMuted} />
              </Pressable>
            ) : undefined
          }
        />
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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 120, gap: sp.md }}
        >
          {/* pet chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm }}>
            {petsSorted.map((p) => {
              const on = p.id === selectedPet
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedPet(p.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.pill,
                    backgroundColor: on ? c.accent : c.surface,
                  }}
                >
                  {petPhotoUrls[p.id] ? (
                    <Image source={{ uri: petPhotoUrls[p.id] }} style={{ width: 22, height: 22, borderRadius: 11 }} />
                  ) : (
                    <Txt style={{ fontSize: 14 }}>{p.emoji || speciesEmoji(p.species)}</Txt>
                  )}
                  <Txt style={{ fontWeight: '700', fontSize: 13, color: on ? '#fff' : c.textMuted }}>{p.name}</Txt>
                  {(overduePets[p.id] ?? 0) > 0 ? (
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: on ? '#fff' : c.expense }} />
                  ) : null}
                </Pressable>
              )
            })}
            <Pressable
              onPress={() => setShowPetForm(true)}
              accessibilityLabel={t('pets.addPet')}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 10,
                borderRadius: radius.pill,
                backgroundColor: c.surface,
              }}
            >
              <Plus size={16} color={c.textFaint} />
            </Pressable>
          </ScrollView>

          {pet ? (
            <>
              {/* Today */}
              <Card style={{ gap: 2 }}>
                <Pressable
                  onPress={() => router.push(`/pets/${pet.id}`)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('petcare.today')} · {pet.name}
                  </Txt>
                  <ChevronRight size={16} color={c.textFaint} />
                </Pressable>

                {checklist.length === 0 ? (
                  <View style={{ gap: sp.sm, paddingTop: sp.sm }}>
                    <Txt variant="muted">{t('petcare.noDaily')}</Txt>
                    <Btn title={t('petcare.editRoutine')} variant="secondary" onPress={() => setRoutineOpen(true)} />
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
                <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {t('petcare.routines')}
                </Txt>
                {routines.length === 0 ? (
                  <View style={{ gap: sp.sm, paddingTop: sp.sm }}>
                    <Txt variant="muted">{t('petcare.noRoutines')}</Txt>
                    <Btn title={t('petcare.editRoutine')} variant="secondary" onPress={() => setRoutineOpen(true)} />
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

              {/* History */}
              {history.length > 0 ? (
                <Card style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('pets.history')}
                    </Txt>
                    {history.length > HISTORY_PREVIEW ? (
                      <Pressable onPress={() => setShowAllHistory((v) => !v)} hitSlop={8}>
                        <Txt style={{ color: c.accent, fontWeight: '600', fontSize: 12 }}>
                          {showAllHistory ? t('common.close') : t('petcare.seeAll')}
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
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
                          <X size={15} color={c.textFaint} />
                        </Pressable>
                      </Pressable>
                    )
                  })}
                </Card>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* bottom bar */}
      {pets.length > 0 ? (
        <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
            <Btn title={t('petcare.logEvent')} onPress={openNewEvent} />
          </View>
        </SafeAreaView>
      ) : null}

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
          onClose={() => setRoutineOpen(false)}
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
