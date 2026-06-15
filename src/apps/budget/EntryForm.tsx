import { useEffect, useState } from 'react'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { CATEGORIES, normalizeLabel, suggestCategory } from '../../lib/categories'
import { todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { CategoryRule, Entry, EntryType, Profile } from '../../lib/types'

export interface EntryPrefill {
  label?: string
  amount?: number
  category?: string
  entry_date?: string | null
}

interface Props {
  monthId: string
  /** Inclusive ISO date bounds of the budget period this entry belongs to */
  periodStart: string
  periodEnd: string
  profiles: Profile[]
  myEmail: string
  rules: CategoryRule[]
  /** category id → subcategories already used by the household, most-used first */
  subcategorySuggestions: Record<string, string[]>
  /** null = creating a new entry */
  entry: Entry | null
  /** Prefilled values for a new entry (e.g. from a scanned receipt) */
  initial?: EntryPrefill
  onClose: () => void
  onSaved: () => void
}

export default function EntryForm({
  monthId,
  periodStart,
  periodEnd,
  profiles,
  myEmail,
  rules,
  subcategorySuggestions,
  entry,
  initial,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n()
  const today = todayISO()
  const inPeriod = (iso: string) => iso >= periodStart && iso <= periodEnd
  const defaultDate = inPeriod(today) ? today : periodStart
  // Only keep a prefilled date if it actually falls inside this period.
  const initialDate =
    initial?.entry_date && inPeriod(initial.entry_date)
      ? initial.entry_date
      : undefined

  const [type, setType] = useState<EntryType>(entry?.type ?? 'expense')
  const [label, setLabel] = useState(entry?.label ?? initial?.label ?? '')
  const [amount, setAmount] = useState(
    entry ? String(entry.amount) : initial?.amount ? String(initial.amount) : '',
  )
  const [category, setCategory] = useState(
    entry?.category ?? initial?.category ?? 'other',
  )
  const [categoryTouched, setCategoryTouched] = useState(
    Boolean(entry) || Boolean(initial?.category),
  )
  const [subcategory, setSubcategory] = useState(entry?.subcategory ?? '')
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // EntryForm only mounts while open, so lock the page behind it.
  useScrollLock(true)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  async function save() {
    const value = parseFloat(amount)
    if (!label.trim() || !value || value <= 0) {
      setError(t('entry.validation'))
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      month_id: monthId,
      type,
      label: label.trim(),
      amount: value,
      category: type === 'income' ? 'salary' : category,
      subcategory: type === 'expense' && subcategory.trim() ? subcategory.trim() : null,
      entry_date: date,
      person_email: personEmail,
      recurring,
    }
    const result = entry
      ? await supabase.from('entries').update(payload).eq('id', entry.id)
      : await supabase.from('entries').insert(payload)
    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }
    // Learn this label → category choice for future auto-categorization.
    const householdId = profiles[0]?.household_id
    if (type === 'expense' && householdId) {
      await supabase
        .from('category_rules')
        .upsert(
          { household_id: householdId, keyword: normalizeLabel(label), category },
          { onConflict: 'household_id,keyword' },
        )
    }
    onSaved()
  }

  async function remove() {
    if (!entry) return
    if (!confirm(t('entry.deleteConfirm', { label: entry.label }))) return
    setSaving(true)
    await supabase.from('entries').delete().eq('id', entry.id)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)">
        {/* static header */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold text-(--text)">
            {entry ? t('entry.editTitle') : t('entry.newTitle')}
          </h2>
          <button onClick={onClose} className="px-2 py-1 text-(--text-muted)">
            ✕
          </button>
        </div>

        {/* scrollable body */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-2">

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
          {(['expense', 'income'] as const).map((ty) => (
            <button
              key={ty}
              onClick={() => setType(ty)}
              className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                type === ty
                  ? ty === 'expense'
                    ? 'bg-rose-500/90 text-white'
                    : 'bg-emerald-500/90 text-white'
                  : 'text-(--text-muted)'
              }`}
            >
              {ty === 'expense' ? t('entry.expense') : t('entry.income')}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm text-(--text-muted)">
          {t('entry.label')}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={
              type === 'expense'
                ? t('entry.labelExpensePlaceholder')
                : t('entry.labelIncomePlaceholder')
            }
            className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            autoFocus={!entry}
          />
        </label>

        <label className="mt-3 block text-sm text-(--text-muted)">
          {t('entry.amount')}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
          />
        </label>

        {type === 'expense' && (
          <div className="mt-3">
            <span className="text-sm text-(--text-muted)">{t('entry.category')}</span>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {CATEGORIES.filter((c) => c.id !== 'salary').map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCategory(c.id)
                    setCategoryTouched(true)
                  }}
                  className={`flex flex-col items-center rounded-xl py-2 transition-colors ${
                    category === c.id
                      ? 'bg-(--accent-soft) ring-2 ring-(--accent)'
                      : 'bg-(--surface)'
                  }`}
                >
                  <span className="text-xl">{c.icon}</span>
                  <span className="mt-0.5 text-[10px] text-(--text-muted)">
                    {t(`cat.${c.id}` as TKey)}
                  </span>
                </button>
              ))}
            </div>

            <label className="mt-3 block text-sm text-(--text-muted)">
              {t('entry.subcategory')}{' '}
              <span className="text-xs text-(--text-faint)">{t('entry.optional')}</span>
              <input
                value={subcategory}
                onChange={(e) => setSubcategory(e.target.value)}
                list="subcategory-suggestions"
                placeholder={t(`entry.sub.${category}` as TKey)}
                className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <datalist id="subcategory-suggestions">
                {(subcategorySuggestions[category] ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>

            {/* Quick-pick chips of subcategories already used in this category —
               native <datalist> autocomplete is invisible/flaky on iOS, so the
               suggestions appear as tappable chips the moment a category is
               picked. Tap to fill, tap again to clear. */}
            {(subcategorySuggestions[category]?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {subcategorySuggestions[category].map((s) => {
                  const active = subcategory.trim().toLowerCase() === s.toLowerCase()
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubcategory(active ? '' : s)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        active
                          ? 'bg-(--accent) text-white'
                          : 'bg-(--surface) text-(--text-muted) active:bg-(--surface-2)'
                      }`}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="block text-sm text-(--text-muted)">
            {t('entry.date')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block h-12 w-full appearance-none rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </label>
          <label className="block text-sm text-(--text-muted)">
            {t('entry.who')}
            <select
              value={personEmail}
              onChange={(e) => setPersonEmail(e.target.value)}
              className="mt-1 block h-12 w-full appearance-none rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            >
              {profiles.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-center justify-between rounded-xl bg-(--surface) px-4 py-3">
          <span className="text-(--text)">
            {t('entry.recurring')}{' '}
            <span className="text-xs text-(--text-faint)">{t('entry.recurringHint')}</span>
          </span>
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-5 w-5 accent-(--accent)"
          />
        </label>

        </div>

        {/* static footer */}
        <div
          className="shrink-0 px-5 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
        >
          {error && <p className="mb-3 text-sm text-(--expense)">{error}</p>}
          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-2xl bg-(--accent) py-4 text-lg font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {saving ? t('common.saving') : entry ? t('entry.saveChanges') : t('entry.addEntry')}
          </button>

          {entry && (
            <button
              onClick={remove}
              disabled={saving}
              className="mt-3 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-rose-400/10"
            >
              {t('entry.deleteEntry')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
