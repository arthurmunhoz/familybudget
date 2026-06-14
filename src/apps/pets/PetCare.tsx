import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { daysBetweenISO, formatDay, todayISO } from '../../lib/format'
import { reminderEvents } from '../../lib/petCare'
import { supabase } from '../../lib/supabase'
import type { Pet, PetEvent, PetEventType } from '../../lib/types'

const TYPE_META: Record<PetEventType, { icon: string; label: string }> = {
  vet: { icon: '🩺', label: 'Vet' },
  vaccine: { icon: '💉', label: 'Vaccine' },
  medication: { icon: '💊', label: 'Meds' },
  grooming: { icon: '✂️', label: 'Grooming' },
  other: { icon: '📝', label: 'Other' },
}
const TYPES = Object.keys(TYPE_META) as PetEventType[]

export default function PetCare() {
  const back = useBack()
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

  const [showPetForm, setShowPetForm] = useState(false)
  const [pName, setPName] = useState('')
  const [pEmoji, setPEmoji] = useState('🐶')
  const [savingPet, setSavingPet] = useState(false)

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
    if (days < 0) return { text: `overdue ${-days}d`, overdue: true }
    if (days === 0) return { text: 'due today', overdue: true }
    if (days <= 30) return { text: `in ${days}d`, overdue: false }
    return { text: formatDay(due), overdue: false }
  }

  function openForm() {
    setFPet(petFilter !== 'all' ? petFilter : (pets[0]?.id ?? ''))
    setFType('medication')
    setFTitle('')
    setFDate(todayISO())
    setFNextDue('')
    setFNotes('')
    setShowForm(true)
  }

  async function save() {
    if (!fTitle.trim() || !fPet || !profile || saving) return
    setSaving(true)
    const { error } = await supabase.from('pet_events').insert({
      pet_id: fPet,
      type: fType,
      title: fTitle.trim(),
      notes: fNotes.trim() || null,
      event_date: fDate,
      next_due: fNextDue || null,
      added_by: profile.email,
    })
    setSaving(false)
    if (error) {
      alert('Could not save the event — please try again.')
      return
    }
    setShowForm(false)
    load()
  }

  async function savePet() {
    if (!pName.trim() || savingPet) return
    setSavingPet(true)
    const { error } = await supabase
      .from('pets')
      .insert({ name: pName.trim(), emoji: pEmoji.trim() || '🐶' })
    setSavingPet(false)
    if (error) {
      alert('Could not add the pet — please try again.')
      return
    }
    setShowPetForm(false)
    setPName('')
    setPEmoji('🐶')
    load()
  }

  async function remove(event: PetEvent) {
    const pet = petById[event.pet_id]
    if (!confirm(`Delete "${event.title}" for ${pet?.name ?? 'this pet'}?`)) return
    setEvents((list) => list.filter((e) => e.id !== event.id))
    await supabase.from('pet_events').delete().eq('id', event.id)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🐕 Pet Care</h1>
      </header>

      {/* pet filter */}
      <div className="flex gap-2 pb-4">
        <FilterChip active={petFilter === 'all'} onClick={() => setPetFilter('all')}>
          All
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
        <FilterChip active={false} onClick={() => setShowPetForm(true)}>
          +
        </FilterChip>
      </div>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : (
        <>
          {reminders.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                Coming up
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
                      <span className="text-xl">{TYPE_META[e.type].icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-(--text)">{e.title}</p>
                        <p className="text-xs text-(--text-faint)">
                          {petById[e.pet_id]?.emoji} {petById[e.pet_id]?.name} · last{' '}
                          {formatDay(e.event_date)}
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
              <p className="mt-4">No pets yet.</p>
              <p className="text-sm text-(--text-faint)">
                Add your pets with the + above, then start logging vet visits,
                vaccines and meds.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="mt-16 text-center text-(--text-muted)">
              <div className="text-5xl">🐾</div>
              <p className="mt-4">No events yet.</p>
              <p className="text-sm text-(--text-faint)">
                Log vet visits, vaccines and meds — set a “next due” date to get
                reminders here.
              </p>
            </div>
          ) : (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                History
              </h3>
              <ul className="space-y-2">
                {visible.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 rounded-xl bg-(--card) px-4 py-3"
                  >
                    <span className="text-xl">{TYPE_META[e.type].icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-(--text)">{e.title}</p>
                      <p className="text-xs text-(--text-faint)">
                        {petById[e.pet_id]?.emoji} {petById[e.pet_id]?.name} ·{' '}
                        {formatDay(e.event_date)}
                        {e.next_due && ` · next ${formatDay(e.next_due)}`}
                      </p>
                      {e.notes && (
                        <p className="mt-1 text-sm text-(--text-muted)">{e.notes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => remove(e)}
                      aria-label={`Delete ${e.title}`}
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
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={() => setShowForm(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-(--card) px-4 pt-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-(--text)">New event</h2>
              <button
                onClick={() => setShowForm(false)}
                aria-label="Close"
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
              </button>
            </div>

            <label className="block text-xs font-semibold text-(--text-faint)">Pet</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {pets.map((p) => (
                <FilterChip key={p.id} active={fPet === p.id} onClick={() => setFPet(p.id)}>
                  {p.emoji} {p.name}
                </FilterChip>
              ))}
            </div>

            <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
              Type
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <FilterChip key={t} active={fType === t} onClick={() => setFType(t)}>
                  {TYPE_META[t].icon} {TYPE_META[t].label}
                </FilterChip>
              ))}
            </div>

            <input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              placeholder={fType === 'medication' ? 'e.g. Heartworm pill' : 'What happened?'}
              className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            <div className="mt-3 flex gap-5">
              <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                Date
                <input
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                  className="mt-1 h-12 w-full rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
              <label className="flex-1 text-xs font-semibold text-(--text-faint)">
                Next due (optional)
                <input
                  type="date"
                  value={fNextDue}
                  onChange={(e) => setFNextDue(e.target.value)}
                  className="mt-1 h-12 w-full rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
            </div>

            <input
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="mt-3 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            <button
              onClick={save}
              disabled={!fTitle.trim() || !fPet || saving}
              className="mt-4 w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save event'}
            </button>
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
            {pets.length === 0 ? '+ Add pet' : '+ New event'}
          </button>
        </div>
      )}

      {/* add pet sheet */}
      {showPetForm && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50"
          onClick={() => setShowPetForm(false)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-(--card) px-4 pt-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-(--text)">Add pet</h2>
              <button
                onClick={() => setShowPetForm(false)}
                aria-label="Close"
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-3">
              <input
                value={pEmoji}
                onChange={(e) => setPEmoji(e.target.value)}
                aria-label="Pet emoji"
                className="w-16 rounded-xl bg-(--surface) px-0 py-3 text-center text-xl outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Name"
                className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </div>
            <button
              onClick={savePet}
              disabled={!pName.trim() || savingPet}
              className="mt-4 w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {savingPet ? 'Saving…' : 'Add pet'}
            </button>
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
