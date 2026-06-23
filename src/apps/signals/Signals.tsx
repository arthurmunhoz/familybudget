import { useMemo, useState } from 'react'
import SignalsBanner from '../../components/SignalsBanner'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import type { TKey } from '../../lib/i18n'
import { SIGNAL_PRESETS, sendCustomSignal, sendSignal } from '../../lib/signals'

/** Signals app: compose a household ping. Pick recipients (default everyone),
 *  tap a preset or type free text (AI maps it). Active signals show up top via
 *  the shared banner. "Need a hand" always goes to everyone. */
export default function Signals() {
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  // Other household members are the targetable recipients.
  const members = useMemo(
    () => profiles.filter((p) => p.email !== myEmail),
    [profiles, myEmail],
  )

  // Default: everyone selected. all-or-none selected → treated as "everyone".
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.map((m) => m.email)),
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [text, setText] = useState('')
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const sending = busyKind !== null || aiBusy

  const everyone = selected.size === 0 || selected.size === members.length

  /** null = whole household; else the chosen emails. `help` always = everyone. */
  function recipientsFor(kind: string): string[] | null {
    if (kind === 'help' || everyone) return null
    return [...selected]
  }

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  const toLabel = everyone
    ? t('signals.everyone')
    : members
        .filter((m) => selected.has(m.email))
        .map((m) => m.display_name)
        .join(', ') || t('signals.everyone')

  async function preset(kind: string, emoji: string) {
    if (sending) return
    setBusyKind(kind)
    try {
      await sendSignal(kind, emoji, t(`signals.preset.${kind}` as TKey), recipientsFor(kind))
    } catch {
      alert(t('signals.failed'))
    }
    setBusyKind(null)
  }

  async function sendAI() {
    const value = text.trim()
    if (!value || sending) return
    setAiBusy(true)
    try {
      await sendCustomSignal(value, recipientsFor('custom'))
      setText('')
    } catch {
      alert(t('signals.failed'))
    }
    setAiBusy(false)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">
          📣 {t('app.signals.name')}
        </h1>
      </header>

      {/* incoming / active signals */}
      <SignalsBanner />

      {/* recipient picker (hidden when there's nobody else to target) */}
      {members.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-xl bg-(--card) px-4 py-3 text-left"
          >
            <span className="text-(--text-faint)">{t('signals.to')}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-(--text)">
              {toLabel}
            </span>
            <span className="shrink-0 text-(--text-faint)">{pickerOpen ? '▴' : '▾'}</span>
          </button>
          {pickerOpen && (
            <div className="mt-1 space-y-1 rounded-xl bg-(--card) p-1">
              <button
                onClick={() => setSelected(new Set(members.map((m) => m.email)))}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left"
              >
                <span className="flex-1 text-sm font-semibold text-(--text)">
                  {t('signals.everyone')}
                </span>
                {everyone && <span className="text-(--accent)">✓</span>}
              </button>
              {members.map((m) => {
                const on = !everyone && selected.has(m.email)
                return (
                  <button
                    key={m.email}
                    onClick={() => toggle(m.email)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                  >
                    <span className="flex-1 truncate text-sm text-(--text)">
                      {m.display_name}
                    </span>
                    {on && <span className="text-(--accent)">✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* preset signals */}
      <div className="grid grid-cols-2 gap-2.5">
        {SIGNAL_PRESETS.map((p) => (
          <button
            key={p.kind}
            onClick={() => preset(p.kind, p.emoji)}
            disabled={sending}
            className="flex items-center gap-3 rounded-2xl bg-(--card) px-4 py-3.5 text-left active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            <span className="text-2xl">{busyKind === p.kind ? '…' : p.emoji}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-(--text)">
              {t(`signals.preset.${p.kind}` as TKey)}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-(--text-faint)">🆘 {t('signals.helpNote')}</p>

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
          className="min-w-0 flex-1 rounded-xl bg-(--card) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent) disabled:opacity-50"
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
  )
}
