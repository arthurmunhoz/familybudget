import { useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useScrollLock } from '../hooks/useScrollLock'
import type { TKey } from '../lib/i18n'
import { SIGNAL_PRESETS, sendCustomSignal, sendSignal } from '../lib/signals'

/** Bottom-sheet for sending a household signal: a grid of one-tap presets plus
 *  an AI "just type it" box that maps free text to a signal. */
export default function SignalSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  useScrollLock(true)
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const sending = busyKind !== null || aiBusy

  async function preset(kind: string, emoji: string) {
    if (sending) return
    setBusyKind(kind)
    try {
      await sendSignal(kind, emoji, t(`signals.preset.${kind}` as TKey))
      onClose()
    } catch {
      alert(t('signals.failed'))
      setBusyKind(null)
    }
  }

  async function sendAI() {
    const value = text.trim()
    if (!value || sending) return
    setAiBusy(true)
    try {
      await sendCustomSignal(value)
      onClose()
    } catch {
      alert(t('signals.failed'))
      setAiBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="mx-auto flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-1">
          <h2 className="text-lg font-bold text-(--text)">{t('signals.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="px-2 py-1 text-(--text-muted) active:text-(--text)"
          >
            ✕
          </button>
        </div>
        <p className="shrink-0 px-4 pb-3 text-sm text-(--text-faint)">{t('signals.subtitle')}</p>

        <div
          className="flex-1 overflow-y-auto overscroll-contain px-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          {/* one-tap presets */}
          <div className="grid grid-cols-2 gap-2.5">
            {SIGNAL_PRESETS.map((p) => (
              <button
                key={p.kind}
                onClick={() => preset(p.kind, p.emoji)}
                disabled={sending}
                className="flex items-center gap-3 rounded-2xl bg-(--surface) px-4 py-3.5 text-left active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <span className="text-2xl">{busyKind === p.kind ? '…' : p.emoji}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-(--text)">
                  {t(`signals.preset.${p.kind}` as TKey)}
                </span>
              </button>
            ))}
          </div>

          {/* AI free-text */}
          <div className="my-4 flex items-center gap-3 text-xs text-(--text-faint)">
            <span className="h-px flex-1 bg-(--surface-2)" />
            {t('signals.or')}
            <span className="h-px flex-1 bg-(--surface-2)" />
          </div>

          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendAI()
              }}
              placeholder={t('signals.aiPlaceholder')}
              disabled={aiBusy}
              className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent) disabled:opacity-50"
            />
            <button
              onClick={sendAI}
              disabled={!text.trim() || sending}
              className="shrink-0 rounded-xl bg-(--accent) px-4 font-bold text-white disabled:opacity-50"
            >
              {aiBusy ? '…' : t('signals.send')}
            </button>
          </div>
          <p className="mt-2 text-xs text-(--text-faint)">✨ {t('signals.aiHint')}</p>
        </div>
      </div>
    </div>
  )
}
