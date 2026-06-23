import { useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { enablePush, isSubscribed, pushState, type PushState } from '../lib/push'

/** Inline prompt shown inside a feature when this device can't receive push
 *  notifications, with a one-tap way to turn them on. Renders nothing once
 *  notifications are active (or when the device can't support them at all). */
export default function NotificationsNudge() {
  const { t } = useI18n()
  const [state, setState] = useState<PushState | 'loading'>('loading')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const s = pushState()
    if (s === 'granted') setState((await isSubscribed()) ? 'granted' : 'default')
    else setState(s)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // Active, still checking, or nothing the user can do → show nothing.
  if (state === 'loading' || state === 'granted' || state === 'unsupported') return null

  async function enable() {
    if (busy) return
    setBusy(true)
    try {
      const result = await enablePush()
      setState(result === 'granted' ? 'granted' : result)
    } catch {
      // leave the prompt up so they can retry
    }
    setBusy(false)
  }

  // Shown under the button for the states where the OS prompt can't proceed
  // (iOS needs the installed PWA; a prior "deny" must be cleared in settings).
  const hint =
    state === 'needs-install'
      ? t('drawer.notifInstall')
      : state === 'denied'
        ? t('drawer.notifDenied')
        : null

  return (
    <div className="mb-4 rounded-2xl border border-(--accent-soft) bg-(--card) p-4">
      <p className="font-semibold text-(--text)">🔔 {t('notif.offTitle')}</p>
      <p className="mt-1 text-sm text-(--text-faint)">{t('notif.offBody')}</p>
      <button
        onClick={enable}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-(--accent) py-2.5 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
      >
        {busy ? t('drawer.working') : t('notif.enable')}
      </button>
      {hint && <p className="mt-2 text-xs text-(--text-faint)">{hint}</p>}
    </div>
  )
}
