// Manage categories — opened from the entry form's "All" category grid.
// Ported from the iOS app's ManageCategoriesSheet (mobile/src/apps/budget/).
//
// Two sections:
//   • Defaults — the 14 built-in presets. Editing one upserts a row in
//     `category_overrides` (migration 056); ↺ deletes the row and the shared
//     default (including its localized name) comes back. Entries are untouched:
//     they reference the preset id, and categoryById() layers the override on.
//   • Yours — the household's `custom_categories`. Editing is a plain UPDATE;
//     deleting goes through delete_custom_category() (migration 054), which
//     reassigns that category's entries + keyword rules to 'other' atomically.
import { useState } from 'react'
import { Check, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { builtinCategories, overriddenName } from '../../lib/categories'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { CategoryOverride, CustomCategory } from '../../lib/types'

/** A row being edited, in either section. */
type Draft = { icon: string; name: string }

export default function ManageCategoriesSheet({
  customCats,
  overrides,
  onClose,
  onChanged,
}: {
  customCats: CustomCategory[]
  overrides: CategoryOverride[]
  onClose: () => void
  /** Re-read custom_categories + category_overrides in the parent. */
  onChanged: () => void
}) {
  const { t } = useI18n()
  useScrollLock(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ icon: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const builtins = builtinCategories(overrides)

  /** Built-in names come from the dictionary unless the household renamed one. */
  const builtinLabel = (id: string) => overriddenName(id, overrides) ?? t(`cat.${id}` as TKey)

  function startEdit(id: string, icon: string, name: string) {
    setEditing(id)
    setDraft({ icon, name })
    setAdding(false)
    setError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setAdding(false)
    setError(null)
  }

  async function run(fn: () => PromiseLike<{ error: unknown }>, failKey: TKey) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await fn()
    setBusy(false)
    if (err) {
      setError(t(failKey))
      return
    }
    cancelEdit()
    onChanged()
  }

  /** Save an edit to a BUILT-IN: upsert the household's override. Only send a
   *  field when it actually differs from the shared default, so a household that
   *  just retitles one keeps inheriting future icon changes (and vice versa). */
  async function saveBuiltin(id: string) {
    const base = builtinCategories().find((c) => c.id === id)!
    const name = draft.name.trim()
    const icon = draft.icon.trim()
    if (!name) return
    await run(
      () =>
        supabase.from('category_overrides').upsert(
          {
            base_id: id,
            name: name === t(`cat.${id}` as TKey) ? null : name,
            icon: icon && icon !== base.icon ? icon : null,
          },
          { onConflict: 'household_id,base_id' },
        ),
      'manageCats.saveError',
    )
  }

  async function resetBuiltin(id: string) {
    await run(
      () => supabase.from('category_overrides').delete().eq('base_id', id),
      'manageCats.saveError',
    )
  }

  async function saveCustom(id: string) {
    const name = draft.name.trim()
    if (!name) return
    await run(
      () =>
        supabase
          .from('custom_categories')
          .update({ name, icon: draft.icon.trim() || '🏷️' })
          .eq('id', id),
      'manageCats.saveError',
    )
  }

  async function deleteCustom(c: CustomCategory) {
    if (!confirm(t('manageCats.deleteConfirm', { name: c.name }))) return
    await run(
      () => supabase.rpc('delete_custom_category', { p_id: c.id }),
      'manageCats.deleteError',
    )
  }

  async function addCustom() {
    const name = draft.name.trim()
    if (!name) return
    await run(
      () =>
        supabase
          .from('custom_categories')
          .insert({ name, icon: draft.icon.trim() || '🏷️' }),
      'manageCats.saveError',
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-(--card) px-5 pt-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-(--text)">{t('manageCats.title')}</h2>
          <button onClick={onClose} className="p-1 text-(--text-muted)" aria-label={t('common.cancel')}>
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-xl bg-(--surface) px-3 py-2 text-sm font-medium text-(--expense)">
            {error}
          </p>
        )}

        <span className="text-sm text-(--text-muted)">{t('manageCats.yours')}</span>
        <p className="mt-0.5 text-xs text-(--text-faint)">{t('manageCats.deleteHint')}</p>
        <div className="mt-2 space-y-1.5">
          {customCats.length === 0 && !adding && (
            <p className="py-2 text-sm text-(--text-faint)">{t('manageCats.empty')}</p>
          )}
          {customCats.map((c) =>
            editing === c.id ? (
              <EditRow
                key={c.id}
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                onSave={() => void saveCustom(c.id)}
                onCancel={cancelEdit}
                placeholder={t('manageCats.namePlaceholder')}
              />
            ) : (
              <div key={c.id} className="flex items-center gap-2 rounded-xl bg-(--surface) px-3 py-2.5">
                <button
                  onClick={() => startEdit(c.id, c.icon, c.name)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="truncate text-sm font-medium text-(--text)">{c.name}</span>
                </button>
                <button
                  onClick={() => void deleteCustom(c)}
                  disabled={busy}
                  aria-label={t('common.remove')}
                  className="shrink-0 p-1 text-(--text-faint) active:text-(--expense) disabled:opacity-50"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ),
          )}
          {adding ? (
            <EditRow
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              onSave={() => void addCustom()}
              onCancel={cancelEdit}
              placeholder={t('manageCats.namePlaceholder')}
            />
          ) : (
            <button
              onClick={() => {
                setAdding(true)
                setEditing(null)
                setDraft({ icon: '', name: '' })
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-(--text-faint) py-2.5 text-sm font-semibold text-(--text-muted)"
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {t('manageCats.add')}
            </button>
          )}
        </div>

        <span className="mt-6 block text-sm text-(--text-muted)">{t('manageCats.defaults')}</span>
        <div className="mt-2 space-y-1.5">
          {builtins.map((c) => {
            const isOverridden = overrides.some((o) => o.base_id === c.id)
            return editing === c.id ? (
              <EditRow
                key={c.id}
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                onSave={() => void saveBuiltin(c.id)}
                onCancel={cancelEdit}
                placeholder={t('manageCats.namePlaceholder')}
              />
            ) : (
              <div key={c.id} className="flex items-center gap-2 rounded-xl bg-(--surface) px-3 py-2.5">
                <button
                  onClick={() => startEdit(c.id, c.icon, builtinLabel(c.id))}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="truncate text-sm font-medium text-(--text)">
                    {builtinLabel(c.id)}
                  </span>
                </button>
                {isOverridden && (
                  <button
                    onClick={() => void resetBuiltin(c.id)}
                    disabled={busy}
                    aria-label={t('manageCats.reset')}
                    className="shrink-0 p-1 text-(--text-faint) active:text-(--text) disabled:opacity-50"
                  >
                    <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Hoisted to module scope: defined inside the sheet it would get a new component
// type on every keystroke, remounting the inputs and dropping focus.
function EditRow({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  placeholder,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
  placeholder: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={draft.icon}
        onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
        placeholder="🏷️"
        maxLength={4}
        className="w-14 shrink-0 rounded-xl bg-(--surface) py-2.5 text-center text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
      />
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        placeholder={placeholder}
        maxLength={40}
        autoFocus
        className="min-w-0 flex-1 rounded-xl bg-(--surface) px-3 py-2.5 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
      />
      <button
        onClick={onSave}
        disabled={busy || !draft.name.trim()}
        className="shrink-0 rounded-xl bg-(--accent) px-3 py-2.5 text-white disabled:opacity-50"
      >
        <Check size={16} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <button
        onClick={onCancel}
        className="shrink-0 rounded-xl bg-(--surface) px-3 py-2.5 text-(--text-muted)"
      >
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  )
}
