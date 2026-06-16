import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { formatDay, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
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

export default function PetProfile() {
  const { petId } = useParams<{ petId: string }>()
  const back = useBack()
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)

  const {
    data = { pet: null, events: [], photoUrl: null },
    loading,
    revalidate,
  } = useCachedQuery<{ pet: Pet | null; events: PetEvent[]; photoUrl: string | null }>(
    `petProfile:${petId ?? ''}`,
    async () => {
      if (!petId) return { pet: null, events: [], photoUrl: null }
      const [petRes, evRes] = await Promise.all([
        supabase.from('pets').select('*').eq('id', petId).single(),
        supabase
          .from('pet_events')
          .select('*')
          .eq('pet_id', petId)
          .order('event_date', { ascending: false }),
      ])
      const pet = petRes.data as Pet | null
      let photoUrl: string | null = null
      if (pet?.photo_path) {
        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(pet.photo_path, 3600)
        photoUrl = signed?.signedUrl ?? null
      }
      return { pet, events: evRes.data ?? [], photoUrl }
    },
  )

  const { pet, events, photoUrl } = data

  async function deletePet() {
    if (!pet) return
    if (!confirm(t('pets.deletePetConfirm', { name: pet.name }))) return
    const { error } = await supabase.from('pets').delete().eq('id', pet.id)
    if (error) {
      alert(t('pets.deletePetFailed'))
      return
    }
    back('/pets')
  }

  if (loading || !pet) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="animate-pulse text-(--text-faint)">{t('common.loading')}</p>
      </div>
    )
  }

  // Detail rows, only the ones that are filled in.
  const rows: { label: string; value: string }[] = []
  if (pet.species) rows.push({ label: t('pets.species'), value: t(`pets.species.${pet.species}` as TKey) })
  if (pet.breed) rows.push({ label: t('pets.breed'), value: pet.breed })
  if (pet.birthday) {
    const m = ageInMonths(pet.birthday, todayISO())
    const age =
      m < 0
        ? ''
        : m < 12
          ? t('pets.ageMo', { months: m })
          : t('pets.ageY', { years: Math.floor(m / 12) })
    rows.push({
      label: t('pets.birthday'),
      value: formatDay(pet.birthday) + (age ? ` · ${age}` : ''),
    })
  }
  if (pet.color) {
    rows.push({
      label: t('pets.color'),
      value: pet.color + (pet.color_secondary ? ` & ${pet.color_secondary}` : ''),
    })
  }
  if (pet.weight) rows.push({ label: t('pets.weight'), value: pet.weight })
  if (pet.length) rows.push({ label: t('pets.length'), value: pet.length })
  if (pet.microchip) rows.push({ label: t('pets.microchip'), value: pet.microchip })

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => back('/pets')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-(--text)">{pet.name}</h1>
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text) active:bg-(--surface-2)"
        >
          ✎ {t('pets.edit')}
        </button>
      </header>

      {/* avatar */}
      <div className="flex flex-col items-center">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-6xl">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{pet.emoji || speciesEmoji(pet.species)}</span>
          )}
        </div>
      </div>

      {/* details */}
      <section className="mt-6 rounded-2xl bg-(--card) p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
          {t('pets.details')}
        </h3>
        {rows.length === 0 && !pet.notes ? (
          <p className="text-sm text-(--text-faint)">{t('pets.noInfo')}</p>
        ) : (
          <dl className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline gap-3 text-sm">
                <dt className="w-28 shrink-0 text-(--text-faint)">{r.label}</dt>
                <dd className="min-w-0 flex-1 break-words text-(--text)">{r.value}</dd>
              </div>
            ))}
            {pet.notes && (
              <div className="flex items-baseline gap-3 text-sm">
                <dt className="w-28 shrink-0 text-(--text-faint)">{t('pets.petNotes')}</dt>
                <dd className="min-w-0 flex-1 break-words text-(--text)">{pet.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {/* event history for this pet */}
      {events.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
            {t('pets.history')}
          </h3>
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 rounded-xl bg-(--card) px-4 py-3">
                <span className="text-xl">{TYPE_ICON[e.type]}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-(--text)">{e.title}</p>
                  <p className="text-xs text-(--text-faint)">
                    {formatDay(e.event_date)}
                    {e.next_due && ` · ${t('pets.next')} ${formatDay(e.next_due)}`}
                  </p>
                  {e.notes && <p className="mt-1 text-sm text-(--text-muted)">{e.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        onClick={deletePet}
        className="mt-8 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-(--surface)"
      >
        {t('pets.deletePet')}
      </button>

      {editing && (
        <PetForm
          pet={pet}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            revalidate()
          }}
        />
      )}
    </div>
  )
}
