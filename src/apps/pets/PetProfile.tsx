import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { formatDay, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { getSignedUrl } from '../../lib/signedUrls'
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
        photoUrl = await getSignedUrl(pet.photo_path)
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
    <div className="mx-auto min-h-dvh max-w-md bg-(--bg)">
      {/* full-width hero photo */}
      <div className="relative">
        <div className="aspect-square w-full overflow-hidden bg-(--surface)">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[6rem]">
              {pet.emoji || speciesEmoji(pet.species)}
            </div>
          )}
        </div>
        {/* top scrim so the round buttons stay legible over any photo */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent" />
        <button
          onClick={() => back('/pets')}
          aria-label={t('common.close')}
          className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-xl text-white backdrop-blur active:bg-black/65"
        >
          ‹
        </button>
        <button
          onClick={() => setEditing(true)}
          aria-label={t('pets.edit')}
          className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-sm text-white backdrop-blur active:bg-black/65"
        >
          ✎
        </button>
      </div>

      {/* info "drawer" — a rounded card pulled up over the bottom of the photo */}
      <div className="relative -mt-6 min-h-[40dvh] rounded-t-3xl bg-(--card) px-5 pt-5 pb-32">
        <h1 className="text-2xl font-bold text-(--text)">
          {pet.species ? `${speciesEmoji(pet.species)} ` : ''}
          {pet.name}
        </h1>

        {/* details */}
        {rows.length === 0 && !pet.notes ? (
          <p className="mt-4 text-sm text-(--text-faint)">{t('pets.noInfo')}</p>
        ) : (
          <dl className="mt-4 space-y-2">
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

        {/* event history for this pet */}
        {events.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('pets.history')}
            </h3>
            <ul className="space-y-2">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-3 rounded-xl bg-(--surface) px-4 py-3"
                >
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
      </div>

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
