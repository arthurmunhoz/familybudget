import { useEffect, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { disablePush, enablePush, isSubscribed, pushState, type PushState } from '../lib/push'

/** Drawer control to opt this device in/out of the daily reminder digest.
 *  Renders a plain hint (not a toggle) when push can't be enabled here — most
 *  importantly the "add to Home Screen" case on iOS. */
export default function NotificationsToggle() {
  const { t } = useI18n()
  const [state, setState] = useState<PushState>('default')
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setState(pushState())
    isSubscribed().then(setOn)
  }, [])

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (on) {
        await disablePush()
        setOn(false)
      } else {
        const result = await enablePush()
        setState(result)
        setOn(result === 'granted')
        if (result === 'denied') alert(t('drawer.notifDenied'))
      }
    } catch {
      alert(t('drawer.notifFailed'))
    }
    setBusy(false)
  }

  // States where a toggle would be pointless — explain instead.
  if (state === 'unsupported') {
    return (
      <div className="mt-6">
        <span className="text-sm text-(--text-muted)">{t('drawer.notifications')}</span>
        <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.notifUnsupported')}</p>
      </div>
    )
  }
  if (state === 'needs-install') {
    return (
      <div className="mt-6">
        <span className="text-sm text-(--text-muted)">{t('drawer.notifications')}</span>
        <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.notifInstall')}</p>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <span className="text-sm text-(--text-muted)">{t('drawer.notifications')}</span>
      <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.notifHint')}</p>
      <button
        onClick={toggle}
        disabled={busy || state === 'denied'}
        role="switch"
        aria-checked={on}
        className="mt-2 flex w-full items-center gap-2.5 rounded-xl bg-(--surface) px-4 py-3 text-left disabled:opacity-50"
      >
        <span className="flex-1 text-sm font-semibold text-(--text)">
          {busy ? t('drawer.working') : on ? t('drawer.notifOn') : t('drawer.notifEnable')}
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
      {state === 'denied' && (
        <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.notifDenied')}</p>
      )}
    </div>
  )
}
