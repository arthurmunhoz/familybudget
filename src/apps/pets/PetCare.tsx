// Pet Care — a per-pet view. Top: a horizontal carousel to pick a pet (each in
// its calendar color). Below: the selected pet's info card, with a calendar-color
// swatch picker and an Edit button. Below that: a month calendar showing EVERY
// pet's events as small per-pet colored dots (tap a day to see it), then the
// upcoming reminders sorted by soonest, with a "done again" re-log on overdue.
// The bottom bar adds an event (or the first pet). Pet + event add/edit are
// bottom-sheet modals.
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  PawPrint,
  Pencil,
  Pill,
  Plus,
  Scissors,
  Stethoscope,
  Syringe,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { addDaysISO, daysBetweenISO, formatDay, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { reminderEvents } from '../../lib/petCare'
import { getSignedUrls } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import type { Pet, PetEvent, PetEventType } from '../../lib/types'
import PetForm from './PetForm'
import { ageInMonths, speciesEmoji } from './petMeta'
import { PET_PALETTE, petColorMap } from './petColors'

const TYPE_ICON: Record<PetEventType, LucideIcon> = {
  vet: Stethoscope,
  vaccine: Syringe,
  medication: Pill,
  grooming: Scissors,
  other: FileText,
}
const TYPES = Object.keys(TYPE_ICON) as PetEventType[]

const pad = (n: number) => String(n).padStart(2, '0')

export default function PetCare() {
  const back = useBack()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const locale = lang === 'en' ? 'en-US' : lang === 'es' ? 'es' : 'pt-BR'
  const today = todayISO()

  const [pets, setPets] = useState<Pet[]>([])
  const [events, setEvents] = useState<PetEvent[]>([])
  const [petPhotoUrls, setPetPhotoUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const [selectedPet, setSelectedPet] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(today)
  const [view, setView] = useState(() => {
    const [y, m] = today.split('-').map(Number)
    return { y, m } // m is 1-indexed
  })
  const [savingColor, setSavingColor] = useState(false)
  const [colorMenuOpen, setColorMenuOpen] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [fPet, setFPet] = useState('')
  const [fType, setFType] = useState<PetEventType>('medication')
  const [fTitle, setFTitle] = useState('')
  const [fDate, setFDate] = useState(todayISO())
  const [fNextDue, setFNextDue] = useState('')
  const [fNotes, setFNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)

  const [showPetForm, setShowPetForm] = useState(false)

  // PetForm self-locks while open; lock for the event sheet here.
  useScrollLock(showForm)

  const load = useCallback(async () => {
    const [petsRes, eventsRes] = await Promise.all([
      supabase.from('pets').select('*').order('name'),
      supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    ])
    const petRows = (petsRes.data ?? []) as Pet[]
    setPets(petRows)
    setEvents(eventsRes.data ?? [])
    // Sign carousel photos so the household can see each pet's picture.
    const paths = petRows.map((p) => p.photo_path).filter(Boolean) as string[]
    if (paths.length) {
      const byPath = await getSignedUrls(paths)
      setPetPhotoUrls(
        Object.fromEntries(
          petRows
            .filter((p) => p.photo_path && byPath[p.photo_path])
            .map((p) => [p.id, byPath[p.photo_path as string]]),
        ),
      )
    } else {
      setPetPhotoUrls({})
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  function openForm() {
    setEditingEvent(null)
    setFPet(selectedPet ?? pets[0]?.id ?? '')
    setFType('medication')
    setFTitle('')
    setFDate(todayISO())
    setFNextDue('')
    setFNotes('')
    setShowForm(true)
  }

  /** "I did this again" from an overdue reminder: open the event sheet as a NEW
   *  entry, copying the original (pet/type/title/notes) but dated today. The
   *  next-due is pre-filled by repeating the prior interval (last done → its due
   *  date), so saving rolls the reminder forward; the user can still adjust it. */
  function logAgain(ev: PetEvent) {
    setEditingEvent(null)
    setFPet(ev.pet_id)
    setFType(ev.type)
    setFTitle(ev.title)
    setFDate(todayISO())
    const interval = ev.next_due ? daysBetweenISO(ev.event_date, ev.next_due) : 0
    setFNextDue(interval > 0 ? addDaysISO(todayISO(), interval) : '')
    setFNotes(ev.notes ?? '')
    setShowForm(true)
  }

  function openEditForm(ev: PetEvent) {
    setEditingEvent(ev)
    setFPet(ev.pet_id)
    setFType(ev.type)
    setFTitle(ev.title)
    setFDate(ev.event_date)
    setFNextDue(ev.next_due ?? '')
    setFNotes(ev.notes ?? '')
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingEvent(null)
  }

  async function save() {
    if (!fTitle.trim() || !fPet || !profile || saving) return
    setSaving(true)
    const fields = {
      pet_id: fPet,
      type: fType,
      title: fTitle.trim(),
      notes: fNotes.trim() || null,
      event_date: fDate,
      next_due: fNextDue || null,
    }
    const { error } = editingEvent
      ? await supabase.from('pet_events').update(fields).eq('id', editingEvent.id)
      : await supabase.from('pet_events').insert({ ...fields, added_by: profile.email })
    setSaving(false)
    if (error) {
      alert(t('pets.saveFailed'))
      return
    }
    closeForm()
    load()
  }

  async function remove(event: PetEvent) {
    const pet = petById[event.pet_id]
    if (!confirm(t('pets.deleteConfirm', { title: event.title, pet: pet?.name ?? '' }))) return
    setEvents((list) => list.filter((e) => e.id !== event.id))
    await supabase.from('pet_events').delete().eq('id', event.id)
  }

  async function setPetColor(hex: string) {
    if (!selPet || savingColor) return
    setSavingColor(true)
    await supabase.from('pets').update({ tag_color: hex }).eq('id', selPet.id)
    setSavingColor(false)
    setColorMenuOpen(false)
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
  const selPetColor = selPet ? colorMap[selPet.id] : undefined

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex flex-1 items-center gap-2 font-display text-2xl font-bold text-(--text)">
          <PawPrint size={22} strokeWidth={2} aria-hidden="true" className="text-(--accent)" />
          {t('pets.title')}
        </h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : pets.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <PawPrint size={40} aria-hidden="true" className="text-(--text-faint)" />
          </div>
          <p className="mt-4">{t('pets.noPets')}</p>
          <p className="text-sm text-(--text-faint)">{t('pets.noPetsHint')}</p>
        </div>
      ) : (
        <>
          {/* pet selector carousel */}
          <div className="-mx-4 mb-4 flex gap-3 overflow-x-auto px-4 pt-2 pb-2">
            {petsSorted.map((p) => {
              const selected = selectedPet === p.id
              const dot = colorMap[p.id]
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPet(p.id)}
                  className="w-24 shrink-0 overflow-hidden rounded-2xl bg-(--card) text-left"
                  style={{ border: `2px solid ${selected ? dot : 'transparent'}` }}
                >
                  <div className="flex h-18 w-full items-center justify-center overflow-hidden bg-(--surface) text-3xl">
                    {petPhotoUrls[p.id] ? (
                      <img
                        src={petPhotoUrls[p.id]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{p.emoji || speciesEmoji(p.species)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 p-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: dot }}
                      aria-hidden="true"
                    />
                    <p className="truncate text-xs font-semibold text-(--text)">{p.name}</p>
                  </div>
                </button>
              )
            })}
            {/* add-pet card */}
            <button
              onClick={() => setShowPetForm(true)}
              className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-(--surface-2) py-3 text-(--text-faint) active:bg-(--surface)"
            >
              <Plus size={22} strokeWidth={2} aria-hidden="true" />
              <span className="text-[11px] font-semibold">{t('pets.addPet')}</span>
            </button>
          </div>

          {/* selected pet info card */}
          {selPet && (
            <section className="mb-4 rounded-2xl bg-(--card) p-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-2xl"
                  style={{ border: `2px solid ${selPetColor}` }}
                >
                  {petPhotoUrls[selPet.id] ? (
                    <img src={petPhotoUrls[selPet.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span>{selPet.emoji || speciesEmoji(selPet.species)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-bold text-(--text)">{selPet.name}</p>
                  {info[0] && (
                    <p className="truncate text-sm text-(--text-faint)">
                      {[
                        selPet.species ? t(`pets.species.${selPet.species}` as TKey) : null,
                        selPet.breed,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/pets/${selPet.id}`)}
                  aria-label={t('pets.edit')}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text) active:bg-(--surface-2)"
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                  {t('pets.edit')}
                </button>
              </div>

              {info.length > 0 && (
                <dl className="mt-3 space-y-1.5 border-t border-(--border) pt-3">
                  {info.map((it) => (
                    <div key={it.label} className="flex items-baseline gap-3 text-sm">
                      <dt className="w-24 shrink-0 text-(--text-faint)">{it.label}</dt>
                      <dd className="min-w-0 flex-1 break-words text-(--text)">{it.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* calendar color — a dropdown that shows only the selected swatch */}
              <div className="relative mt-3 flex items-center justify-between border-t border-(--border) pt-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                  {t('pets.tagColor')}
                </span>
                <button
                  onClick={() => setColorMenuOpen((v) => !v)}
                  disabled={savingColor}
                  aria-label={selPetColor}
                  className="flex items-center gap-2 rounded-full bg-(--surface) px-3 py-2 disabled:opacity-50"
                >
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{ background: selPetColor }}
                    aria-hidden="true"
                  />
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    className={`text-(--text-muted) transition-transform ${colorMenuOpen ? 'rotate-90' : ''}`}
                  />
                </button>
                {colorMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setColorMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-2 flex w-42 flex-wrap gap-2.5 rounded-xl border border-(--border) bg-(--card) p-3 shadow-lg">
                      {PET_PALETTE.map((hex) => {
                        const active = selPetColor?.toLowerCase() === hex.toLowerCase()
                        return (
                          <button
                            key={hex}
                            onClick={() => setPetColor(hex)}
                            aria-label={hex}
                            className="flex h-7 w-7 items-center justify-center rounded-full"
                            style={{
                              background: hex,
                              border: active ? '2px solid var(--text)' : 'none',
                            }}
                          >
                            {active && <Check size={15} strokeWidth={3} className="text-white" aria-hidden="true" />}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {/* calendar of ALL pets' events */}
          <section className="mb-4 rounded-2xl bg-(--card) p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <button
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="rounded-lg p-1.5 text-(--text-muted) active:text-(--text)"
              >
                <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="font-display text-base font-semibold capitalize text-(--text)">
                {monthLabel}
              </span>
              <button
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="rounded-lg p-1.5 text-(--text-muted) active:text-(--text)"
              >
                <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((w, i) => (
                <div
                  key={i}
                  className="pb-1 text-center text-[11px] font-semibold text-(--text-faint)"
                >
                  {w}
                </div>
              ))}
              {cells.map((day, i) => {
                if (day === null) return <div key={`b${i}`} />
                const dateStr = `${view.y}-${pad(view.m)}-${pad(day)}`
                const colorsSet = new Set<string>()
                for (const e of eventsByDay.get(dateStr) ?? []) colorsSet.add(colorMap[e.pet_id])
                for (const e of dueByDay.get(dateStr) ?? []) colorsSet.add(colorMap[e.pet_id])
                const dots = [...colorsSet].slice(0, 3)
                const isToday = dateStr === today
                const isSelected = dateStr === selectedDay
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(dateStr)}
                    aria-label={dateStr}
                    className="flex flex-col items-center py-0.5 active:scale-95 transition-transform"
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                        isSelected
                          ? 'bg-(--accent) font-semibold text-white'
                          : isToday
                            ? 'font-bold text-(--accent) ring-1 ring-(--accent)'
                            : 'text-(--text)'
                      }`}
                    >
                      {day}
                    </span>
                    <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                      {dots.map((color, j) => (
                        <span
                          key={j}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: color }}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* selected day's events */}
            <div className="mt-2 space-y-2 border-t border-(--border) pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {formatDay(selectedDay)}
              </p>
              {dayEvents.length === 0 && dayDue.length === 0 ? (
                <p className="text-sm text-(--text-faint)">{t('pets.noDayEvents')}</p>
              ) : (
                <ul className="space-y-2">
                  {dayEvents.map((e) => {
                    const Icon = TYPE_ICON[e.type]
                    const pet = petById[e.pet_id]
                    return (
                      <li key={e.id}>
                        <button
                          onClick={() => openEditForm(e)}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: colorMap[e.pet_id] }}
                            aria-hidden="true"
                          />
                          <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-(--text-muted)" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-(--text)">{e.title}</p>
                            <p className="truncate text-xs text-(--text-faint)">
                              {pet?.emoji} {pet?.name}
                            </p>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                  {dayDue.map((e) => {
                    const Icon = TYPE_ICON[e.type]
                    const pet = petById[e.pet_id]
                    return (
                      <li key={`due-${e.id}`}>
                        <button
                          onClick={() => openEditForm(e)}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          {/* hollow dot = upcoming due (vs a filled dot = logged) */}
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ border: `1.5px solid ${colorMap[e.pet_id]}` }}
                            aria-hidden="true"
                          />
                          <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-(--text-muted)" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-(--text)">{e.title}</p>
                            <p className="truncate text-xs text-(--text-faint)">
                              {pet?.emoji} {pet?.name}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-bold text-(--accent)">
                            {t('pets.dueMarker')}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* upcoming reminders (all pets) */}
          {upcoming.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {t('pets.comingUp')}
              </h3>
              <ul className="space-y-2">
                {upcoming.map((e) => {
                  const due = dueLabel(e.next_due!)
                  const TypeIcon = TYPE_ICON[e.type]
                  return (
                    <li
                      key={e.id}
                      className="flex cursor-default items-center gap-3 rounded-lg border-l-4 bg-(--surface) py-2.5 pl-3 pr-3"
                      style={{ borderLeftColor: colorMap[e.pet_id] }}
                    >
                      <TypeIcon size={20} strokeWidth={2} aria-hidden="true" className="shrink-0 text-(--text-muted)" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-(--text)">{e.title}</p>
                        <p className="text-xs text-(--text-faint)">
                          {petById[e.pet_id]?.emoji} {petById[e.pet_id]?.name} ·{' '}
                          {t('pets.lastDone')} {formatDay(e.event_date)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            due.overdue
                              ? 'bg-(--expense) text-white'
                              : 'bg-(--card) text-(--text-muted)'
                          }`}
                        >
                          {due.text}
                        </span>
                        {due.overdue && (
                          <button
                            onClick={() => logAgain(e)}
                            className="flex items-center gap-1 rounded-full bg-(--accent) px-3 py-1 text-xs font-bold text-white transition-transform active:scale-95"
                          >
                            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
                            {t('pets.markDone')}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {/* new event button / form */}
      {showForm ? (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={closeForm}>
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">
                {editingEvent ? t('pets.editEvent') : t('pets.newEvent')}
              </h2>
              <button
                onClick={closeForm}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
            <label className="block text-xs font-semibold text-(--text-faint)">
              {t('pets.pet')}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {pets.map((p) => (
                <FilterChip key={p.id} active={fPet === p.id} onClick={() => setFPet(p.id)}>
                  {p.emoji} {p.name}
                </FilterChip>
              ))}
            </div>

            <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
              {t('pets.typeLabel')}
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {TYPES.map((ty) => {
                const TypeIcon = TYPE_ICON[ty]
                return (
                  <FilterChip key={ty} active={fType === ty} onClick={() => setFType(ty)}>
                    <span className="flex items-center gap-1.5">
                      <TypeIcon size={16} strokeWidth={2} aria-hidden="true" />
                      {t(`pets.type.${ty}` as TKey)}
                    </span>
                  </FilterChip>
                )
              })}
            </div>

            <input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              placeholder={
                fType === 'medication'
                  ? t('pets.titleMedPlaceholder')
                  : t('pets.titlePlaceholder')
              }
              className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            {/* Grid (not flex): grid-cols-2 = minmax(0,1fr) columns that shrink
               to fit, so the native date inputs can't force horizontal overflow. */}
            <div className="mt-3 grid grid-cols-2 gap-4">
              <label className="block min-w-0 text-xs font-semibold text-(--text-faint)">
                {t('pets.date')}
                <input
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                  className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
              <label className="block min-w-0 text-xs font-semibold text-(--text-faint)">
                {t('pets.nextDue')}
                <input
                  type="date"
                  value={fNextDue}
                  onChange={(e) => setFNextDue(e.target.value)}
                  className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
            </div>

            <input
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
              placeholder={t('pets.notesPlaceholder')}
              className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            </div>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={save}
                disabled={!fTitle.trim() || !fPet || saving}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {saving
                  ? t('common.saving')
                  : editingEvent
                    ? t('common.saveChanges')
                    : t('pets.saveEvent')}
              </button>

              {editingEvent && (
                <button
                  onClick={() => {
                    const ev = editingEvent
                    closeForm()
                    remove(ev)
                  }}
                  disabled={saving}
                  className="mt-3 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-rose-400/10"
                >
                  {t('pets.deleteEvent')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          <button
            onClick={() => (pets.length === 0 ? setShowPetForm(true) : openForm())}
            className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
          >
            {pets.length === 0 ? t('pets.addPetBtn') : t('pets.newEventBtn')}
          </button>
        </div>
      )}

      {/* add / edit pet sheet (shared with the pet profile page) */}
      {showPetForm && (
        <PetForm
          pet={null}
          onClose={() => setShowPetForm(false)}
          onSaved={() => {
            setShowPetForm(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        active ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
      }`}
    >
      {children}
    </button>
  )
}
