import { useMemo, useState } from 'react'
import { Bell, Check, ChevronDown, ChevronUp, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import NotificationsNudge from '../../components/NotificationsNudge'
import PingsBanner from '../../components/PingsBanner'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import {
  createPingPreset,
  deletePingPreset,
  fetchPingPresets,
  presetText,
  sendCustomPing,
  sendPing,
  updatePingPreset,
} from '../../lib/pings'
import type { PingPreset } from '../../lib/types'

/** Pings app: compose a household ping. Pick recipients (default everyone),
 *  tap a preset or type free text (AI maps it). Active pings show up top via
 *  the shared banner. High-priority presets always go to everyone.
 *  "Edit presets" flips the preset list into a manage mode: tap a preset to
 *  edit it, delete it, or add a new one (emoji + label + high-priority). */
export default function Pings() {
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  // Other household members are the targetable recipients.
  const members = useMemo(
    () => profiles.filter((p) => p.email !== myEmail),
    [profiles, myEmail],
  )

  const { data: presets = [], revalidate: reloadPresets } = useCachedQuery<PingPreset[]>(
    'ping:presets',
    fetchPingPresets,
  )

  // Default: everyone selected. all-or-none selected → treated as "everyone".
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [text, setText] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const sending = busyId !== null || aiBusy

  const [editMode, setEditMode] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PingPreset | null>(null)

  const everyone = selected.size === 0 || selected.size === members.length

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  const toLabel = everyone
    ? t('pings.everyone')
    : members
        .filter((m) => selected.has(m.email))
        .map((m) => m.display_name)
        .join(', ') || t('pings.everyone')

  async function sendPreset(p: PingPreset) {
    if (sending) return
    setBusyId(p.id)
    try {
      // High priority always goes to everyone; otherwise honor the picker.
      const recipients = p.high_priority || everyone ? null : [...selected]
      await sendPing(p.preset_key ?? 'custom', p.emoji, presetText(p, t), recipients, p.high_priority)
    } catch {
      alert(t('pings.failed'))
    }
    setBusyId(null)
  }

  async function sendAI() {
    const value = text.trim()
    if (!value || sending) return
    setAiBusy(true)
    try {
      await sendCustomPing(value, everyone ? null : [...selected])
      setText('')
    } catch {
      alert(t('pings.failed'))
    }
    setAiBusy(false)
  }

  function openNewPreset() {
    setEditing(null)
    setEditorOpen(true)
  }
  function openEditPreset(p: PingPreset) {
    setEditing(p)
    setEditorOpen(true)
  }
  async function confirmDeletePreset(p: PingPreset) {
    if (!confirm(t('pings.deletePresetConfirm'))) return
    await deletePingPreset(p.id)
    reloadPresets()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 flex items-center gap-2 text-2xl font-bold font-display text-(--text)">
          <Bell size={24} strokeWidth={2} aria-hidden="true" />
          {t('app.pings.name')}
        </h1>
      </header>

      {/* prompt to turn on notifications when this device can't receive them */}
      <NotificationsNudge />

      {/* incoming / active pings */}
      <PingsBanner />

      {/* recipient picker — a compact, recessed filter control, deliberately
          unlike the raised ping action cards below it */}
      {members.length > 0 && (
        <div className="mb-5">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-full bg-(--surface) px-4 py-2 text-left"
          >
            <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('pings.to')}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-(--text)">
              {toLabel}
            </span>
            <span className="shrink-0 text-(--text-faint)">
              {pickerOpen ? (
                <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              )}
            </span>
          </button>
          {pickerOpen && (
            <div className="mt-1.5 space-y-0.5 rounded-2xl bg-(--surface) p-1.5">
              <button
                onClick={() => setSelected(new Set())}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left active:bg-(--surface-2)"
              >
                <span className="flex-1 text-sm font-semibold text-(--text)">
                  {t('pings.everyone')}
                </span>
                {everyone && <Check size={16} strokeWidth={2.5} className="text-(--accent)" aria-hidden="true" />}
              </button>
              {members.map((m) => {
                const on = !everyone && selected.has(m.email)
                return (
                  <button
                    key={m.email}
                    onClick={() => toggle(m.email)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left active:bg-(--surface-2)"
                  >
                    <span className="flex-1 truncate text-sm text-(--text)">
                      {m.display_name}
                    </span>
                    {on && <Check size={16} strokeWidth={2.5} className="text-(--accent)" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Presets header + edit toggle */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
          {t('app.pings.name')}
        </span>
        <button
          onClick={() => setEditMode((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold text-(--accent)"
        >
          <Pencil size={13} strokeWidth={2} aria-hidden="true" />
          {editMode ? t('pings.donePresets') : t('pings.editPresets')}
        </button>
      </div>

      {/* preset pings — one per line */}
      <div className="space-y-2.5">
        {presets.map((p) => {
          const high = p.high_priority
          return (
            <div
              key={p.id}
              className={`flex items-center rounded-2xl border-2 bg-(--card) ${
                high ? 'border-(--expense)' : 'border-transparent'
              }`}
            >
              <button
                onClick={() => (editMode ? openEditPreset(p) : sendPreset(p))}
                disabled={sending && !editMode}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left active:scale-[0.99] transition-transform disabled:opacity-50"
              >
                <span className="text-2xl">{busyId === p.id ? '…' : p.emoji}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-(--text)">
                  {presetText(p, t)}
                </span>
                {!editMode && high && (
                  <span className="shrink-0 text-[11px] font-bold uppercase text-(--expense)">
                    {t('pings.highPriority')}
                  </span>
                )}
              </button>
              {editMode && (
                <button
                  onClick={() => confirmDeletePreset(p)}
                  aria-label={t('pings.deletePreset')}
                  className="shrink-0 px-4 py-3.5 text-(--text-faint) active:text-(--text)"
                >
                  <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}

        {editMode && (
          <button
            onClick={openNewPreset}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-(--text-faint) py-3.5 text-(--text-muted)"
          >
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
            <span className="font-semibold">{t('pings.addPreset')}</span>
          </button>
        )}
      </div>

      {/* AI free-text */}
      <div className="my-4 flex items-center gap-3 text-xs text-(--text-faint)">
        <span className="h-px flex-1 bg-(--surface-2)" />
        {t('pings.or')}
        <span className="h-px flex-1 bg-(--surface-2)" />
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendAI()
          }}
          placeholder={t('pings.aiPlaceholder')}
          disabled={aiBusy}
          className="min-w-0 flex-1 rounded-xl bg-(--card) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent) disabled:opacity-50"
        />
        <button
          onClick={sendAI}
          disabled={!text.trim() || sending}
          className="shrink-0 rounded-xl bg-(--accent) px-4 font-bold text-white disabled:opacity-50"
        >
          {aiBusy ? '…' : t('pings.send')}
        </button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-(--text-faint)">
        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
        {t('pings.aiHint')}
      </p>

      {editorOpen && (
        <PresetEditor
          preset={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false)
            reloadPresets()
          }}
        />
      )}
    </div>
  )
}

/** Bottom-sheet editor for adding/editing a preset (emoji + label + high
 *  priority). Hoisted to module scope — must not be defined inside Pings(). */
function PresetEditor({
  preset,
  onClose,
  onSaved,
}: {
  preset: PingPreset | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [emoji, setEmoji] = useState(preset?.emoji ?? '📣')
  const [label, setLabel] = useState(preset ? presetText(preset, t) : '')
  const [high, setHigh] = useState(preset?.high_priority ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!label.trim() || saving) return
    setSaving(true)
    try {
      const fields = { emoji, label, high_priority: high }
      if (preset) await updatePingPreset(preset.id, fields)
      else await createPingPreset(fields)
      onSaved()
    } catch {
      alert(t('pings.presetSaveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-(--card) p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold font-display text-(--text)">
            {preset ? t('pings.editPreset') : t('pings.newPreset')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="text-(--text-muted) active:text-(--text)"
          >
            <X size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="mb-4 flex gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('pings.presetEmoji')}
            </label>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={4}
              className="w-16 rounded-xl bg-(--surface) px-2 py-2.5 text-center text-2xl text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
              {t('pings.presetLabel')}
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('pings.presetLabelPlaceholder')}
              autoFocus={!preset}
              className="w-full rounded-xl bg-(--surface) px-4 py-2.5 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </div>
        </div>

        <label
          className={`mb-4 flex items-center gap-3 rounded-xl bg-(--surface) px-4 py-2.5 ${
            high ? 'ring-2 ring-(--expense)' : ''
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${high ? 'text-(--expense)' : 'text-(--text)'}`}>
              {t('pings.highPriority')}
            </span>
            <span className="block text-[11px] text-(--text-faint)">
              {t('pings.highPriorityHint')}
            </span>
          </span>
          <input
            type="checkbox"
            checked={high}
            onChange={(e) => setHigh(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-(--expense)"
          />
        </label>

        <button
          onClick={save}
          disabled={!label.trim() || saving}
          className="w-full rounded-xl bg-(--accent) py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? t('common.saving') : preset ? t('common.saveChanges') : t('pings.newPreset')}
        </button>
      </div>
    </div>
  )
}
