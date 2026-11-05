// Pet Care — routine-first redesign (replaces the old month calendar). Top: the
// selected pet's photo full-bleed (components/PhotoHero) — swipe or tap the side arrows to
// change pet; name + overdue dot on the photo; "+" on it adds a pet.
// Then, for the selected pet:
//   • Today — the daily checklist (morning walk, breakfast, dinner…) in the
//     configured order, resetting each day and showing WHO did each item — so
//     nobody double-feeds the dog.
//   • Care routines — every-N-days items (bath, nails, flea…) with a due pill;
//     Done logs today and rolls the next due automatically.
//   • History — pet_events (vet visits, vaccines…), add/edit/delete kept via
//     the existing EventForm.
// Opened with ?overdue=1 (the daily digest's notification tap), it also shows
// the OverdueSheet: everything due across all pets, each with a one-tap Done.
// The routine itself is configurable per pet (RoutineSheet). Every mutation
// also feeds the Pet Care home-screen widget: a fresh App Group snapshot +
// a best-effort ?action=petcare-notify so OTHER members' widgets reload ASAP.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Animated, Pressable, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { PawPrint, Plus, Stethoscope, Syringe } from 'lucide-react-native'
import { useScreenCorner } from '@/hooks/useScreenCorner'

import { AppHeader, Btn, EmptyState, Loader, Txt } from '@/components/ui'
import { Toast, type ToastData } from '@/components/Toast'
import { PhotoHero, type HeroItem } from '@/components/PhotoHero'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import { track } from '@/lib/analytics'
import { addDaysISO, daysBetweenISO, formatDay, shortName, todayISO } from '@/lib/format'
import {
  dailyChecklist,
  overdueCare,
  overdueEvents,
  reminderEvents,
  routineStatus,
  type OverdueCare,
  eventSeries,
} from '@/lib/petCare'
import { getSignedUrls } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet, PetCareTask, PetEvent, PetEventType, PetTaskDone } from '@/lib/types'
import { File, Paths } from 'expo-file-system'

import { APP_GROUP, reloadPetCareWidget, syncPetCareWidget, type PetCareWidgetPet } from '@/lib/widget'
import { fonts, sp, useTheme } from '@/theme/theme'
import { TodayCard, CareGrid, EventsCard, EventSeriesSheet, type CareItem } from './CareCards'
import { CARE_ICONS, TYPE_ICON } from './petUi'
import { petColor, petColorMap, TYPE_COLOR } from './petColors'
import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { useBottomGap } from '@/hooks/useBottomGap'
import { speciesEmoji } from './petMeta'
import EventForm, { type EventDraft } from './EventForm'
import VisitForm from './VisitForm'
import PetForm from './PetForm'
import { RoutineSheet } from './RoutineSheet'
import { OverdueSheet } from './OverdueSheet'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

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

type Data = {
  pets: Pet[]
  tasks: PetCareTask[]
  done: PetTaskDone[]
  events: PetEvent[]
  petPhotoUrls: Record<string, string>
}

/** Fallback while the query is still undefined. MODULE scope on purpose: as an
 *  inline `= { ... }` default it was rebuilt every render, so `done` arrived
 *  with a fresh identity each time and the effect below re-fired forever
 *  ("Maximum update depth exceeded"). Every memo keyed on this data was also
 *  recomputing on every render for the same reason. */
const EMPTY_DATA: Data = { pets: [], tasks: [], done: [], events: [], petPhotoUrls: {} }

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
  // Advances on foreground / at midnight — a render-time date would leave the
  // whole checklist scoring "done today" and "due" against the day the app was
  // last looked at. See useToday.
  const today = useToday()

  const [selectedPet, setSelectedPet] = useState<string | null>(null)
  // Which day the Today card shows — today by default, chevrons browse the past.
  const [selectedDay, setSelectedDay] = useState(todayISO())
  const [showPetForm, setShowPetForm] = useState(false)
  // Which section's editor is open (each pencil opens ONLY its own group).
  const [routineOpen, setRoutineOpen] = useState<'daily' | 'interval' | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)
  // Optimistic overlay for checklist taps, cleared when fresh data lands.
  const [overlay, setOverlay] = useState<Record<string, boolean>>({})
  // Routines whose Done was just tapped: the button shows done at once instead
  // of waiting on the insert AND the refetch (which read as a frozen app).
  // Cleared with the overlay when fresh data lands, or on failure.
  const [routineMarked, setRoutineMarked] = useState<Record<string, true>>({})
  const [toast, setToast] = useState<ToastData | null>(null)
  // The overdue sheet's contents as they were when it opened (null = closed).
  const [overdueSheet, setOverdueSheet] = useState<OverdueCare[] | null>(null)
  // ?overdue=1 arrives from a notification tap — on a fresh mount, or on this
  // screen already open. `seenOverdue` notices the param changing (adjusted
  // during render, not in an effect); `overduePending` waits for data.
  const { overdue: overdueParam } = useLocalSearchParams<{ overdue?: string }>()
  const [seenOverdue, setSeenOverdue] = useState<string | undefined>(undefined)
  const [overduePending, setOverduePending] = useState(false)
  if (overdueParam !== seenOverdue) {
    setSeenOverdue(overdueParam)
    if (overdueParam === '1') setOverduePending(true)
  }

  // The photo hero shrinks as the list scrolls up (JS-driven — it feeds a
  // height, which the native driver can't animate). Safe: the hero sits ABOVE
  // the vertical ScrollView, so resizing it can't disturb that scroll's offset.
  const scrollY = useRef(new Animated.Value(0)).current
  const collapse = scrollY.interpolate({ inputRange: [0, 160], outputRange: [0, 1], extrapolate: 'clamp' })

  const {
    data: { pets, tasks, done, events, petPhotoUrls } = EMPTY_DATA,
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

  // Fresh data replaces the optimistic overlay; so does browsing to another day.
  useEffect(() => {
    // Return prev when already empty so React bails out of the re-render — a
    // fresh `{}` is always a new reference and would keep the cycle alive on
    // its own if any dependency ever churns again.
    setOverlay((prev) => (Object.keys(prev).length ? {} : prev))
    setRoutineMarked((prev) => (Object.keys(prev).length ? {} : prev))
  }, [done, selectedDay])

  // useCachedQuery fetches on MOUNT only, so returning to this (still-mounted)
  // screen showed stale data. The other half of this — marking a task from the
  // Home Screen widget while the app sits backgrounded ON Pet Care — used to
  // need its own AppState listener here, because focus does NOT fire for
  // background→foreground; useCachedQuery now does that for every screen, so
  // adding one back would just fetch twice.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  // Keep the Today card on today when the date rolls over under an open app —
  // but only if that's what it was showing. Browsing back to an earlier day is
  // deliberate and must not be yanked forward.
  const prevToday = useRef(today)
  useEffect(() => {
    if (prevToday.current === today) return
    const was = prevToday.current
    prevToday.current = today
    setSelectedDay((d) => (d === was ? today : d))
  }, [today])

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
  // The pet's own colour (the same one its photo page uses) tints its cards.
  const petTint = pet ? petColor(pet, petsSorted.findIndex((p) => p.id === pet.id)) : c.accent
  const dockGap = useBottomGap(sp.xs)

  const checklist = useMemo(
    () => (pet ? dailyChecklist(tasks, done, pet.id, selectedDay) : []),
    [tasks, done, pet, selectedDay],
  )
  const routines = useMemo(
    () => (pet ? routineStatus(tasks, done, pet.id, today) : []),
    [tasks, done, pet, today],
  )
  const petTasks = useMemo(() => (pet ? tasks.filter((tk) => tk.pet_id === pet.id) : []), [tasks, pet])
  const history = useMemo(() => (pet ? events.filter((e) => e.pet_id === pet.id) : []), [events, pet])
  // The pet's events grouped into series ("Heartworm pill" ×5) for the Events
  // card; the open series is kept by KEY so it refreshes after an edit/delete.
  const series = useMemo(() => eventSeries(history), [history])
  const [seriesKey, setSeriesKey] = useState<string | null>(null)

  const openSeries = series.find((x) => x.key === seriesKey) ?? null
  /** Leave the history sheet, THEN act: two Modals can't be up at once on
   *  iOS (the second silently never presents). */
  const fromSeries = (fn: () => void) => {
    setSeriesKey(null)
    setTimeout(fn, 380)
  }

  /** This pet's events that carry a next-due date, soonest first. `events` is
   *  fetched newest-first, which is what latestPerKey (inside reminderEvents)
   *  needs to pick the current occurrence of each recurring treatment. */
  const dueEvents = useMemo(
    () => (pet ? reminderEvents(events.filter((e) => e.pet_id === pet.id)) : []),
    [events, pet],
  )

  /** The Care grid: interval routines + events carrying a next-due date, as
   *  one list, soonest first. The same name in both (a "Flea treatment"
   *  routine AND flea-treatment events with a next due) shows ONCE — the one
   *  due sooner — so the pet's care never reads twice. */
  const careItems = useMemo<CareItem[]>(() => {
    const norm = (x: string) => x.trim().replace(/\s+/g, ' ').toLowerCase()
    const items: CareItem[] = [
      ...routines.map(({ task, dueIn }) => ({
        kind: 'routine' as const,
        key: `r:${task.id}`,
        title: task.title,
        Icon: CARE_ICONS[task.icon] ?? PawPrint,
        color: petTint,
        interval: Math.max(1, task.interval_days ?? 1),
        dueIn,
        task,
      })),
      ...dueEvents.map((e) => {
        const gap = daysBetweenISO(e.event_date, e.next_due!)
        return {
          kind: 'event' as const,
          key: `e:${e.id}`,
          title: e.title,
          Icon: TYPE_ICON[e.type],
          color: TYPE_COLOR[e.type],
          interval: gap > 0 ? gap : null,
          dueIn: daysBetweenISO(today, e.next_due!),
          next: e.next_due!,
          event: e,
          seriesKey: `${e.pet_id}|${norm(e.title)}`,
        }
      }),
    ]
    const byName = new Map<string, CareItem>()
    for (const it of items) {
      const k = norm(it.title)
      const had = byName.get(k)
      if (!had || it.dueIn < had.dueIn) byName.set(k, it)
    }
    return [...byName.values()].sort((x, y) => x.dueIn - y.dueIn)
  }, [routines, dueEvents, today, petTint])

  /** Overdue count per pet — drives the red dot on the chips. Counts overdue
   *  EVENT reminders as well as routines: this screen only ever shows one pet,
   *  so without it a heartworm dose due on a pet you don't have selected is
   *  announced on the Hub and then invisible the moment you open Pet Care. */
  const overduePets = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of pets) {
      const routinesDue = routineStatus(tasks, done, p.id, today).filter(
        (r) => r.dueIn <= 0 && r.lastDone !== null,
      ).length
      const remindersDue = overdueEvents(
        events.filter((e) => e.pet_id === p.id),
        today,
      ).length
      map[p.id] = routinesDue + remindersDue
    }
    return map
  }, [pets, tasks, done, events, today])

  /** Everything due today or overdue, across all pets — the overdue sheet's
   *  live list (see OverdueSheet for why it also gets a snapshot). */
  const overdueNow = useMemo(
    () => overdueCare(pets.map((p) => p.id), tasks, done, events, today),
    [pets, tasks, done, events, today],
  )
  if (overduePending && !loading) {
    setOverduePending(false)
    // Nothing left to do (someone already handled it) → no sheet at all.
    if (overdueNow.length) setOverdueSheet(overdueNow)
  }

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
      const { error } = await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: selectedDay })
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
    if (routineMarked[task.id]) return
    setRoutineMarked((m) => ({ ...m, [task.id]: true }))
    const { error } = await supabase.from('pet_task_done').insert({ task_id: task.id, done_on: today })
    if (error && error.code !== '23505') {
      setRoutineMarked((m) => {
        const next = { ...m }
        delete next[task.id]
        return next
      })
      Alert.alert(t('pets.saveFailed'))
      return
    }
    track('petcare.task_done', { title: task.title, pet: petById[task.pet_id]?.name })
    afterMutation()
  }

  /** Done, from the overdue sheet — logged straight away, no form. A routine
   *  gets today's completion (exactly what its Done does on the screen). An
   *  event reminder gets a fresh entry dated today with the next due rolled
   *  forward by the interval the last one used — what "Mark done" + Save does
   *  via logAgain, minus the sheet. The old log's notes stay with it: they
   *  describe that visit, not this one. */
  async function completeOverdue(item: OverdueCare): Promise<boolean> {
    if (item.kind === 'routine') {
      const { error } = await supabase.from('pet_task_done').insert({ task_id: item.task.id, done_on: today })
      if (error && error.code !== '23505') {
        Alert.alert(t('pets.saveFailed'))
        return false
      }
      track('petcare.task_done', { title: item.title, pet: petById[item.petId]?.name, from: 'overdue' })
    } else {
      if (!profile) return false
      const ev = item.event
      const interval = ev.next_due ? daysBetweenISO(ev.event_date, ev.next_due) : 0
      const { error } = await supabase.from('pet_events').insert({
        pet_id: ev.pet_id,
        type: ev.type,
        title: ev.title,
        notes: null,
        event_date: today,
        next_due: interval > 0 ? addDaysISO(today, interval) : null,
        added_by: profile.email,
      })
      if (error) {
        Alert.alert(t('pets.saveFailed'))
        return false
      }
      track('pet.event_logged', { title: ev.title, kind: ev.type, from: 'overdue' })
    }
    afterMutation()
    return true
  }

  function closeOverdueSheet() {
    setOverdueSheet(null)
    // Drop the param so a later notification tap can open the sheet again.
    router.setParams({ overdue: undefined })
  }

  function dueText(dueIn: number): { text: string; color: string } {
    if (dueIn < 0) return { text: t('pets.overdue', { days: -dueIn }), color: c.expense }
    if (dueIn === 0) return { text: t('pets.dueToday'), color: c.accent }
    return { text: t('pets.inDays', { days: dueIn }), color: dueIn <= 3 ? c.accent : c.income }
  }

  /** A vet visit or a vaccine for the pet on screen — opens VisitForm (pet
   *  and type fixed). Give it a "next due" and it joins the Care grid. */
  function openNewEvent(type: PetEventType = 'vet') {
    setEditingEvent(null)
    setDraft({ ...emptyDraft, type, pet: selectedPet ?? pets[0]?.id ?? '', date: todayISO() })
    setShowEventForm(true)
  }

  /** "I did this again", from a due reminder. Opens the event sheet as a NEW
   *  entry copying the original (pet / type / title / notes) but dated today,
   *  with the next due rolled forward by the SAME interval the original used —
   *  so the common case is one tap plus Save, and an unusual gap is still
   *  editable before saving.
   *
   *  Nothing has to clear the old reminder: reminderEvents only ever considers
   *  the LATEST event per (pet, title), so saving this one retires the
   *  previous due date on its own and the old entry stays in history as the log
   *  it is. The flip side of that key: the title is what the series is matched
   *  on, so editing it in the sheet before saving starts a SEPARATE series and
   *  leaves the original reminder still overdue. */
  function logAgain(ev: PetEvent) {
    setEditingEvent(null)
    const interval = ev.next_due ? daysBetweenISO(ev.event_date, ev.next_due) : 0
    setDraft({
      pet: ev.pet_id,
      type: ev.type,
      title: ev.title,
      date: today,
      nextDue: interval > 0 ? addDaysISO(today, interval) : '',
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

  const hasPets = !loading && pets.length > 0
  const heroItems: HeroItem[] = petsSorted.map((p, i) => ({
    id: p.id,
    name: p.name,
    photo: petPhotoUrls[p.id],
    color: petColor(p, i),
    glyph: p.emoji || speciesEmoji(p.species),
    badge:
      (overduePets[p.id] ?? 0) > 0 ? (
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.expense, borderWidth: 1.5, borderColor: '#fff' }} />
      ) : null,
  }))
  return (
    // Top edge only without the hero: with it, the photo runs under the status
    // bar and PetHero pads its own controls by the inset.
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.bg }}
      edges={hasPets ? ['left', 'right'] : ['top', 'left', 'right']}
    >
      {!hasPets ? (
        <View style={{ paddingHorizontal: sp.lg }}>
          <AppHeader
            title={t('pets.title')}
            right={
              <Pressable
                onPress={() => setShowPetForm(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('pets.addPet')}
              >
                <Plus size={22} color={c.text} />
              </Pressable>
            }
          />
        </View>
      ) : null}

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
          <PhotoHero
            items={heroItems}
            selectedId={selectedPet}
            collapse={collapse}
            onSelect={(id) => {
              setSelectedPet(id)
              setSelectedDay(todayISO())
            }}
            onPressItem={(id) => router.push(`/pets/${id}`)}
            onAdd={() => setShowPetForm(true)}
            addLabel={t('pets.addPet')}
          />

        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingTop: 0, paddingBottom: sp.xl }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: false,
          })}
          scrollEventThrottle={16}
        >
          {pet ? (
            <>
              <TodayCard
                title={t('petcare.dailyRoutine')}
                tint={petTint}
                rows={checklist.map(({ task, done: d }) => ({
                  task,
                  done: d ?? null,
                  isDone: overlay[task.id] ?? !!d,
                  who: d ? `${nameFor(d.done_by)} · ${doneTime(d.created_at)}` : null,
                }))}
                dayLabel={
                  selectedDay === today
                    ? t('petcare.today')
                    : selectedDay === addDaysISO(today, -1)
                      ? t('pings.yesterday')
                      : formatDay(selectedDay)
                }
                isToday={selectedDay === today}
                canGoForward={selectedDay < today}
                onPrev={() => setSelectedDay(addDaysISO(selectedDay, -1))}
                onNext={() => setSelectedDay(addDaysISO(selectedDay, 1))}
                onToday={() => setSelectedDay(todayISO())}
                onToggle={(row) => void toggleDaily(row.task, row.done)}
                onEdit={() => setRoutineOpen('daily')}
                emptyText={t('petcare.noDaily')}
              />

              {/* Care: everything that repeats, routines and dated events alike. */}
              <CareGrid
                title={t('petcare.care')}
                items={careItems}
                marked={routineMarked}
                dueText={dueText}
                onDoneRoutine={(task) => void markRoutineDone(task)}
                onDoneEvent={logAgain}
                onOpenEvent={setSeriesKey}
                onEdit={() => setRoutineOpen('interval')}
                emptyText={t('petcare.noRoutines')}
              />

              {/* Events: one row per recurring thing; tap → its history. */}
              <EventsCard
                title={t('pets.events')}
                series={series}
                dueText={dueText}
                daysUntil={(iso) => daysBetweenISO(today, iso)}
                onOpen={(se) => setSeriesKey(se.key)}
              />
            </>
          ) : null}
        </Animated.ScrollView>
        {pet ? (
          // Log event, docked like the other apps' main action — on the
          // bottom button's curve (Btn curveBottom + half the inset).
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: dockGap }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <AddEventBtn
                side="left"
                tone={TYPE_COLOR.vet}
                icon={<Stethoscope size={18} color="#fff" />}
                label={t('pets.addVet')}
                onPress={() => openNewEvent('vet')}
              />
              <AddEventBtn
                side="right"
                tone={TYPE_COLOR.vaccine}
                icon={<Syringe size={18} color="#fff" />}
                label={t('pets.addVaccine')}
                onPress={() => openNewEvent('vaccine')}
              />
            </View>
          </View>
        ) : null}
        </>
      )}

      <Toast data={toast} />

      {openSeries ? (
        <EventSeriesSheet
          series={openSeries}
          dueText={dueText}
          daysUntil={(iso) => daysBetweenISO(today, iso)}
          onClose={() => setSeriesKey(null)}
          onEdit={(e) => fromSeries(() => openEditEvent(e))}
          onDelete={removeEvent}
          onLogAgain={(e) => fromSeries(() => logAgain(e))}
        />
      ) : null}

      {overdueSheet ? (
        <OverdueSheet
          items={overdueSheet}
          current={overdueNow}
          petById={petById}
          tintById={petColorMap(petsSorted)}
          onDone={completeOverdue}
          onClose={closeOverdueSheet}
        />
      ) : null}

      {showPetForm ? (
        <PetForm
          pet={null}
          onClose={() => setShowPetForm(false)}
          onSaved={(name) => {
            setShowPetForm(false)
            load()
            if (name) setToast({ emoji: '🐾', text: t('pets.savedToast', { name }) })
          }}
        />
      ) : null}

      {routineOpen && pet ? (
        <RoutineSheet
          pet={pet}
          tint={petTint}
          tasks={petTasks}
          section={routineOpen}
          onClose={() => setRoutineOpen(null)}
          onChanged={afterMutation}
        />
      ) : null}

      {/* A vet visit or a vaccine gets its own focused sheet (pet and type
          already known); any other type still opens the general form. */}
      {showEventForm && profile && (draft.type === 'vet' || draft.type === 'vaccine') && petById[draft.pet] ? (
        <VisitForm
          pet={petById[draft.pet]}
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
      ) : showEventForm && profile ? (
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

/** One of the two docked "add" buttons (vet visit / vaccine). The outer bottom
 *  corner follows the display's curve (useScreenCorner), like NewItemButton. */
function AddEventBtn({
  side,
  tone,
  icon,
  label,
  onPress,
}: {
  side: 'left' | 'right'
  /** The type's colour (vet blue, vaccine purple) — a solid gradient button. */
  tone: string
  icon: React.ReactNode
  label: string
  onPress: () => void
}) {
  const corner = useScreenCorner()
  const curve = corner?.radius ?? 16
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      <GradientBox
        colors={[tone, shade(tone, -0.2)]}
        radius={16}
        style={{
          height: 54,
          borderBottomLeftRadius: side === 'left' ? curve : 16,
          borderBottomRightRadius: side === 'right' ? curve : 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Plus size={16} color="#fff" strokeWidth={2.6} />
        {icon}
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: '#fff' }}>{label}</Txt>
      </GradientBox>
    </Pressable>
  )
}
