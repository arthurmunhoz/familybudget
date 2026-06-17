import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { addDaysISO, daysBetweenISO, formatDay, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { reminderEvents } from '../../lib/petCare'
import { supabase } from '../../lib/supabase'
import type { Pet, PetEvent, PetEventType } from '../../lib/types'
import PetForm from './PetForm'
import { ageInMonths, speciesEmoji } from './petMeta'

const TYPE_ICON: Record<PetEventType, string> = {
  vet: '🩺',
  vaccine: '💉',
  medication: '💊',
  grooming: '✂️',
  other: '📝',
}
const TYPES = Object.keys(TYPE_ICON) as PetEventType[]

export default function PetCare() {
  const back = useBack()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { profile } = useAuth()
  const [pets, setPets] = useState<Pet[]>([])
  const [events, setEvents] = useState<PetEvent[]>([])
  const [petPhotoUrls, setPetPhotoUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

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
  const [petFilter, setPetFilter] = useState<string>('all')

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
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrls(paths, 3600)
      const byPath = Object.fromEntries(
        (signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]),
      )
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

  const petById = useMemo(
    () => Object.fromEntries(pets.map((p) => [p.id, p])),
    [pets],
  )

  // Selecting a pet card filters the events below to that pet.
  const visible = useMemo(
    () => (petFilter === 'all' ? events : events.filter((e) => e.pet_id === petFilter)),
    [events, petFilter],
  )

  // Upcoming reminders (latest event per pet/type/title that has a due date).
  const reminders = useMemo(() => reminderEvents(visible), [visible])

  function dueLabel(due: string): { text: string; overdue: boolean } {
    const days = daysBetweenISO(todayISO(), due)
    if (days < 0) return { text: t('pets.overdue', { days: -days }), overdue: true }
    if (days === 0) return { text: t('pets.dueToday'), overdue: true }
    if (days <= 30) return { text: t('pets.inDays', { days }), overdue: false }
    return { text: formatDay(due), overdue: false }
  }

  function openForm() {
    setEditingEvent(null)
    setFPet(petFilter !== 'all' ? petFilter : (pets[0]?.id ?? ''))
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

  function openAddPet() {
    setShowPetForm(true)
  }

  function closePetForm() {
    setShowPetForm(false)
  }

  async function remove(event: PetEvent) {
    const pet = petById[event.pet_id]
    if (!confirm(t('pets.deleteConfirm', { title: event.title, pet: pet?.name ?? '' }))) return
    setEvents((list) => list.filter((e) => e.id !== event.id))
    await supabase.from('pet_events').delete().eq('id', event.id)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🐕 {t('pets.title')}</h1>
      </header>

      {/* pet carousel — tap a card to filter, circle icon opens the profile.
          pt/pb give the selected ring room (overflow-x clips vertically too)
          and a gap so cards aren't tucked under the sticky header. */}
      {pets.length > 0 && (
        <div className="-mx-4 mb-4 flex gap-3 overflow-x-auto px-4 pt-2 pb-2">
          {pets.map((p) => {
            const m = p.birthday ? ageInMonths(p.birthday, todayISO()) : null
            const age =
              m == null || m < 0
                ? null
                : m < 12
                  ? t('pets.ageMo', { months: m })
                  : t('pets.ageY', { years: Math.floor(m / 12) })
            const sub = [
              p.species ? t(`pets.species.${p.species}` as TKey) : null,
              p.breed,
            ]
              .filter(Boolean)
              .join(' · ')
            const selected = petFilter === p.id
            return (
              <div
                key={p.id}
                className={`relative w-36 shrink-0 overflow-hidden rounded-2xl bg-(--card) ${
                  selected ? 'ring-2 ring-(--accent)' : ''
                }`}
              >
                <button
                  onClick={() => setPetFilter(selected ? 'all' : p.id)}
                  className="block w-full text-left"
                >
                  <div className="flex h-24 w-full items-center justify-center overflow-hidden bg-(--surface) text-5xl">
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
                  <div className="p-3">
                    <p className="truncate font-bold text-(--text)">{p.name}</p>
                    {sub && <p className="truncate text-xs text-(--text-faint)">{sub}</p>}
                    {age && <p className="text-xs text-(--text-muted)">{age}</p>}
                  </div>
                </button>
                {/* opens the pet's profile/details page */}
                <button
                  onClick={() => navigate(`/pets/${p.id}`)}
                  aria-label={`${t('pets.details')}: ${p.name}`}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-xs text-white backdrop-blur active:bg-black/65"
                >
                  ✎
                </button>
              </div>
            )
          })}
          {/* add-pet card */}
          <button
            onClick={openAddPet}
            className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-(--surface-2) py-3 text-(--text-faint) active:bg-(--surface)"
          >
            <span className="text-2xl">＋</span>
            <span className="text-xs font-semibold">{t('pets.addPet')}</span>
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : (
        <>
          {reminders.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {t('pets.comingUp')}
              </h3>
              <ul className="space-y-2">
                {reminders.map((e) => {
                  const due = dueLabel(e.next_due!)
                  return (
                    <li
                      key={e.id}
                      className={`flex cursor-default items-center gap-3 rounded-lg border-l-4 bg-(--surface) py-2.5 pl-3 pr-3 ${
                        due.overdue
                          ? 'animate-attention border-(--expense)'
                          : 'border-(--accent)'
                      }`}
                    >
                      <span className="text-xl">{TYPE_ICON[e.type]}</span>
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
                            className="rounded-full bg-(--accent) px-3 py-1 text-xs font-bold text-white transition-transform active:scale-95"
                          >
                            ✓ {t('pets.markDone')}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {pets.length === 0 ? (
            <div className="mt-16 text-center text-(--text-muted)">
              <div className="text-5xl">🐾</div>
              <p className="mt-4">{t('pets.noPets')}</p>
              <p className="text-sm text-(--text-faint)">{t('pets.noPetsHint')}</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="mt-16 text-center text-(--text-muted)">
              <div className="text-5xl">🐾</div>
              <p className="mt-4">{t('pets.noEvents')}</p>
              <p className="text-sm text-(--text-faint)">{t('pets.noEventsHint')}</p>
            </div>
          ) : (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {t('pets.history')}
              </h3>
              <ul className="space-y-2">
                {visible.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 rounded-xl bg-(--card) px-4 py-3"
                  >
                    <button
                      onClick={() => openEditForm(e)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <span className="text-xl">{TYPE_ICON[e.type]}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-(--text)">{e.title}</p>
                        <p className="text-xs text-(--text-faint)">
                          {petById[e.pet_id]?.emoji} {petById[e.pet_id]?.name} ·{' '}
                          {formatDay(e.event_date)}
                          {e.next_due && ` · ${t('pets.next')} ${formatDay(e.next_due)}`}
                        </p>
                        {e.notes && (
                          <p className="mt-1 text-sm text-(--text-muted)">{e.notes}</p>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={() => remove(e)}
                      aria-label={t('common.deleteName', { name: e.title })}
                      className="px-1 text-(--text-faint) active:text-(--expense)"
                    >
                      ✕
                    </button>
                  </li>
                ))}
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
                ✕
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
              {TYPES.map((ty) => (
                <FilterChip key={ty} active={fType === ty} onClick={() => setFType(ty)}>
                  {TYPE_ICON[ty]} {t(`pets.type.${ty}` as TKey)}
                </FilterChip>
              ))}
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
          onClose={closePetForm}
          onSaved={() => {
            closePetForm()
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
