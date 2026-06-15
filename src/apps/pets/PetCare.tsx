import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { daysBetweenISO, formatDay, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { reminderEvents } from '../../lib/petCare'
import { supabase } from '../../lib/supabase'
import type { Pet, PetEvent, PetEventType } from '../../lib/types'

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
  const { t } = useI18n()
  const { profile } = useAuth()
  const [pets, setPets] = useState<Pet[]>([])
  const [events, setEvents] = useState<PetEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [petFilter, setPetFilter] = useState<string>('all')

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
  const [pName, setPName] = useState('')
  const [pEmoji, setPEmoji] = useState('🐶')
  const [savingPet, setSavingPet] = useState(false)
  const [editingPet, setEditingPet] = useState<Pet | null>(null)
  const [showManagePets, setShowManagePets] = useState(false)

  // Lock the page behind any open sheet so it can't be dragged.
  useScrollLock(showForm || showPetForm || showManagePets)

  const load = useCallback(async () => {
    const [petsRes, eventsRes] = await Promise.all([
      supabase.from('pets').select('*').order('name'),
      supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
    ])
    setPets(petsRes.data ?? [])
    setEvents(eventsRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const petById = useMemo(
    () => Object.fromEntries(pets.map((p) => [p.id, p])),
    [pets],
  )

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
    setEditingPet(null)
    setPName('')
    setPEmoji('🐶')
    setShowManagePets(false)
    setShowPetForm(true)
  }

  function openEditPet(p: Pet) {
    setEditingPet(p)
    setPName(p.name)
    setPEmoji(p.emoji)
    setShowManagePets(false)
    setShowPetForm(true)
  }

  function closePetForm() {
    setShowPetForm(false)
    setEditingPet(null)
  }

  async function savePet() {
    if (!pName.trim() || savingPet) return
    setSavingPet(true)
    const fields = { name: pName.trim(), emoji: pEmoji.trim() || '🐶' }
    const { error } = editingPet
      ? await supabase.from('pets').update(fields).eq('id', editingPet.id)
      : await supabase.from('pets').insert(fields)
    setSavingPet(false)
    if (error) {
      alert(t('pets.addPetFailed'))
      return
    }
    closePetForm()
    setPName('')
    setPEmoji('🐶')
    load()
  }

  async function deletePet(p: Pet) {
    // Deleting a pet cascades to all of its events (DB on delete cascade).
    if (!confirm(t('pets.deletePetConfirm', { name: p.name }))) return
    const { error } = await supabase.from('pets').delete().eq('id', p.id)
    if (error) {
      alert(t('pets.deletePetFailed'))
      return
    }
    if (petFilter === p.id) setPetFilter('all')
    load()
  }

  async function remove(event: PetEvent) {
    const pet = petById[event.pet_id]
    if (!confirm(t('pets.deleteConfirm', { title: event.title, pet: pet?.name ?? '' }))) return
    setEvents((list) => list.filter((e) => e.id !== event.id))
    await supabase.from('pet_events').delete().eq('id', event.id)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 flex items-center gap-2 bg-(--bg) px-4 pt-6 pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🐕 {t('pets.title')}</h1>
        {pets.length > 0 && (
          <button
            onClick={() => setShowManagePets(true)}
            aria-label={t('pets.managePets')}
            className="rounded-lg px-2 py-2 text-(--text-muted) active:text-(--text)"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </header>

      {/* pet filter */}
      <div className="flex gap-2 pb-4">
        <FilterChip active={petFilter === 'all'} onClick={() => setPetFilter('all')}>
          {t('pets.all')}
        </FilterChip>
        {pets.map((p) => (
          <FilterChip
            key={p.id}
            active={petFilter === p.id}
            onClick={() => setPetFilter(p.id)}
          >
            {p.emoji} {p.name}
          </FilterChip>
        ))}
        <FilterChip active={false} onClick={openAddPet}>
          +
        </FilterChip>
      </div>

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
                      className={`flex items-center gap-3 rounded-xl bg-(--card) px-4 py-3 ${
                        due.overdue ? 'animate-attention' : ''
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
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          due.overdue
                            ? 'bg-(--expense) text-white'
                            : 'bg-(--surface) text-(--text-muted)'
                        }`}
                      >
                        {due.text}
                      </span>
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

      {/* add pet sheet */}
      {showPetForm && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50"
          onClick={closePetForm}
        >
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">
                {editingPet ? t('pets.editPet') : t('pets.addPet')}
              </h2>
              <button
                onClick={closePetForm}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
            <div className="flex gap-3">
              <input
                value={pEmoji}
                onChange={(e) => setPEmoji(e.target.value)}
                aria-label={t('pets.petEmoji')}
                className="w-16 rounded-xl bg-(--surface) px-0 py-3 text-center text-xl outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder={t('pets.namePlaceholder')}
                className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </div>
            </div>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={savePet}
                disabled={!pName.trim() || savingPet}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {savingPet
                  ? t('common.saving')
                  : editingPet
                    ? t('common.saveChanges')
                    : t('pets.addPet')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* manage pets sheet — household members add/edit/delete pets */}
      {showManagePets && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50"
          onClick={() => setShowManagePets(false)}
        >
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">{t('pets.managePets')}</h2>
              <button
                onClick={() => setShowManagePets(false)}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
              </button>
            </div>

            <ul className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-2">
              {pets.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl bg-(--surface) px-4 py-3"
                >
                  <span className="text-xl">{p.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-(--text)">
                    {p.name}
                  </span>
                  <button
                    onClick={() => openEditPet(p)}
                    aria-label={t('common.editName', { name: p.name })}
                    className="px-1 text-(--text-faint) active:text-(--accent)"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => deletePet(p)}
                    aria-label={t('common.deleteName', { name: p.name })}
                    className="px-1 text-(--text-faint) active:text-(--expense)"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={openAddPet}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform"
              >
                {t('pets.addPetBtn')}
              </button>
            </div>
          </div>
        </div>
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
