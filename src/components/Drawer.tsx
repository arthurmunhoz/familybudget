import { useRef, useState } from 'react'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
import { notifyHouseholdChanged, useHousehold } from '../hooks/useHousehold'
import { useI18n } from '../hooks/useI18n'
import { useTheme } from '../hooks/useTheme'
import { APPS } from '../lib/apps'
import { LANGUAGES, type TKey } from '../lib/i18n'
import { fileToResizedBase64 } from '../lib/image'
import { supabase } from '../lib/supabase'

export default function Drawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { profile, session, signOut } = useAuth()
  const { household } = useHousehold()
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const { hidden, toggleApp, tileStyle, setTileStyle } = useAppPrefs()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const backdropPath = household?.backdrop_path ?? null
  const isUploadedBackdrop = Boolean(backdropPath && backdropPath !== 'builtin:beach')

  async function setBackdropPath(path: string | null) {
    const { error } = await supabase
      .from('households')
      .update({ backdrop_path: path })
      .eq('id', profile!.household_id)
    if (error) throw error
    // old uploaded file is replaced/removed — don't leave orphans in storage
    if (isUploadedBackdrop && backdropPath !== path) {
      await supabase.storage.from('documents').remove([backdropPath!])
    }
    notifyHouseholdChanged()
  }

  async function onBackdropPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !profile || busy) return
    if (!file.type.startsWith('image/')) {
      alert(t('drawer.backdropNotImage'))
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      alert(t('drawer.backdropTooBig'))
      return
    }
    setBusy(true)
    try {
      // Downscale to keep storage small — 1800px holds up at full-screen cover.
      const { data } = await fileToResizedBase64(file, 1800)
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const path = `${profile.household_id}/backdrop/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      await setBackdropPath(path)
    } catch {
      alert(t('drawer.backdropFailed'))
    }
    setBusy(false)
  }

  async function removeBackdrop() {
    if (!confirm(t('drawer.removeBackdropConfirm')) || busy) return
    setBusy(true)
    try {
      await setBackdropPath(null)
    } catch {
      alert(t('drawer.backdropFailed'))
    }
    setBusy(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-72 flex-col overflow-y-auto bg-(--card) p-5"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-(--text)">{t('drawer.settings')}</h2>
          <button onClick={onClose} className="px-2 py-1 text-(--text-muted)">
            ✕
          </button>
        </div>

        <div className="mt-5 rounded-xl bg-(--surface) px-4 py-3">
          <div className="font-semibold text-(--text)">
            {profile?.display_name}
          </div>
          <div className="truncate text-xs text-(--text-faint)">
            {session?.user.email}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.language')}</span>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-(--surface) p-1">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`flex flex-col items-center gap-0.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  lang === l.id ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                <span className="text-lg leading-none">{l.flag}</span>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.theme')}</span>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
            {(['light', 'dark'] as const).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                  theme === th ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                {th === 'light' ? t('drawer.light') : t('drawer.dark')}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.myApps')}</span>
          <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.myAppsHint')}</p>
          <div className="mt-2 space-y-1 rounded-xl bg-(--surface) p-1">
            {APPS.map((app) => {
              const on = !hidden.includes(app.id)
              return (
                <button
                  key={app.id}
                  onClick={() => toggleApp(app.id)}
                  role="switch"
                  aria-checked={on}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                >
                  <span className={on ? '' : 'opacity-40 grayscale'}>{app.icon}</span>
                  <span
                    className={`flex-1 text-sm font-semibold ${
                      on ? 'text-(--text)' : 'text-(--text-faint) line-through'
                    }`}
                  >
                    {t(`app.${app.id}.name` as TKey)}
                  </span>
                  <span
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                      on ? 'bg-(--accent)' : 'bg-(--surface-2)'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        on ? 'left-4.5' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-(--text-faint)">{t('drawer.iconsHint')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
            {(
              [
                { id: 'large', label: t('drawer.large') },
                { id: 'compact', label: t('drawer.compact') },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                onClick={() => setTileStyle(s.id)}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  tileStyle === s.id ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.backdrop')}</span>
          <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.backdropHint')}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="flex-1 rounded-xl bg-(--surface) py-2.5 text-sm font-semibold text-(--text) disabled:opacity-50"
            >
              {busy
                ? t('drawer.working')
                : backdropPath
                  ? t('drawer.replaceImage')
                  : t('drawer.addImage')}
            </button>
            {backdropPath && (
              <button
                onClick={removeBackdrop}
                disabled={busy}
                className="rounded-xl bg-(--surface) px-3 py-2.5 text-sm font-semibold text-(--expense) disabled:opacity-50"
              >
                {t('common.remove')}
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={onBackdropPicked}
            className="hidden"
          />
        </div>

        <div className="flex-1" />

        {/* --text-faint is grey in BOTH themes; --surface-2 is white in light mode */}
        <div className="mt-6 mb-3 h-px shrink-0 bg-(--text-faint) opacity-40" />

        <button
          onClick={signOut}
          className="w-full rounded-xl py-3 font-semibold text-(--expense) active:bg-(--surface)"
        >
          {t('drawer.signOut')}
        </button>
      </div>
    </div>
  )
}
