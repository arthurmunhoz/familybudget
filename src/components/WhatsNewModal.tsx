import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import { useScrollLock } from '../hooks/useScrollLock'
import { enablePush, isSubscribed, pushState } from '../lib/push'

// Bump the version suffix to re-show the modal after a future announcement.
const SEEN_KEY = 'oneroof:whatsnew:v1:'

/** One-time welcome modal: announces the new family-sync features and offers to
 *  turn on notifications (which several of them depend on). Shows once per user
 *  per version, then never again. */
export default function WhatsNewModal() {
  const { profile } = useAuth()
  const { t } = useI18n()
  const email = profile?.email ?? ''
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [busy, setBusy] = useState(false)

  useScrollLock(open)

  useEffect(() => {
    if (!email) return
    let seen = false
    try {
      seen = localStorage.getItem(SEEN_KEY + email) === '1'
    } catch {
      seen = false
    }
    if (seen) return
    const s = pushState()
    void isSubscribed().then((sub) => {
      setActive(s === 'granted' && sub)
      setNeedsInstall(s === 'needs-install')
      setOpen(true)
    })
  }, [email])

  function close() {
    try {
      localStorage.setItem(SEEN_KEY + email, '1')
    } catch {
      // ignore storage failures
    }
    setOpen(false)
  }

  async function enable() {
    if (busy) return
    setBusy(true)
    try {
      const result = await enablePush()
      if (result === 'granted') setActive(true)
      else if (result === 'needs-install') setNeedsInstall(true)
    } catch {
      // leave the modal so they can retry or dismiss
    }
    setBusy(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-(--card) p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-(--text)">✨ {t('intro.title')}</h2>
        <p className="mt-1 text-sm text-(--text-faint)">{t('intro.subtitle')}</p>

        <div className="mt-4 space-y-3">
          <Feature emoji="📣" title={t('intro.pingsTitle')} desc={t('intro.pingsDesc')} />
          <Feature
            emoji="🔔"
            title={t('intro.remindersTitle')}
            desc={t('intro.remindersDesc')}
          />
        </div>

        {active ? (
          <>
            <p className="mt-5 text-sm font-semibold text-(--accent)">
              ✅ {t('intro.allSet')}
            </p>
            <button
              onClick={close}
              className="mt-3 w-full rounded-2xl bg-(--accent) py-3 font-bold text-white active:scale-[0.98] transition-transform"
            >
              {t('intro.gotIt')}
            </button>
          </>
        ) : (
          <>
            <p className="mt-5 text-sm text-(--text-muted)">{t('intro.needNotif')}</p>
            {needsInstall && (
              <p className="mt-1 text-xs text-(--text-faint)">{t('drawer.notifInstall')}</p>
            )}
            <button
              onClick={enable}
              disabled={busy}
              className="mt-3 w-full rounded-2xl bg-(--accent) py-3 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {busy ? t('drawer.working') : t('notif.enable')}
            </button>
            <button
              onClick={close}
              className="mt-2 w-full py-1.5 text-xs font-medium text-(--text-faint)"
            >
              {t('intro.later')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Feature({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-2xl">{emoji}</span>
      <div className="min-w-0">
        <p className="font-semibold text-(--text)">{title}</p>
        <p className="text-xs text-(--text-faint)">{desc}</p>
      </div>
    </div>
  )
}
