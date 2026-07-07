import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Phone, User, Users, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { formatDay, formatPhone, todayISO } from '../../lib/format'
import { fileToResizedBase64 } from '../../lib/image'
import type { TKey } from '../../lib/i18n'
import { getSignedUrls } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import type { MemberProfile, Profile } from '../../lib/types'

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

// Keep digits and a leading + so formatted numbers dial cleanly.
function callHref(raw: string): string {
  return `tel:${raw.trim().replace(/[^\d+]/g, '')}`
}

/** One member row: avatar + name, expands in place to the full profile card
 *  (fields, call button, "Edit my info" for the signed-in user's own row) —
 *  hoisted to module scope so it isn't recreated (and remounted) every render. */
function MemberCard({
  member,
  memberProfile,
  avatarUrl,
  isMe,
  isOpen,
  today,
  t,
  onToggle,
  onAvatarClick,
  onEdit,
}: {
  member: Profile
  memberProfile: MemberProfile | undefined
  avatarUrl: string | undefined
  isMe: boolean
  isOpen: boolean
  today: string
  t: (key: TKey, vars?: Record<string, string | number>) => string
  onToggle: () => void
  onAvatarClick: (url: string) => void
  onEdit: () => void
}) {
  const age = ageOf(memberProfile?.birthday ?? null, today)
  // A short hint line under the name (collapsed only): age, else phone.
  const hint =
    age != null
      ? t('family.yrs', { years: age })
      : memberProfile?.phone
        ? formatPhone(memberProfile.phone)
        : null

  const items: { label: string; value: string; phone?: string }[] = []
  if (memberProfile?.birthday) {
    items.push({
      label: t('family.birthday'),
      value:
        formatDay(memberProfile.birthday) +
        (age != null ? ` · ${t('family.yrs', { years: age })}` : ''),
    })
  }
  for (const [key, labelKey] of FIELDS) {
    const v = memberProfile?.[key]
    if (v) {
      items.push({
        label: t(labelKey),
        value: key === 'phone' ? formatPhone(String(v)) : String(v),
        ...(key === 'phone' ? { phone: String(v) } : {}),
      })
    }
  }

  return (
    <section className="rounded-2xl bg-(--card) p-4">
      <button
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-3 text-left"
        aria-expanded={isOpen}
      >
        {avatarUrl ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onAvatarClick(avatarUrl)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onAvatarClick(avatarUrl)
              }
            }}
            aria-label={member.display_name}
            className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-(--surface) active:opacity-80"
          >
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          </span>
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--surface) text-(--text-faint)">
            <span className="text-lg font-semibold">
              {member.display_name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate font-bold text-(--text)">
            <span className="truncate">{member.display_name}</span>
            {isMe && (
              <span className="shrink-0 rounded-full bg-(--accent-soft) px-2 py-0.5 text-[10px] font-bold text-(--accent)">
                {t('family.you')}
              </span>
            )}
          </h2>
          {!isOpen && hint && <p className="text-sm text-(--text-faint)">{hint}</p>}
        </div>
        {isOpen ? (
          <ChevronDown size={20} strokeWidth={2} className="shrink-0 text-(--text-faint)" aria-hidden="true" />
        ) : (
          <ChevronRight size={20} strokeWidth={2} className="shrink-0 text-(--text-faint)" aria-hidden="true" />
        )}
      </button>

      {isOpen && (
        <div className="mt-4 border-t border-(--surface-2) pt-4">
          {items.length > 0 ? (
            <dl className="space-y-3">
              {items.map((it) => (
                <div key={it.label} className="flex items-center gap-3 text-sm">
                  <dt className="w-24 shrink-0 text-(--text-faint)">{it.label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-(--text)">{it.value}</dd>
                  {it.phone && (
                    <a
                      href={callHref(it.phone)}
                      aria-label={`${t('family.call')} ${member.display_name}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent) active:opacity-80"
                    >
                      <Phone size={16} strokeWidth={2} aria-hidden="true" />
                    </a>
                  )}
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-(--text-faint)">{t('family.empty')}</p>
          )}

          {isMe && (
            <button
              onClick={onEdit}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-(--surface) py-2.5 text-sm font-semibold text-(--text) active:bg-(--surface-2)"
            >
              <Pencil size={16} strokeWidth={2} aria-hidden="true" />
              {t('family.editMine')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default function Family() {
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const today = todayISO()

  // Which member's card is expanded (accordion — one open at a time).
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useScrollLock(editing || Boolean(preview))

  // Members sorted alphabetically, same as the list order.
  const members = [...profiles].sort((a, b) => a.display_name.localeCompare(b.display_name))

  // Cached: member profiles + signed avatar URLs render instantly on return.
  const {
    data = { byEmail: {}, avatarUrls: {} },
    loading,
    revalidate,
  } = useCachedQuery<{
    byEmail: Record<string, MemberProfile>
    avatarUrls: Record<string, string>
  }>('family:profiles', async () => {
    const { data: rowsData } = await supabase.from('member_profiles').select('*')
    const rows = (rowsData ?? []) as MemberProfile[]
    const byEmail = Object.fromEntries(rows.map((p) => [p.email, p]))
    // Sign avatar URLs so the household can see each other's photos.
    const paths = rows.map((p) => p.avatar_path).filter(Boolean) as string[]
    if (!paths.length) return { byEmail, avatarUrls: {} }
    const urlByPath = await getSignedUrls(paths)
    const avatarUrls = Object.fromEntries(
      rows
        .filter((p) => p.avatar_path && urlByPath[p.avatar_path])
        .map((p) => [p.email, urlByPath[p.avatar_path as string]]),
    )
    return { byEmail, avatarUrls }
  })
  const { byEmail, avatarUrls } = data

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
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '604800' })
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
    revalidate()
  }

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
          <Users size={24} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
          {t('family.title')}
        </h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">
          {t('common.loading')}
        </p>
      ) : (
        <div className="space-y-3">
          {members.map((m) => (
            <MemberCard
              key={m.email}
              member={m}
              memberProfile={byEmail[m.email]}
              avatarUrl={avatarUrls[m.email]}
              isMe={m.email === profile?.email}
              isOpen={expanded === m.email}
              today={today}
              t={t}
              onToggle={() => setExpanded((cur) => (cur === m.email ? null : m.email))}
              onAvatarClick={setPreview}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      {/* edit my info sheet */}
      {editing && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/50"
          onClick={() => !saving && setEditing(false)}
        >
          <div
            className="mx-auto flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            {/* static header */}
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">{t('family.editTitle')}</h2>
              <button
                onClick={() => setEditing(false)}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {/* static photo with floating edit / remove controls */}
            <div className="flex shrink-0 flex-col items-center pb-4">
              <div className="relative h-24 w-24">
                <div
                  className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-(--surface) text-(--text-faint) ${
                    uploadingPhoto ? 'animate-pulse' : ''
                  }`}
                >
                  {photoPreview ? (
                    <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <User size={40} className="text-(--text-faint)" aria-hidden="true" />
                  )}
                </div>
                {/* edit pencil — bottom-right */}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploadingPhoto}
                  aria-label={form.avatar_path ? t('family.changePhoto') : t('family.addPhoto')}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-(--card) bg-(--accent) text-white shadow active:scale-95 disabled:opacity-50"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
                {/* remove — top-right */}
                {form.avatar_path && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    aria-label={t('family.removePhoto')}
                    className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-(--card) bg-(--expense) text-white shadow active:scale-95"
                  >
                    <X size={16} strokeWidth={2.5} aria-hidden="true" />
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

            {/* scrollable fields */}
            <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
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
                  onBlur={
                    key === 'phone'
                      ? (e) => set('phone', formatPhone(e.target.value))
                      : undefined
                  }
                  inputMode={key === 'phone' ? 'tel' : undefined}
                  className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-sm font-normal text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
              </label>
            ))}
            </div>

            {/* static save */}
            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={save}
                disabled={saving}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {saving ? t('common.saving') : t('common.saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* full-screen photo preview */}
      {preview && (
        <div
          className="fixed inset-0 z-30 flex flex-col bg-black/90"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex justify-end px-4"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
          >
            <button
              onClick={() => setPreview(null)}
              aria-label={t('common.close')}
              className="rounded-lg px-2 py-1 text-white/70 active:text-white"
            >
              <X size={24} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <img
              src={preview}
              alt=""
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
