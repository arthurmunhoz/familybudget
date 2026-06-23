import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useI18n } from '../../hooks/useI18n'
import {
  biometricAvailable,
  isVaultLockEnabled,
  setVaultLockEnabled,
  unlockVault,
} from '../../lib/biometric'
import { formatDay } from '../../lib/format'
import { fileToResizedBase64 } from '../../lib/image'
import type { TKey } from '../../lib/i18n'
import { getSignedUrl } from '../../lib/signedUrls'
import { supabase } from '../../lib/supabase'
import type { DocCategory, FamilyDocument } from '../../lib/types'

const CATEGORIES: { id: DocCategory; icon: string }[] = [
  { id: 'ids', icon: '🪪' },
  { id: 'insurance', icon: '🛡️' },
  { id: 'medical', icon: '🏥' },
  { id: 'pets', icon: '🐾' },
  { id: 'home', icon: '🏠' },
  { id: 'receipts', icon: '🧾' },
  { id: 'other', icon: '📦' },
]
const CAT_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon])) as Record<
  DocCategory,
  string
>

const MAX_SIZE = 20 * 1024 * 1024 // storage free tier is small — keep files reasonable

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentVault() {
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [docs, setDocs] = useState<FamilyDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<DocCategory | 'all'>('all')
  const [person, setPerson] = useState<string>('all')
  const [personMenuOpen, setPersonMenuOpen] = useState(false)

  // Opt-in Face ID lock (per device). The toggle only appears where biometrics
  // are available; turning it on confirms with a biometric check first.
  const [canLock, setCanLock] = useState(false)
  const [lockOn, setLockOn] = useState(() =>
    profile ? isVaultLockEnabled(profile.email) : false,
  )
  useEffect(() => {
    biometricAvailable().then(setCanLock)
  }, [])

  async function toggleLock() {
    if (!profile) return
    if (lockOn) {
      setVaultLockEnabled(profile.email, false)
      setLockOn(false)
      return
    }
    const ok = await unlockVault(profile.email) // enroll/verify before enabling
    if (!ok) {
      alert(t('vault.enableFailed'))
      return
    }
    setVaultLockEnabled(profile.email, true)
    setLockOn(true)
  }

  // upload form state — appears after a file is picked
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fCategory, setFCategory] = useState<DocCategory>('other')
  const [fOwner, setFOwner] = useState('')
  const [uploading, setUploading] = useState(false)

  // edit sheet state
  const [editing, setEditing] = useState<FamilyDocument | null>(null)
  const [eTitle, setETitle] = useState('')
  const [eCategory, setECategory] = useState<DocCategory>('other')
  const [eOwner, setEOwner] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // in-app preview
  const [preview, setPreview] = useState<{ doc: FamilyDocument; url: string } | null>(null)
  useScrollLock(Boolean(pendingFile || editing || preview))

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(
    () =>
      docs
        .filter((d) => filter === 'all' || d.category === filter)
        .filter((d) => person === 'all' || d.owner_email === person)
        // Alphabetical by title so similarly-named docs sit together (and each
        // per-owner subsection is sorted, since the sections derive from this).
        .sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
        ),
    [docs, filter, person],
  )

  // 'shared' is a sentinel owner for documents that belong to the whole family
  const nameOf = (email: string) =>
    email === 'shared'
      ? t('docs.shared')
      : (profiles.find((p) => p.email === email)?.display_name ?? email)

  /** With "Everyone" selected, the list splits into per-owner subsections:
   *  each member in order, then Shared, then any leftover owners (e.g. a
   *  removed member's docs). A specific person selected = flat list. */
  const sections = useMemo(() => {
    if (person !== 'all') return null
    const order = [...profiles.map((p) => p.email), 'shared']
    const byOwner = new Map<string, FamilyDocument[]>()
    for (const key of order) byOwner.set(key, [])
    for (const d of visible) {
      if (!byOwner.has(d.owner_email)) byOwner.set(d.owner_email, [])
      byOwner.get(d.owner_email)!.push(d)
    }
    return [...byOwner.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([owner, list]) => ({ owner, docs: list }))
  }, [person, profiles, visible])

  const ownerOptions = [
    ...profiles.map((p) => ({ key: p.email, label: p.display_name })),
    { key: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]

  function pickFile() {
    fileInput.current?.click()
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file later
    if (!file) return
    if (file.size > MAX_SIZE) {
      alert(t('docs.tooBig', { size: formatBytes(file.size) }))
      return
    }
    setPendingFile(file)
    setFTitle(file.name.replace(/\.[^.]+$/, ''))
    setFCategory(filter !== 'all' ? filter : 'other')
    setFOwner(person !== 'all' ? person : (profile?.email ?? ''))
  }

  async function upload() {
    if (!pendingFile || !fTitle.trim() || !profile || uploading) return
    setUploading(true)
    const rawExt = pendingFile.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const isImage =
      pendingFile.type.startsWith('image/') ||
      ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(rawExt)
    // Downscale image documents before upload — a phone photo can be 5-10MB;
    // 2048px keeps an ID or insurance card perfectly legible. PDFs upload as-is.
    let body: Blob | File = pendingFile
    let ext = rawExt
    // The bucket only accepts image/* and application/pdf (migration 013), so
    // when the picker doesn't report a type, infer it from the extension.
    let mime =
      pendingFile.type || (rawExt === 'pdf' ? 'application/pdf' : `image/${rawExt === 'jpg' ? 'jpeg' : rawExt}`)
    if (isImage) {
      try {
        const { data: b64 } = await fileToResizedBase64(pendingFile, 2048)
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        body = new Blob([bytes], { type: 'image/jpeg' })
        ext = 'jpg'
        mime = 'image/jpeg'
      } catch {
        // Browser couldn't decode it (e.g. some HEIC) — upload the original.
      }
    }
    // Storage RLS only allows paths inside the user's own household folder.
    const path = `${profile.household_id}/${fCategory}/${crypto.randomUUID()}.${ext}`
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(path, body, { contentType: mime, cacheControl: '604800' })
    if (storageError) {
      setUploading(false)
      alert(t('docs.uploadFailed'))
      return
    }
    const { error: dbError } = await supabase.from('documents').insert({
      title: fTitle.trim(),
      category: fCategory,
      file_path: path,
      mime_type: mime,
      size_bytes: body.size,
      owner_email: fOwner || profile.email,
      added_by: profile.email,
    })
    setUploading(false)
    if (dbError) {
      await supabase.storage.from('documents').remove([path])
      alert(t('docs.saveFailed'))
      return
    }
    setPendingFile(null)
    load()
  }

  async function open(doc: FamilyDocument) {
    const url = await getSignedUrl(doc.file_path)
    if (!url) {
      alert(t('docs.openFailed'))
      return
    }
    setPreview({ doc, url })
  }

  function openEdit(doc: FamilyDocument) {
    setEditing(doc)
    setETitle(doc.title)
    setECategory(doc.category)
    setEOwner(doc.owner_email)
  }

  async function saveEdit() {
    if (!editing || !eTitle.trim() || savingEdit) return
    setSavingEdit(true)
    const { error } = await supabase
      .from('documents')
      .update({ title: eTitle.trim(), category: eCategory, owner_email: eOwner })
      .eq('id', editing.id)
    setSavingEdit(false)
    if (error) {
      alert(t('docs.editSaveFailed'))
      return
    }
    setEditing(null)
    load()
  }

  async function remove(doc: FamilyDocument) {
    if (!confirm(t('docs.deleteConfirm', { title: doc.title }))) return
    setDocs((list) => list.filter((d) => d.id !== doc.id))
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', doc.id)
  }

  // Shared row markup for both the flat list and the per-owner sections.
  // The owner isn't repeated in the subtitle: it's in the section header
  // (Everyone view) or implied by the active person filter.
  const renderDoc = (doc: FamilyDocument) => (
    <li key={doc.id}>
      <div className="flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3">
        <button
          onClick={() => open(doc)}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-(--text)">
              {doc.title}
            </span>
            <span className="block text-xs text-(--text-faint)">
              {CAT_ICON[doc.category]} {t(`docCat.${doc.category}` as TKey)} ·{' '}
              {formatDay(doc.created_at.slice(0, 10))} · {formatBytes(doc.size_bytes)}
            </span>
          </span>
        </button>
        <button
          onClick={() => openEdit(doc)}
          aria-label={t('common.editName', { name: doc.title })}
          className="px-1 text-(--text-faint) active:text-(--accent)"
        >
          ✎
        </button>
        <button
          onClick={() => remove(doc)}
          aria-label={t('common.deleteName', { name: doc.title })}
          className="px-1 text-(--text-faint) active:text-(--expense)"
        >
          ✕
        </button>
      </div>
    </li>
  )

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-(--text)">
          📄 {t('docs.title')}
        </h1>

        {/* Person filter chip — same pattern as the budget entries list */}
        <div className="relative shrink-0">
          <button
            onClick={() => setPersonMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-full border border-(--surface-2) bg-(--surface) px-3.5 py-1.5 text-sm font-semibold text-(--text)"
          >
            {person === 'all' ? t('common.everyone') : nameOf(person)}
            <span className="text-[9px] text-(--text-faint)">▼</span>
          </button>
          {personMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPersonMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-xl border border-(--surface) bg-(--card) shadow-xl">
                {[
                  { key: 'all', label: t('common.everyone') },
                  ...profiles.map((p) => ({
                    key: p.email,
                    label: p.display_name,
                  })),
                  { key: 'shared', label: t('docs.shared') },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setPerson(opt.key)
                      setPersonMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium active:bg-(--surface) ${
                      person === opt.key ? 'text-(--accent)' : 'text-(--text)'
                    }`}
                  >
                    {opt.label}
                    {person === opt.key && <span>✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Face ID lock card — only where the device supports biometrics */}
      {canLock && (
        <button
          onClick={toggleLock}
          role="switch"
          aria-checked={lockOn}
          aria-label={lockOn ? t('vault.disableLock') : t('vault.enableLock')}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-(--card) px-4 py-3 text-left active:bg-(--card-active) transition-colors"
        >
          <span className="text-2xl">{lockOn ? '🔒' : '🔓'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-(--text)">{t('vault.lockTitle')}</p>
            <p className="text-xs text-(--text-faint)">{t('vault.lockDesc')}</p>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            <span
              className={`text-xs font-bold ${
                lockOn ? 'text-(--accent)' : 'text-(--text-faint)'
              }`}
            >
              {lockOn ? t('common.on') : t('common.off')}
            </span>
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${
                lockOn ? 'bg-(--accent)' : 'bg-(--surface-2)'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  lockOn ? 'left-4.5' : 'left-0.5'
                }`}
              />
            </span>
          </span>
        </button>
      )}

      {/* category filter */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-4">
        <CatChip active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('common.all')}
        </CatChip>
        {CATEGORIES.map((c) => (
          <CatChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.icon} {t(`docCat.${c.id}` as TKey)}
          </CatChip>
        ))}
      </div>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : visible.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">🗂️</div>
          <p className="mt-4">{t('docs.empty')}</p>
          <p className="text-sm text-(--text-faint)">{t('docs.emptyHint')}</p>
        </div>
      ) : sections ? (
        sections.map((section) => (
          <section key={section.owner} className="mt-8 first:mt-0">
            {/* owner subsection header with separator line */}
            <div className="mb-2 flex items-center gap-3">
              <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {section.owner === 'shared' ? `🏠 ${t('docs.shared')}` : nameOf(section.owner)}
              </h3>
              <div className="h-px flex-1 bg-(--surface-2) opacity-60" />
              <span className="shrink-0 text-xs text-(--text-faint)">
                {section.docs.length}
              </span>
            </div>
            <ul className="space-y-2">{section.docs.map(renderDoc)}</ul>
          </section>
        ))
      ) : (
        <ul className="space-y-2">{visible.map(renderDoc)}</ul>
      )}

      {/* hidden picker — accepts camera, photo library, and files on iOS */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        onChange={onFilePicked}
        className="hidden"
      />

      {/* upload form */}
      {pendingFile && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/50"
          onClick={() => !uploading && setPendingFile(null)}
        >
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 pt-5 pb-3">
              <h2 className="text-lg font-bold text-(--text)">{t('docs.addDoc')}</h2>
              <p className="text-xs text-(--text-faint)">
                {pendingFile.name} · {formatBytes(pendingFile.size)}
              </p>
            </div>

            <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-2">
            <input
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              placeholder={t('docs.titlePlaceholder')}
              className="w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <CatChip
                  key={c.id}
                  active={fCategory === c.id}
                  onClick={() => setFCategory(c.id)}
                >
                  {c.icon} {t(`docCat.${c.id}` as TKey)}
                </CatChip>
              ))}
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('docs.belongsTo')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ownerOptions.map((o) => (
                <CatChip
                  key={o.key}
                  active={fOwner === o.key}
                  onClick={() => setFOwner(o.key)}
                >
                  {o.label}
                </CatChip>
              ))}
            </div>

            </div>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <button
                onClick={upload}
                disabled={!fTitle.trim() || uploading}
                className="w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {uploading ? t('docs.uploading') : t('docs.saveDoc')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* edit sheet */}
      {editing && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/50"
          onClick={() => !savingEdit && setEditing(null)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-(--card) px-4 pt-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-(--text)">{t('docs.editDoc')}</h2>

            <input
              value={eTitle}
              onChange={(e) => setETitle(e.target.value)}
              placeholder={t('docs.titlePlaceholder')}
              className="w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <CatChip
                  key={c.id}
                  active={eCategory === c.id}
                  onClick={() => setECategory(c.id)}
                >
                  {c.icon} {t(`docCat.${c.id}` as TKey)}
                </CatChip>
              ))}
            </div>

            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('docs.belongsTo')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ownerOptions.map((o) => (
                <CatChip
                  key={o.key}
                  active={eOwner === o.key}
                  onClick={() => setEOwner(o.key)}
                >
                  {o.label}
                </CatChip>
              ))}
            </div>

            <button
              onClick={saveEdit}
              disabled={!eTitle.trim() || savingEdit}
              className="mt-4 w-full rounded-2xl bg-(--accent) py-4 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {savingEdit ? t('common.saving') : t('entry.saveChanges')}
            </button>
          </div>
        </div>
      )}

      {/* full-screen preview */}
      {preview && (
        <div className="fixed inset-0 z-30 flex flex-col bg-black/90">
          <header
            className="flex items-center gap-3 px-4 pb-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
          >
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg px-2 py-1 text-xl text-white/70 active:text-white"
            >
              ✕
            </button>
            <h2 className="min-w-0 flex-1 truncate font-semibold text-white">
              {preview.doc.title}
            </h2>
            <a
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-(--accent)"
            >
              {t('docs.open')}
            </a>
          </header>
          {preview.doc.mime_type.startsWith('image/') ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <img
                src={preview.url}
                alt={preview.doc.title}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            </div>
          ) : (
            <iframe
              src={preview.url}
              title={preview.doc.title}
              className="min-h-0 flex-1 bg-white"
            />
          )}
        </div>
      )}

      {/* add button */}
      {!pendingFile && !preview && !editing && (
        <div
          className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          <button
            onClick={pickFile}
            className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
          >
            {t('docs.addBtn')}
          </button>
        </div>
      )}
    </div>
  )
}

function CatChip({
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
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
        active ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
      }`}
    >
      {children}
    </button>
  )
}
