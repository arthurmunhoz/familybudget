import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useAuth } from '../hooks/useAuth'
import { notifyHouseholdChanged, useHousehold } from '../hooks/useHousehold'
import { useI18n } from '../hooks/useI18n'
import { useScrollLock } from '../hooks/useScrollLock'
import { useTheme } from '../hooks/useTheme'
import NotificationsToggle from './NotificationsToggle'
import { APPS } from '../lib/apps'
import { LANGUAGES, type TKey } from '../lib/i18n'
import { fileToResizedBase64 } from '../lib/image'
import { supabase } from '../lib/supabase'
import { geocodeCity, loadHomeLocation, saveHomeLocation, type HomeLocation } from '../lib/weather'

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
  const { hidden, toggleApp, tileStyle, setTileStyle, orderedApps, reorderApps } =
    useAppPrefs()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  useScrollLock(open)

  // Home city for the Hub's "Today" weather — per-device, stored in localStorage
  // (no browser geolocation permission requested). Loaded fresh each time the
  // drawer opens so it reflects a change made elsewhere (e.g. cleared).
  const [homeLoc, setHomeLoc] = useState<HomeLocation | null>(null)
  const [cityInput, setCityInput] = useState('')
  const [savingCity, setSavingCity] = useState(false)
  const [cityMsg, setCityMsg] = useState<string | null>(null)
  useEffect(() => {
    if (open) setHomeLoc(loadHomeLocation())
  }, [open])

  async function saveCity() {
    const q = cityInput.trim()
    if (!q) return
    setSavingCity(true)
    setCityMsg(null)
    const loc = await geocodeCity(q)
    setSavingCity(false)
    if (!loc) {
      setCityMsg(t('drawer.cityNotFound'))
      return
    }
    saveHomeLocation(loc)
    setHomeLoc(loc)
    setCityInput('')
  }

  function clearCity() {
    saveHomeLocation(null)
    setHomeLoc(null)
    setCityMsg(null)
  }

  // Drag-to-reorder the app list (grip handle), persisted via reorderApps.
  const appById = useMemo(() => new Map(APPS.map((a) => [a.id, a])), [])
  const [order, setOrder] = useState<string[]>(() => orderedApps.map((a) => a.id))
  const orderRef = useRef(order)
  orderRef.current = order
  const appRowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // Re-seed from saved order when it changes elsewhere (other device / new app),
  // but never mid-drag.
  useEffect(() => {
    if (dragIndex === null) setOrder(orderedApps.map((a) => a.id))
  }, [orderedApps, dragIndex])

  function startAppDrag(e: React.PointerEvent, index: number) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragIndex(index)
  }
  function onAppDrag(e: React.PointerEvent) {
    if (dragIndex === null) return
    const y = e.clientY
    for (let i = 0; i < appRowRefs.current.length; i++) {
      const el = appRowRefs.current[i]
      if (!el || i === dragIndex) continue
      const r = el.getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) {
        setOrder((prev) => {
          const next = [...prev]
          const [moved] = next.splice(dragIndex, 1)
          next.splice(i, 0, moved)
          return next
        })
        setDragIndex(i)
        break
      }
    }
  }
  function endAppDrag() {
    if (dragIndex === null) return
    setDragIndex(null)
    reorderApps(orderRef.current)
  }

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
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '604800' })
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
      <div className="absolute right-0 top-0 flex h-full w-72 flex-col bg-(--card)">
        <div
          className="flex shrink-0 items-center justify-between px-5 pb-3"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}
        >
          <h2 className="font-display text-lg font-bold text-(--text)">{t('drawer.settings')}</h2>
          <button onClick={onClose} className="px-2 py-1 text-(--text-muted)">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        >
        <div className="mt-1 rounded-xl bg-(--surface) px-4 py-3">
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
                className={`flex flex-col items-center gap-0.5 rounded-lg py-2 font-semibold transition-colors ${
                  lang === l.id ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                }`}
              >
                <span className="text-lg leading-none">{l.flag}</span>
                <span className="text-[11px] leading-tight">{l.label}</span>
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

        <NotificationsToggle />

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.weather')}</span>
          <div className="mt-2 rounded-xl bg-(--surface) p-3">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  homeLoc ? 'bg-(--accent-soft) text-(--accent)' : 'bg-(--surface-2) text-(--text-muted)'
                }`}
              >
                <MapPin size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-(--text)">{t('drawer.homeCity')}</div>
                <div className="truncate text-xs text-(--text-faint)">
                  {homeLoc ? homeLoc.city : t('drawer.homeCityHint')}
                </div>
              </div>
              {homeLoc && (
                <button
                  onClick={clearCity}
                  className="shrink-0 text-xs font-semibold text-(--expense)"
                >
                  {t('common.remove')}
                </button>
              )}
            </div>
            <div className="mt-2.5 flex items-end gap-2">
              <input
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder={t('drawer.cityPlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && saveCity()}
                className="min-w-0 flex-1 rounded-lg bg-(--card) px-3 py-2 text-sm text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <button
                onClick={saveCity}
                disabled={savingCity || !cityInput.trim()}
                className="shrink-0 rounded-lg bg-(--accent) px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('drawer.setCity')}
              </button>
            </div>
            {cityMsg && <p className="mt-1.5 text-xs text-(--text-faint)">{cityMsg}</p>}
          </div>
        </div>

        <div className="mt-6">
          <span className="text-sm text-(--text-muted)">{t('drawer.myApps')}</span>
          <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.myAppsHint')}</p>
          <div className="mt-2 space-y-1 rounded-xl bg-(--surface) p-1">
            {order.map((id, index) => {
              const app = appById.get(id)
              if (!app) return null
              const on = !hidden.includes(app.id)
              const dragging = dragIndex === index
              return (
                <div
                  key={app.id}
                  ref={(el) => {
                    appRowRefs.current[index] = el
                  }}
                  className={`flex items-center gap-1 rounded-lg pr-3 transition-shadow ${
                    dragging ? 'bg-(--card) shadow' : ''
                  }`}
                >
                  <button
                    aria-label={t('pings.reorder')}
                    onPointerDown={(e) => startAppDrag(e, index)}
                    onPointerMove={onAppDrag}
                    onPointerUp={endAppDrag}
                    onPointerCancel={endAppDrag}
                    className="shrink-0 cursor-grab touch-none px-2 py-2 text-(--text-faint) active:text-(--text)"
                  >
                    ⠿
                  </button>
                  <button
                    onClick={() => toggleApp(app.id)}
                    role="switch"
                    aria-checked={on}
                    className="flex flex-1 items-center gap-2.5 py-2 text-left"
                  >
                    <span className={on ? 'text-(--accent)' : 'text-(--text-faint)'}>
                      <app.icon size={20} strokeWidth={2} aria-hidden="true" />
                    </span>
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
                </div>
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

          {/* sign out scrolls with the rest of the content — no fixed footer */}
          <div className="mt-6">
            {/* --text-faint is grey in BOTH themes; --surface-2 is white in light mode */}
            <div className="mb-3 h-px bg-(--text-faint) opacity-40" />
            <button
              onClick={signOut}
              className="w-full rounded-xl py-3 font-semibold text-(--expense) active:bg-(--surface)"
            >
              {t('drawer.signOut')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
