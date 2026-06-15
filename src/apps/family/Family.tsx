import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatDay, todayISO } from '../../lib/format'
import { fileToResizedBase64 } from '../../lib/image'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { MemberProfile } from '../../lib/types'

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

// Plain text fields, in display order (birthday is handled separately).
const FIELDS: [keyof MemberProfile, TKey][] = [
  ['phone', 'family.phone'],
  ['blood_type', 'family.bloodType'],
  ['height', 'family.height'],
  ['weight', 'family.weight'],
  ['shoe_size', 'family.shoeSize'],
  ['pants_size', 'family.pantsSize'],
  ['shirt_size', 'family.shirtSize'],
  ['allergies', 'family.allergies'],
  ['notes', 'family.notes'],
]

function ageOf(birthday: string | null, today: string): number | null {
  if (!birthday) return null
  const [by, bm, bd] = birthday.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age--
  return age >= 0 && age <= 130 ? age : null
}

export default function Family() {
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const today = todayISO()
  const [byEmail, setByEmail] = useState<Record<string, MemberProfile>>({})
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({})
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  useScrollLock(editing)

  const load = useCallback(async () => {
    const { data } = await supabase.from('member_profiles').select('*')
    const rows = (data ?? []) as MemberProfile[]
    setByEmail(Object.fromEntries(rows.map((p) => [p.email, p])))
    // Sign avatar URLs so the household can see each other's photos.
    const paths = rows.map((p) => p.avatar_path).filter(Boolean) as string[]
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from('documents')
        .createSignedUrls(paths, 3600)
      const urlByPath = Object.fromEntries(
        (signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]),
      )
      setAvatarUrls(
        Object.fromEntries(
          rows
            .filter((p) => p.avatar_path && urlByPath[p.avatar_path])
            .map((p) => [p.email, urlByPath[p.avatar_path as string]]),
        ),
      )
    } else {
      setAvatarUrls({})
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openEdit() {
    const mine = profile ? byEmail[profile.email] : undefined
    setForm({
      avatar_path: mine?.avatar_path ?? '',
      birthday: mine?.birthday ?? '',
      phone: mine?.phone ?? '',
      blood_type: mine?.blood_type ?? '',
      height: mine?.height ?? '',
      weight: mine?.weight ?? '',
      shoe_size: mine?.shoe_size ?? '',
      pants_size: mine?.pants_size ?? '',
      shirt_size: mine?.shirt_size ?? '',
      allergies: mine?.allergies ?? '',
      notes: mine?.notes ?? '',
    })
    setPhotoPreview(profile ? (avatarUrls[profile.email] ?? null) : null)
    setEditing(true)
  }

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile || uploadingPhoto) return
    if (!file.type.startsWith('image/')) return
    setUploadingPhoto(true)
    try {
      // Downscale to a small square-ish avatar to keep storage light.
      const { data } = await fileToResizedBase64(file, 512)
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const path = `${profile.household_id}/avatars/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      set('avatar_path', path)
      setPhotoPreview(URL.createObjectURL(blob))
    } catch {
      alert(t('family.photoFailed'))
    }
    setUploadingPhoto(false)
  }

  function removePhoto() {
    set('avatar_path', '')
    setPhotoPreview(null)
  }

  async function save() {
    if (!profile || saving) return
    setSaving(true)
    const clean = (v: string) => (v.trim() ? v.trim() : null)
    const oldAvatar = byEmail[profile.email]?.avatar_path ?? null
    const newAvatar = clean(form.avatar_path)
    const { error } = await supabase.from('member_profiles').upsert(
      {
        email: profile.email,
        avatar_path: newAvatar,
        birthday: clean(form.birthday),
        phone: clean(form.phone),
        blood_type: clean(form.blood_type),
        height: clean(form.height),
        weight: clean(form.weight),
        shoe_size: clean(form.shoe_size),
        pants_size: clean(form.pants_size),
        shirt_size: clean(form.shirt_size),
        allergies: clean(form.allergies),
        notes: clean(form.notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' },
    )
    setSaving(false)
    if (error) {
      alert(t('family.saveFailed'))
      return
    }
    // Remove the previous photo file if it was replaced or cleared.
    if (oldAvatar && oldAvatar !== newAvatar) {
      await supabase.storage.from('documents').remove([oldAvatar])
    }
    setEditing(false)
    load()
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
        <h1 className="flex-1 text-2xl font-bold text-(--text)">👪 {t('family.title')}</h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">
          {t('common.loading')}
        </p>
      ) : (
        <div className="space-y-3">
          {profiles.map((m) => {
            const p = byEmail[m.email]
            const isMe = m.email === profile?.email
            const age = ageOf(p?.birthday ?? null, today)
            const items: { label: string; value: string }[] = []
            if (p?.birthday) {
              items.push({
                label: t('family.birthday'),
                value:
                  formatDay(p.birthday) +
                  (age != null ? ` · ${t('family.yrs', { years: age })}` : ''),
              })
            }
            for (const [key, labelKey] of FIELDS) {
              const v = p?.[key]
              if (v) items.push({ label: t(labelKey), value: String(v) })
            }
            return (
              <section key={m.email} className="rounded-2xl bg-(--card) p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-(--text-faint)">
                      {avatarUrls[m.email] ? (
                        <img
                          src={avatarUrls[m.email]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-lg font-semibold">
                          {m.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <h2 className="truncate font-bold text-(--text)">
                      {m.display_name}
                      {isMe && (
                        <span className="ml-2 rounded-full bg-(--accent-soft) px-2 py-0.5 text-[10px] font-bold text-(--accent)">
                          {t('family.you')}
                        </span>
                      )}
                    </h2>
                  </div>
                  {isMe && (
                    <button
                      onClick={openEdit}
                      className="shrink-0 rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text) active:bg-(--surface-2)"
                    >
                      ✎ {t('family.editMine')}
                    </button>
                  )}
                </div>

                {items.length > 0 ? (
                  <dl className="mt-3 space-y-1.5">
                    {items.map((it) => (
                      <div key={it.label} className="flex items-baseline gap-3 text-sm">
                        <dt className="w-28 shrink-0 text-(--text-faint)">{it.label}</dt>
                        <dd className="min-w-0 flex-1 break-words text-(--text)">{it.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-(--text-faint)">{t('family.empty')}</p>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* edit my info sheet */}
      {editing && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/50"
          onClick={() => !saving && setEditing(false)}
        >
          <div
            className="mx-auto max-h-[88dvh] w-full max-w-md overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-3xl bg-(--card) px-4 pt-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-(--text)">{t('family.editTitle')}</h2>
              <button
                onClick={() => setEditing(false)}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex flex-col items-center gap-2">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-(--text-faint)">
                {photoPreview ? (
                  <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl">👤</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploadingPhoto}
                  className="rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--text) disabled:opacity-50"
                >
                  {uploadingPhoto
                    ? t('drawer.working')
                    : form.avatar_path
                      ? t('family.changePhoto')
                      : t('family.addPhoto')}
                </button>
                {form.avatar_path && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="rounded-lg bg-(--surface) px-3 py-1.5 text-xs font-semibold text-(--expense)"
                  >
                    {t('family.removePhoto')}
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

            <label className="block text-xs font-semibold text-(--text-faint)">
              {t('family.birthday')}
              <input
                type="date"
                value={form.birthday}
                onChange={(e) => set('birthday', e.target.value)}
                className="mt-1 h-12 w-full min-w-0 rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
            </label>

            <label className="mt-3 block text-xs font-semibold text-(--text-faint)">
              {t('family.bloodType')}
              <select
                value={form.blood_type}
                onChange={(e) => set('blood_type', e.target.value)}
                className="mt-1 h-12 w-full appearance-none rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              >
                <option value="">{t('family.notSet')}</option>
                {BLOOD_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            {(
              [
                ['phone', 'family.phone'],
                ['height', 'family.height'],
                ['weight', 'family.weight'],
                ['shoe_size', 'family.shoeSize'],
                ['pants_size', 'family.pantsSize'],
                ['shirt_size', 'family.shirtSize'],
                ['allergies', 'family.allergies'],
                ['notes', 'family.notes'],
              ] as [string, TKey][]
            ).map(([key, labelKey]) => (
              <label key={key} className="mt-3 block text-xs font-semibold text-(--text-faint)">
                {t(labelKey)}
                <input
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                  inputMode={key === 'phone' ? 'tel' : undefined}
                  className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-sm font-normal text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
            ))}

            <button
              onClick={save}
              disabled={saving}
              className="mt-5 w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.saveChanges')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
