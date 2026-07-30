import { useEffect, useState } from 'react'
import { Share, Smartphone, X } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { isStandalone } from '../lib/push'
import {
  canInstall,
  dismissInstallPrompt,
  isInstallPromptDismissed,
  needsIosInstructions,
  promptInstall,
  subscribeInstall,
} from '../lib/install'

/**
 * "Install One Roof" card, shown on the Hub while the app is running in a browser
 * tab. Android Chrome gets a real one-tap install button (we hold on to its
 * `beforeinstallprompt` event); iOS Safari gets the Share → Add to Home Screen
 * instruction, since Safari has no programmatic equivalent.
 *
 * Renders nothing once installed, once dismissed, or on a browser that offers
 * neither path (e.g. desktop Firefox) — an un-actionable prompt is just noise.
 */
export default function InstallPrompt() {
  const { t } = useI18n()
  const [installable, setInstallable] = useState(canInstall)
  const [dismissed, setDismissed] = useState(isInstallPromptDismissed)

  // The beforeinstallprompt event usually lands before this mounts, but not
  // always — subscribe so a late one still shows the card.
  useEffect(() => subscribeInstall(() => setInstallable(canInstall())), [])

  const ios = needsIosInstructions()
  if (dismissed || isStandalone() || (!installable && !ios)) return null

  function hide() {
    dismissInstallPrompt()
    setDismissed(true)
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-(--accent-soft) bg-(--card) p-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent)">
        <Smartphone size={18} strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-(--text)">{t('install.title')}</p>
        <p className="mt-0.5 text-sm text-(--text-faint)">{t('install.body')}</p>
        {ios ? (
          // Nothing to tap — name the button they're looking for instead.
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-(--accent)">
            <Share size={14} strokeWidth={2} aria-hidden="true" />
            {t('install.iosBody')}
          </p>
        ) : (
          <button
            onClick={() => void promptInstall()}
            className="mt-3 w-full rounded-xl bg-(--accent) py-2.5 font-bold text-white active:scale-[0.98] transition-transform"
          >
            {t('install.btn')}
          </button>
        )}
      </div>
      <button
        onClick={hide}
        aria-label={t('install.dismiss')}
        className="shrink-0 p-1 text-(--text-faint) active:text-(--text)"
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
