import { useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { notifyHouseholdChanged, useHousehold } from '../hooks/useHousehold'
import { useTheme } from '../hooks/useTheme'
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
  const { theme, setTheme } = useTheme()
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
      alert('Please choose an image.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      alert('That image is too large — please pick one under 15 MB.')
      return
    }
    setBusy(true)
    try {
      // Downscale to keep storage small; backdrop renders at low opacity anyway.
      const { data } = await fileToResizedBase64(file, 1200)
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      const path = `${profile.household_id}/backdrop/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      await setBackdropPath(path)
    } catch {
      alert('Could not update the backdrop — please try again.')
    }
    setBusy(false)
  }

  async function removeBackdrop() {
    if (!confirm('Remove the backdrop image?') || busy) return
    setBusy(true)
    try {
      await setBackdropPath(null)
    } catch {
      alert('Could not update the backdrop — please try again.')
    }
    setBusy(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute right-0 top-0 flex h-full w-72 flex-col bg-(--card) p-5"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-(--text)">Settings</h2>
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
          <span className="text-sm text-(--text-muted)">Theme</span>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                  theme === t ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                {t === 'light' ? '🌞 Light' : '🌙 Dark'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">Backdrop</span>
          <p className="mt-1 text-xs text-(--text-faint)">
            A photo shown softly behind the home screen, visible only to your
            family.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="flex-1 rounded-xl bg-(--surface) py-2.5 text-sm font-semibold text-(--text) disabled:opacity-50"
            >
              {busy ? 'Working…' : backdropPath ? '📷 Replace image' : '📷 Add image'}
            </button>
            {backdropPath && (
              <button
                onClick={removeBackdrop}
                disabled={busy}
                className="rounded-xl bg-(--surface) px-3 py-2.5 text-sm font-semibold text-(--expense) disabled:opacity-50"
              >
                Remove
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

        <button
          onClick={signOut}
          className="w-full rounded-xl py-3 font-semibold text-(--expense) active:bg-(--surface)"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
