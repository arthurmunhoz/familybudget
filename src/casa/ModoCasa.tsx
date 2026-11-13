// Modo Casa — the whole web app now (owner, 2026-11): a spare device at home
// becomes the family's hub. No session → pairing; signed in → the hub.
// Light/dark follow the system; the screen stays awake where the browser
// lets us (Wake Lock API).
import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import { useTheme } from '../hooks/useTheme'
import { supabase } from '../lib/supabase'
import Hub from './Hub'
import Pairing, { HomeArt } from './Pairing'
import { useDeviceWatch } from './session'
import { DEVICE_KEY, GRAD, grad, lsSet } from './util'
import './casa.css'

function useSystemTheme() {
  const { setTheme } = useTheme()
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setTheme(mq.matches ? 'dark' : 'light')
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [setTheme])
}

type WakeLockSentinel = { release: () => Promise<void> }
function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on) return
    const nav = navigator as unknown as { wakeLock?: { request: (k: 'screen') => Promise<WakeLockSentinel> } }
    if (!nav.wakeLock) return
    let lock: WakeLockSentinel | null = null
    const get = () => {
      if (document.visibilityState !== 'visible') return
      nav.wakeLock!
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {})
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      document.removeEventListener('visibilitychange', get)
      void lock?.release().catch(() => {})
    }
  }, [on])
}

export default function ModoCasa() {
  const { session, profile, loading, profileLoaded } = useAuth()
  const { t } = useI18n()
  useSystemTheme()
  useDeviceWatch(!!session)
  useKeepAwake(!!session && !!profile)

  if (loading || (session && !profileLoaded)) {
    return (
      <div className="casa-root flex items-center justify-center">
        <HomeArt size={120} />
      </div>
    )
  }
  if (!session) return <Pairing />
  if (!profile) {
    // Signed in, but not in a family (left it on the phone): pair again.
    return (
      <div className="casa-root flex flex-col items-center justify-center gap-6 p-10 text-center">
        <HomeArt size={130} />
        <p className="font-display max-w-[24ch] text-[2.4rem] leading-tight">{t('casa.noFamily')}</p>
        <button
          onClick={() => {
            lsSet(DEVICE_KEY, null)
            void supabase.auth.signOut({ scope: 'local' })
          }}
          className="casa-press h-16 rounded-full px-8 text-[1.2rem] font-semibold text-white"
          style={{ background: grad(GRAD.frame) }}
        >
          {t('casa.pairAgain')}
        </button>
      </div>
    )
  }
  return <Hub />
}
