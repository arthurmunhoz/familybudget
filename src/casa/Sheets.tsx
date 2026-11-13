// Modo Casa — the two small sheets: this device's settings (weather city,
// unit, language, unpair) and the calm "about Plus" note (no web checkout:
// it points to the phone app).
import { forwardRef, useState } from 'react'
import { Check, LogOut, MapPin, Smartphone, Sparkles, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { LANGUAGES } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { geocodeCity, saveHomeLocation, loadHomeLocation, type TempUnit } from '../lib/weather'
import { Grow, IconChip, type GrowHandle } from './ui'
import { DEVICE_KEY, GRAD, grad, lsSet } from './util'

export const SettingsSheet = forwardRef<
  GrowHandle,
  { origin: DOMRect | null; onClose: () => void; unit: TempUnit; setUnit: (u: TempUnit) => void; onCity: () => void }
>(function SettingsSheet({ origin, onClose, unit, setUnit, onCity }, ref) {
  const { t, lang, setLang } = useI18n()
  const [city, setCity] = useState(() => loadHomeLocation()?.city ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle')
  const [confirm, setConfirm] = useState(false)

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
    lsSet(DEVICE_KEY, null)
    await supabase.auth.signOut({ scope: 'local' })
  }

  const row = 'flex flex-wrap items-center gap-3'
  const pill = (on: boolean) =>
    `casa-press h-14 rounded-full px-6 text-[1.1rem] font-semibold ${on ? 'text-white' : 'bg-(--surface)'}`

  return (
    <Grow ref={ref} origin={origin} onBackdrop={onClose} radius={36} className="top-6 right-6 bottom-6 w-[min(560px,calc(100vw-48px))] bg-(--bg)">
      <div className="casa-scroll flex h-full flex-col gap-7 p-8">
        <header className="flex items-center gap-4">
          <h2 className="font-display flex-1 text-[2.3rem]">{t('casa.settings.title')}</h2>
          <button onClick={onClose} aria-label={t('casa.close')} className="casa-press inline-flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <X size={28} aria-hidden />
          </button>
        </header>

        <section>
          <h3 className="mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)">{t('casa.settings.weather')}</h3>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void saveCity()
            }}
          >
            <span className="relative flex flex-1 items-center">
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
            <button type="submit" className="casa-press h-16 rounded-[20px] px-6 text-[1.1rem] font-semibold text-white" style={{ background: grad(GRAD.orb) }}>
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
          <h3 className="mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.16em] text-(--text-faint)">{t('casa.settings.language')}</h3>
          <div className={row}>
            {LANGUAGES.map((l) => (
              <button key={l.id} onClick={() => setLang(l.id)} className={pill(lang === l.id)} style={lang === l.id ? { background: grad(GRAD.orb) } : undefined}>
                <span aria-hidden>{l.flag}</span> {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-auto">
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
      className="inset-0 m-auto h-fit max-h-[92vh] w-[min(640px,calc(100vw-40px))] bg-(--bg)"
    >
      <div className="p-10">
        <div className="flex items-start gap-5">
          <IconChip icon={Sparkles} g={GRAD.orb} size={72} />
          <div className="flex-1">
            <h2 className="font-display text-[2.4rem] leading-tight">{t('casa.plan.title')}</h2>
            <p className="mt-2 text-[1.2rem] text-(--text-muted)">{t('casa.plan.body')}</p>
          </div>
        </div>
        <ul className="mt-7 space-y-3">
          {perks.map((p, i) => (
            <li key={i} className="casa-rise flex items-center gap-3 text-[1.25rem]" style={{ ['--i' as string]: i + 1 }}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: grad(GRAD.orb) }}>
                <Check size={20} strokeWidth={3} aria-hidden />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-8 flex items-center gap-3 rounded-[22px] bg-(--surface) p-5 text-[1.15rem]">
          <Smartphone size={26} className="shrink-0" aria-hidden />
          {t('casa.plan.howTo')}
        </p>
        <button onClick={onClose} className="casa-press mt-6 h-16 w-full rounded-full text-[1.2rem] font-semibold text-white" style={{ background: grad(GRAD.orb) }}>
          {t('casa.plan.ok')}
        </button>
      </div>
    </Grow>
  )
})
