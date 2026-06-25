import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import type { TKey } from '../../lib/i18n'
import { fileToResizedBase64 } from '../../lib/image'
import { getSignedUrl } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import type { Pet } from '../../lib/types'
import { SPECIES, speciesEmoji } from './petMeta'

/** Bottom-sheet add/edit form for a pet, shared by the Pet Care list and the
 *  pet profile page. `pet` null = create. */
export default function PetForm({
  pet,
  onClose,
  onSaved,
}: {
  pet: Pet | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const { profile } = useAuth()
  useScrollLock(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(pet?.name ?? '')
  const [emoji, setEmoji] = useState(pet?.emoji ?? '🐶')
  const [species, setSpecies] = useState(pet?.species ?? '')
  const [breed, setBreed] = useState(pet?.breed ?? '')
  const [birthday, setBirthday] = useState(pet?.birthday ?? '')
  const [color, setColor] = useState(pet?.color ?? '')
  const [colorSecondary, setColorSecondary] = useState(pet?.color_secondary ?? '')
  const [weight, setWeight] = useState(pet?.weight ?? '')
  const [length, setLength] = useState(pet?.length ?? '')
  const [microchip, setMicrochip] = useState(pet?.microchip ?? '')
  const [notes, setNotes] = useState(pet?.notes ?? '')
  const [photoPath, setPhotoPath] = useState(pet?.photo_path ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  // Sign the existing photo for preview.
  useEffect(() => {
    if (!pet?.photo_path) return
    let cancelled = false
    getSignedUrl(pet.photo_path).then((url) => {
      if (!cancelled && url) setPhotoPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [pet?.photo_path])

  function pickSpecies(id: string) {
    setSpecies(id)
    setEmoji(speciesEmoji(id)) // default the icon to the species; still editable
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile || uploadingPhoto) return
    if (!file.type.startsWith('image/')) return
    setUploadingPhoto(true)
    try {
      const { data } = await fileToResizedBase64(file, 512)
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const path = `${profile.household_id}/pets/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '604800' })
      if (error) throw error
      setPhotoPath(path)
      setPhotoPreview(URL.createObjectURL(blob))
    } catch {
      alert(t('pets.photoFailed'))
    }
    setUploadingPhoto(false)
  }

  function removePhoto() {
    setPhotoPath('')
    setPhotoPreview(null)
  }

  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    const clean = (v: string) => (v.trim() ? v.trim() : null)
    const fields = {
      name: name.trim(),
      emoji: emoji.trim() || '🐶',
      species: species || null,
      breed: clean(breed),
      birthday: birthday || null,
      color: clean(color),
      color_secondary: clean(colorSecondary),
      weight: clean(weight),
      length: clean(length),
      microchip: clean(microchip),
      notes: clean(notes),
      photo_path: photoPath || null,
    }
    const { error } = pet
      ? await supabase.from('pets').update(fields).eq('id', pet.id)
      : await supabase.from('pets').insert(fields)
    setSaving(false)
    if (error) {
      alert(t('pets.addPetFailed'))
      return
    }
    // Clean up a replaced/removed photo file.
    const oldPhoto = pet?.photo_path ?? null
    if (oldPhoto && oldPhoto !== (photoPath || null)) {
      await supabase.storage.from('documents').remove([oldPhoto])
    }
    onSaved()
  }

  const field =
    'mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)'
  const lbl = 'mt-3 block text-xs font-semibold text-(--text-faint)'

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
          <h2 className="text-lg font-bold text-(--text)">
            {pet ? t('pets.editPet') : t('pets.addPet')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="px-2 py-1 text-(--text-muted) active:text-(--text)"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
          {/* photo */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-4xl">
              {photoPreview ? (
                <img src={photoPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{emoji || '🐾'}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploadingPhoto}
                className="flex items-center gap-1.5 rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text) disabled:opacity-50"
              >
                <Camera size={16} strokeWidth={2} aria-hidden="true" />
                {uploadingPhoto
                  ? t('drawer.working')
                  : photoPath
                    ? t('pets.changePhoto')
                    : t('pets.addPhoto')}
              </button>
              {photoPath && (
                <button
                  type="button"
                  onClick={removePhoto}
                  className="rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--expense)"
                >
                  {t('common.remove')}
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={onPhotoPicked}
              className="hidden"
            />
          </div>

          {/* emoji + name */}
          <div className="mt-4 flex gap-3">
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              aria-label={t('pets.petEmoji')}
              className="w-16 rounded-xl bg-(--surface) px-0 py-3 text-center text-xl outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pets.namePlaceholder')}
              className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </div>

          {/* species */}
          <label className={lbl}>{t('pets.species')}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {SPECIES.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSpecies(s.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                  species === s.id ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
                }`}
              >
                {s.emoji} {t(`pets.species.${s.id}` as TKey)}
              </button>
            ))}
          </div>

          <label className={lbl}>{t('pets.breed')}</label>
          <input
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder={t('pets.breedPlaceholder')}
            className={field}
          />

          <label className={lbl}>
            {t('pets.birthday')}{' '}
            <span className="text-(--text-faint)">{t('pets.optional')}</span>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className={lbl}>
              {t('pets.color')}
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder={t('pets.colorPlaceholder')}
                className={field}
              />
            </label>
            <label className={lbl}>
              {t('pets.colorSecondary')}
              <input
                value={colorSecondary}
                onChange={(e) => setColorSecondary(e.target.value)}
                placeholder={t('pets.colorSecondaryPlaceholder')}
                className={field}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className={lbl}>
              {t('pets.weight')}
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder={t('pets.weightPlaceholder')}
                className={field}
              />
            </label>
            <label className={lbl}>
              {t('pets.length')}
              <input
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder={t('pets.lengthPlaceholder')}
                className={field}
              />
            </label>
          </div>

          <label className={lbl}>{t('pets.microchip')}</label>
          <input
            value={microchip}
            onChange={(e) => setMicrochip(e.target.value)}
            placeholder={t('pets.microchipPlaceholder')}
            className={field}
          />

          <label className={lbl}>{t('pets.petNotes')}</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('pets.petNotesPlaceholder')}
            className={field}
          />
        </div>

        <div
          className="shrink-0 px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {saving ? t('common.saving') : pet ? t('common.saveChanges') : t('pets.addPet')}
          </button>
        </div>
      </div>
    </div>
  )
}
