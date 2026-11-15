// Modo Casa — the two small sheets: this device's settings (display mode,
// theme, idle photo frame, weather city, unit, language, unpair) and the calm "about Plus" note (no web checkout:
// it points to the phone app).
import { forwardRef, useState } from 'react'
import { Check, LayoutGrid, LogOut, MapPin, Monitor, Moon, PanelsTopLeft, Smartphone, Sparkles, Sun, X, type LucideIcon } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { LANGUAGES } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { geocodeCity, saveHomeLocation, loadHomeLocation, type TempUnit } from '../lib/weather'
import { setPrefs, usePrefs, type FrameIdle, type LayoutPref, type ThemePref } from './prefs'
import { Grow, IconChip, type GrowHandle } from './ui'
import { DEVICE_KEY, GRAD, grad, lsGet, lsSet } from './util'

export const SettingsSheet = forwardRef<
  GrowHandle,
  { origin: DOMRect | null; onClose: () => void; unit: TempUnit; setUnit: (u: TempUnit) => void; onCity: () => void }
>(function SettingsSheet({ origin, onClose, unit, setUnit, onCity }, ref) {
  const { t, lang, setLang } = useI18n()
  const [city, setCity] = useState(() => loadHomeLocation()?.city ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle')
  const [confirm, setConfirm] = useState(false)
  const prefs = usePrefs()

  async function saveCity() {
    if (!city.trim()) {
      saveHomeLocation(null)
      onCity()
      return
    }
    setState('busy')
    const loc = await geocodeCity(city)
    if (!loc) {
      setState('bad')
      return
    }
    saveHomeLocation(loc)
    setCity(loc.city)
    setState('ok')
    onCity()
  }

  async function unpair() {
    // Mark the device unpaired on the server first: that also ends this
    // session there (migration 111), not just on this screen.
    const id = lsGet(DEVICE_KEY)
    if (id) await supabase.from('home_devices').update({ revoked_at: new Date().toISOString() }).eq('id', id)
    lsSet(DEVICE_KEY, null)
    await supabase.auth.signOut({ scope: 'local' })
  }

  const row = 'flex flex-wrap items-center gap-3'
  const pill = (on: boolean) =>
    `casa-press h-12 rounded-full px-5 text-[1.05rem] font-semibold sm:h-14 sm:px-6 sm:text-[1.1rem] ${on ? 'text-white' : 'bg-(--surface)'}`

  const h3 = 'mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)'
  const choice = <T extends string | number>(value: T, cur: T, label: string, set: (v: T) => void, Icon?: LucideIcon) => (
    <button key={String(value)} onClick={() => set(value)} className={`${pill(cur === value)} inline-flex items-center gap-2`} style={cur === value ? { background: grad(GRAD.orb) } : undefined}>
      {Icon ? <Icon size={20} aria-hidden /> : null}
      {label}
    </button>
  )

  return (
    <Grow
      ref={ref}
      origin={origin}
      onBackdrop={onClose}
      radius={36}
      className="top-2 right-2 bottom-2 w-[min(35rem,calc(100vw-16px))] bg-(--bg) sm:top-6 sm:right-6 sm:bottom-6 sm:w-[min(35rem,calc(100vw-48px))]"
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-4 px-5 pt-[clamp(14px,3dvh,32px)] pb-3 sm:px-8">
          <h2 className="font-display min-w-0 flex-1 truncate text-[clamp(1.6rem,min(6vw,6dvh),2.3rem)] leading-tight">{t('casa.settings.title')}</h2>
          <button onClick={onClose} aria-label={t('casa.close')} className="casa-press inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-(--surface)">
            <X size={28} aria-hidden />
          </button>
        </header>
        <div className="casa-scroll flex min-h-0 flex-1 flex-col gap-[clamp(18px,3.5dvh,28px)] px-5 pt-2 pb-8 sm:px-8">

        <section>
          <h3 className={h3}>{t('casa.settings.display')}</h3>
          <div className={row}>
            {(
              [
                ['panel', t('casa.settings.layoutPanel'), PanelsTopLeft],
                ['widgets', t('casa.settings.layoutWidgets'), LayoutGrid],
              ] as const
            ).map(([v, l, I]) => choice<LayoutPref>(v, prefs.layout, l, (x) => setPrefs({ layout: x }), I))}
          </div>
          <p className="mt-2 text-[0.95rem] text-(--text-muted)">
            {prefs.layout === 'panel' ? t('casa.settings.layoutPanelHint') : t('casa.settings.layoutWidgetsHint')}
          </p>
        </section>

        <section>
          <h3 className={h3}>{t('casa.settings.theme')}</h3>
          <div className={row}>
            {(
              [
                ['auto', t('casa.settings.themeAuto'), Monitor],
                ['light', t('casa.settings.themeLight'), Sun],
                ['dark', t('casa.settings.themeDark'), Moon],
              ] as const
            ).map(([v, l, I]) => choice<ThemePref>(v, prefs.theme, l, (x) => setPrefs({ theme: x }), I))}
          </div>
        </section>

        <section>
          <h3 className={h3}>{t('casa.settings.frame')}</h3>
          <div className={row}>
            {([0, 5, 15, 30] as const).map((v) =>
              choice<FrameIdle>(v, prefs.frameIdle, v ? t('casa.settings.frameMin', { count: v }) : t('casa.settings.frameOff'), (x) => setPrefs({ frameIdle: x })),
            )}
          </div>
          <p className="mt-2 text-[0.95rem] text-(--text-muted)">{t('casa.settings.frameHint')}</p>
        </section>

        <section>
          <h3 className={h3}>{t('casa.settings.weather')}</h3>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void saveCity()
            }}
          >
            <span className="relative flex min-w-0 flex-1 items-center">
              <MapPin size={22} className="pointer-events-none absolute left-5 text-(--text-faint)" aria-hidden />
              <input
                value={city}
                onChange={(e) => {
                  setCity(e.target.value)
                  setState('idle')
                }}
                placeholder={t('casa.settings.cityPlaceholder')}
                className="h-16 w-full rounded-[20px] border border-(--surface-2) bg-(--card) pr-4 pl-13 text-[1.2rem] outline-none"
                style={{ fontSize: '1.2rem', paddingLeft: 52 }}
              />
            </span>
            <button type="submit" className="casa-press h-16 shrink-0 rounded-[20px] px-5 text-[1.1rem] font-semibold text-white" style={{ background: grad(GRAD.orb) }}>
              {state === 'busy' ? '…' : state === 'ok' ? <Check size={24} aria-hidden /> : t('common.save')}
            </button>
          </form>
          {state === 'bad' ? <p className="mt-2 text-[1rem] text-(--expense)">{t('casa.settings.cityNotFound')}</p> : null}
          <div className={`${row} mt-4`}>
            {(['celsius', 'fahrenheit'] as const).map((u) => (
              <button key={u} onClick={() => setUnit(u)} className={pill(unit === u)} style={unit === u ? { background: grad(GRAD.orb) } : undefined}>
                {u === 'celsius' ? '°C' : '°F'}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className={h3}>{t('casa.settings.language')}</h3>
          <div className={row}>
            {LANGUAGES.map((l) => (
              <button key={l.id} onClick={() => setLang(l.id)} className={pill(lang === l.id)} style={lang === l.id ? { background: grad(GRAD.orb) } : undefined}>
                <span aria-hidden>{l.flag}</span> {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-auto pt-2">
          {confirm ? (
            <div className="casa-fade rounded-[24px] bg-(--surface) p-5">
              <p className="text-[1.15rem]">{t('casa.settings.unpairConfirm')}</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setConfirm(false)} className="casa-press h-14 flex-1 rounded-full bg-(--card) text-[1.1rem] font-semibold">
                  {t('common.cancel')}
                </button>
                <button onClick={() => void unpair()} className="casa-press h-14 flex-1 rounded-full bg-(--expense) text-[1.1rem] font-semibold text-white">
                  {t('casa.settings.unpair')}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)} className="casa-press inline-flex h-14 items-center gap-2 rounded-full px-5 text-[1.1rem] font-semibold text-(--expense)">
              <LogOut size={22} aria-hidden />
              {t('casa.settings.unpair')}
            </button>
          )}
        </section>
        </div>
      </div>
    </Grow>
  )
})

export const PlanSheet = forwardRef<GrowHandle, { origin: DOMRect | null; onClose: () => void }>(function PlanSheet({ origin, onClose }, ref) {
  const { t } = useI18n()
  const perks = [t('casa.plan.perk1'), t('casa.plan.perk2'), t('casa.plan.perk3'), t('casa.plan.perk4')]
  return (
    <Grow
      ref={ref}
      origin={origin}
      onBackdrop={onClose}
      tint={GRAD.orb}
      radius={40}
      className="inset-0 m-auto h-fit w-[min(40rem,calc(100vw-24px))] bg-(--bg)"
    >
      <div className="casa-scroll max-h-[calc(100dvh-24px)] p-[clamp(20px,4vmin,2.5rem)]">
        <div className="flex items-start gap-[clamp(12px,2.5vmin,20px)]">
          <span className="hidden min-[420px]:inline-flex">
            <IconChip icon={Sparkles} g={GRAD.orb} size={64} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[clamp(1.7rem,min(6vw,6dvh),2.4rem)] leading-tight">{t('casa.plan.title')}</h2>
            <p className="mt-2 text-[clamp(1.02rem,2.6dvh,1.2rem)] text-(--text-muted)">{t('casa.plan.body')}</p>
          </div>
        </div>
        <ul className="mt-[clamp(14px,3dvh,28px)] space-y-[clamp(6px,1.2dvh,12px)]">
          {perks.map((p, i) => (
            <li key={i} className="casa-rise flex items-center gap-3 text-[clamp(1.05rem,2.8dvh,1.25rem)]" style={{ ['--i' as string]: i + 1 }}>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: grad(GRAD.orb) }}>
                <Check size={20} strokeWidth={3} aria-hidden />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-[clamp(14px,3.5dvh,32px)] flex items-center gap-3 rounded-[22px] bg-(--surface) p-[clamp(12px,2.4dvh,20px)] text-[clamp(1rem,2.6dvh,1.15rem)]">
          <Smartphone size={26} className="shrink-0" aria-hidden />
          {t('casa.plan.howTo')}
        </p>
        <button onClick={onClose} className="casa-press mt-[clamp(12px,3dvh,24px)] h-14 w-full rounded-full text-[1.2rem] sm:h-16 font-semibold text-white" style={{ background: grad(GRAD.orb) }}>
          {t('casa.plan.ok')}
        </button>
      </div>
    </Grow>
  )
})
