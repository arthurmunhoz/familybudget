import { useEffect, useMemo, useRef, useState } from 'react'
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

  // --- preset ordering: drag the grip to reorder; saved per device. ---
  const presetByKind = useMemo(
    () => Object.fromEntries(SIGNAL_PRESETS.map((p) => [p.kind, p])),
    [],
  )
  const storageKey = `signals-order:${myEmail ?? ''}`
  const [order, setOrder] = useState<string[]>(() => SIGNAL_PRESETS.map((p) => p.kind))
  const orderRef = useRef(order)
  orderRef.current = order
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  // Load the saved order once; keep only known presets, append any new ones.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const saved = (JSON.parse(raw) as string[]).filter((k) => k in presetByKind)
      const all = SIGNAL_PRESETS.map((p) => p.kind)
      setOrder([...saved, ...all.filter((k) => !saved.includes(k))])
    } catch {
      // ignore bad/missing storage
    }
  }, [storageKey, presetByKind])

  function startDrag(e: React.PointerEvent, index: number) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragIndex(index)
  }
  function onDrag(e: React.PointerEvent) {
    if (dragIndex === null) return
    const y = e.clientY
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i]
      if (!el || i === dragIndex) continue
      const r = el.getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) {
        setOrder((prev) => {
          const next = [...prev]
          const [moved] = next.splice(dragIndex, 1)
          next.splice(i, 0, moved)
          return next
        })
        setDragIndex(i)
        break
      }
    }
  }
  function endDrag() {
    if (dragIndex === null) return
    setDragIndex(null)
    try {
      localStorage.setItem(storageKey, JSON.stringify(orderRef.current))
    } catch {
      // ignore storage failures
    }
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

      {/* preset signals — one per line, drag the grip to reorder */}
      <div className="space-y-2.5">
        {order.map((kind, index) => {
          const p = presetByKind[kind]
          if (!p) return null
          const isHelp = kind === 'help'
          const dragging = dragIndex === index
          return (
            <div
              key={kind}
              ref={(el) => {
                rowRefs.current[index] = el
              }}
              className={`flex items-center rounded-2xl border-2 bg-(--card) transition-shadow ${
                isHelp ? 'border-(--expense)' : 'border-transparent'
              } ${dragging ? 'opacity-95 shadow-lg ring-2 ring-(--accent)' : ''}`}
            >
              <button
                onClick={() => preset(p.kind, p.emoji)}
                disabled={sending}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                <span className="text-2xl">{busyKind === p.kind ? '…' : p.emoji}</span>
                <span className="font-semibold text-(--text)">
                  {t(`signals.preset.${p.kind}` as TKey)}
                </span>
              </button>
              <span
                role="button"
                aria-label={t('signals.reorder')}
                onPointerDown={(e) => startDrag(e, index)}
                onPointerMove={onDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={`shrink-0 touch-none select-none px-4 py-3.5 text-xl text-(--text-faint) ${
                  dragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              >
                ⠿
              </span>
            </div>
          )
        })}
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
