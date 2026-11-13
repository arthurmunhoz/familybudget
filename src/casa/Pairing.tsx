// Modo Casa — pairing (no session yet). The device asks the API for a short
// code + a secret only it knows, shows the code as a QR (the phone's camera
// opens the app on oneroof://casa?code=…), and polls every 2 s until a member
// claims it from the phone. Then it trades the one-time token for its own
// Supabase session. Codes expire (410) → a fresh one appears by itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { RefreshCw, Smartphone, Settings2, ScanLine, Wrench } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { saveHomeLocation } from '../lib/weather'
import { supabase } from '../lib/supabase'
import { API_BASE, DEVICE_KEY, GRAD, grad, lsSet, prettyCode } from './util'
import { CheckMark } from './ui'

const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL as string | undefined
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD as string | undefined

type Phase =
  | { k: 'loading' }
  | { k: 'code'; code: string; secret: string; svg: string }
  | { k: 'error'; retryIn: number }
  | { k: 'joining' }

export default function Pairing() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>({ k: 'loading' })
  const fails = useRef(0)
  const alive = useRef(true)

  const start = useCallback(async () => {
    setPhase({ k: 'loading' })
    try {
      const res = await fetch(`${API_BASE}/api/widget?action=casa-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as { code?: string; secret?: string }
      if (!j.code || !j.secret) throw new Error('bad')
      const svg = await QRCode.toString(`oneroof://casa?code=${j.code}`, {
        type: 'svg',
        margin: 0,
        errorCorrectionLevel: 'M',
        color: { dark: '#2b2521', light: '#00000000' },
      })
      if (!alive.current) return
      fails.current = 0
      setPhase({ k: 'code', code: j.code, secret: j.secret, svg })
    } catch {
      if (!alive.current) return
      fails.current++
      setPhase({ k: 'error', retryIn: Math.min(60, 5 * fails.current) })
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void start()
    return () => {
      alive.current = false
    }
  }, [start])

  // Error: count down and try again on our own.
  useEffect(() => {
    if (phase.k !== 'error') return
    if (phase.retryIn <= 0) {
      void start()
      return
    }
    const id = setTimeout(() => setPhase({ k: 'error', retryIn: phase.retryIn - 1 }), 1000)
    return () => clearTimeout(id)
  }, [phase, start])

  // Poll while a code is showing.
  useEffect(() => {
    if (phase.k !== 'code') return
    let stop = false
    const { code, secret } = phase
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/widget?action=casa-poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, secret }),
        })
        if (stop) return
        if (res.status === 410 || res.status === 404) {
          stop = true
          clearInterval(id)
          void start()
          return
        }
        if (!res.ok) return
        const j = (await res.json()) as { pending?: boolean; token_hash?: string; device_id?: string; household_id?: string; home_loc?: { city?: string; lat?: number; lon?: number } | null }
        if (j.pending || !j.token_hash) return
        stop = true
        clearInterval(id)
        setPhase({ k: 'joining' })
        const { error } = await supabase.auth.verifyOtp({ token_hash: j.token_hash, type: 'magiclink' })
        if (error) {
          void start()
          return
        }
        if (j.device_id) lsSet(DEVICE_KEY, j.device_id)
        // The phone's home city came with the pairing: the weather and its sky
        // show right away, no setup (owner, 2026-11).
        const hl = j.home_loc
        if (hl && typeof hl.lat === 'number' && typeof hl.lon === 'number' && hl.city) {
          saveHomeLocation({ city: hl.city, lat: hl.lat, lon: hl.lon })
        }
      } catch {
        /* offline for a moment — keep polling */
      }
    }, 2000)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [phase, start])

  async function devLogin() {
    const { error } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL ?? '', password: DEV_PASSWORD ?? '' })
    if (error) alert(`Dev login failed: ${error.message}`)
  }

  const steps = [
    { icon: Smartphone, text: t('casa.pair.step1') },
    { icon: Settings2, text: t('casa.pair.step2') },
    { icon: ScanLine, text: t('casa.pair.step3') },
  ]

  return (
    <div className="casa-root flex items-center justify-center">
      <div className="casa-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="relative grid w-full max-w-[1180px] items-center gap-10 px-8 py-10 landscape:grid-cols-[1.1fr_1fr] landscape:gap-16 portrait:max-w-[720px]">
        <section className="casa-rise portrait:text-center" style={{ ['--i' as string]: 0 }}>
          <div className="portrait:flex portrait:justify-center">
            <HomeArt size={150} />
          </div>
          <h1 className="font-display mt-6 text-[clamp(3.2rem,6.4vw,5.6rem)] leading-[0.95] tracking-tight">{t('casa.name')}</h1>
          <p className="mt-4 max-w-[30ch] text-[clamp(1.25rem,2.1vw,1.7rem)] leading-snug text-(--text-muted) portrait:mx-auto">{t('casa.pair.tagline')}</p>
          <ol className="mt-9 space-y-4 portrait:mx-auto portrait:max-w-[460px] portrait:text-left">
            {steps.map((s, i) => (
              <li key={i} className="casa-rise flex items-center gap-4" style={{ ['--i' as string]: i + 2 }}>
                <span
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
                  style={{ background: grad(GRAD.frame), boxShadow: '0 10px 24px -12px #E2507E' }}
                >
                  <s.icon size={24} strokeWidth={2.1} aria-hidden />
                </span>
                <span className="text-[1.25rem] leading-snug font-medium">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="casa-rise flex justify-center" style={{ ['--i' as string]: 1 }}>
          <div className="casa-card relative w-full max-w-[460px] rounded-[40px] p-9 text-center">
            {phase.k === 'code' ? (
              <div key={phase.code} className="casa-fade">
                <div className="mx-auto aspect-square w-[min(300px,70vw)] rounded-[28px] bg-white p-6 shadow-[inset_0_0_0_1px_rgb(0_0_0/.06)]">
                  <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: phase.svg }} />
                </div>
                <p className="mt-7 text-[15px] font-semibold uppercase tracking-[0.18em] text-(--text-faint)">{t('casa.pair.orCode')}</p>
                <p className="font-display mt-1 text-[3.4rem] leading-none tracking-[0.06em]">{prettyCode(phase.code)}</p>
                <p className="mt-5 flex items-center justify-center gap-2 text-[15px] text-(--text-muted)">
                  <span className="relative inline-flex h-2.5 w-2.5">
                    <span className="casa-breathe absolute inset-0 rounded-full bg-[#3f8f6a]" />
                    <span className="relative h-2.5 w-2.5 rounded-full bg-[#3f8f6a]" />
                  </span>
                  {t('casa.pair.waiting')}
                </p>
              </div>
            ) : phase.k === 'joining' ? (
              <div className="casa-fade flex min-h-[460px] flex-col items-center justify-center gap-5">
                <span className="rounded-full p-5" style={{ background: grad(GRAD.money) }}>
                  <CheckMark size={84} />
                </span>
                <p className="font-display text-[2.2rem]">{t('casa.pair.joining')}</p>
              </div>
            ) : phase.k === 'error' ? (
              <div className="casa-fade flex min-h-[460px] flex-col items-center justify-center gap-4">
                <div className="mx-auto flex aspect-square w-[220px] items-center justify-center rounded-[28px] bg-(--surface)">
                  <RefreshCw size={56} className="text-(--text-faint)" aria-hidden />
                </div>
                <p className="font-display mt-2 text-[1.9rem] leading-tight">{t('casa.pair.errorTitle')}</p>
                <p className="max-w-[32ch] text-[1.05rem] text-(--text-muted)">{t('casa.pair.errorBody', { s: phase.retryIn })}</p>
                <button
                  onClick={() => void start()}
                  className="casa-press mt-3 inline-flex h-14 items-center gap-2 rounded-full px-7 text-[1.1rem] font-semibold text-white"
                  style={{ background: grad(GRAD.frame) }}
                >
                  <RefreshCw size={20} aria-hidden />
                  {t('casa.pair.retry')}
                </button>
              </div>
            ) : (
              <div className="flex min-h-[460px] flex-col items-center justify-center gap-6">
                <div className="casa-shimmer mx-auto aspect-square w-[min(300px,70vw)] rounded-[28px]" />
                <div className="casa-shimmer h-12 w-60 rounded-2xl" />
              </div>
            )}
          </div>
        </section>
      </div>

      {import.meta.env.DEV && DEV_EMAIL ? (
        <button
          onClick={devLogin}
          className="absolute bottom-6 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-(--surface-2) px-5 py-3 text-[15px] font-semibold text-(--text-muted)"
        >
          <Wrench size={16} aria-hidden />
          {t('casa.pair.dev')}
        </button>
      ) : null}
    </div>
  )
}

/** The Modo Casa art: a little standing screen showing the sunset-and-roof
 *  scene (the phone's photo-frame look), breathing slowly, window aglow. */
export function HomeArt({ size = 140 }: { size?: number }) {
  return (
    <svg className="casa-breathe-slow" width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <linearGradient id="casaWood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C98A5A" />
          <stop offset="1" stopColor="#8E5634" />
        </linearGradient>
        <linearGradient id="casaSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF8A5B" />
          <stop offset="0.7" stopColor="#E2507E" />
          <stop offset="1" stopColor="#7A3C8C" />
        </linearGradient>
        <radialGradient id="casaGlow">
          <stop offset="0" stopColor="#FFE29A" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFE29A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M60 92 L74 114" stroke="#7A4A2C" strokeWidth={5} strokeLinecap="round" />
      <rect x={22} y={110} width={76} height={5} rx={2.5} fill="#000" opacity={0.08} />
      <rect x={10} y={16} width={100} height={78} rx={10} fill="url(#casaWood)" />
      <rect x={16} y={22} width={88} height={66} rx={5} fill="#FFF6EC" />
      <rect x={20} y={26} width={80} height={58} rx={3} fill="url(#casaSky)" />
      <circle cx={80} cy={42} r={8} fill="#FFE29A" />
      <path d="M20 70 Q40 58 60 66 T100 62 L100 84 L20 84 Z" fill="#5B2A6E" opacity={0.55} />
      <path d="M40 84 L40 66 L54 55 L68 66 L68 84 Z" fill="#2E1838" opacity={0.9} />
      <circle className="casa-window-glow" cx={54} cy={75} r={11} fill="url(#casaGlow)" />
      <rect x={50} y={72} width={8} height={12} rx={1.5} fill="#FFE29A" opacity={0.95} />
    </svg>
  )
}
