import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import {
  CATEGORIES,
  categoryById,
  isBuiltinCategory,
  normalizeLabel,
  suggestCategory,
  type Category,
} from '../../lib/categories'
import { addDaysISO, formatDay, formatMoney, shortName, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { CategoryRule, CustomCategory, Entry, EntryType, Profile } from '../../lib/types'

export interface EntryPrefill {
  label?: string
  amount?: number
  category?: string
  subcategory?: string | null
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
  /** Household-defined categories (shown alongside the built-ins) */
  customCategories: CustomCategory[]
  /** Household's most-used expense category ids, most-used first */
  topCategories: string[]
  /** Called after a new custom category is saved, so the parent can refetch */
  onCategoryCreated: () => void
  /** null = creating a new entry */
  entry: Entry | null
  /** Prefilled values for a new entry (e.g. from a scanned receipt) */
  initial?: EntryPrefill
  onClose: () => void
  onSaved: () => void
}

/** Chips shown when the household has no history yet. */
const FALLBACK_TOP = ['groceries', 'dining', 'transport']

export default function EntryForm({
  monthId,
  periodStart,
  periodEnd,
  profiles,
  myEmail,
  rules,
  subcategorySuggestions,
  customCategories,
  topCategories,
  onCategoryCreated,
  entry,
  initial,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n()
  const today = todayISO()
  const yesterday = addDaysISO(today, -1)
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
  const [subcategory, setSubcategory] = useState(
    entry?.subcategory ?? initial?.subcategory ?? '',
  )
  const [subOpen, setSubOpen] = useState(
    Boolean(entry?.subcategory || initial?.subcategory),
  )
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [pickOpen, setPickOpen] = useState(false)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Category picker: chips by default, the full grid behind "All".
  const [gridOpen, setGridOpen] = useState(false)
  const [localCats, setLocalCats] = useState<CustomCategory[]>(customCategories)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('')
  const [creatingCat, setCreatingCat] = useState(false)

  // EntryForm only mounts while open, so lock the page behind it.
  useScrollLock(true)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  const parsedAmount = parseFloat(amount.replace(',', '.'))
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0

  const selectedCat = categoryById(category, localCats)
  const catName = (c: Category) =>
    isBuiltinCategory(c.id) ? t(`cat.${c.id}` as TKey) : c.name
  const allExpenseCats: Category[] = [
    ...CATEGORIES.filter((c) => c.id !== 'salary'),
    ...localCats.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
  ]
  const knownIds = new Set(allExpenseCats.map((c) => c.id))
  const quickIds = (topCategories.length > 0 ? topCategories : FALLBACK_TOP)
    .filter((id) => id !== category && knownIds.has(id))
    .slice(0, 3)

  const dateIsOther = date !== today && date !== yesterday

  function pickCategory(id: string) {
    setCategory(id)
    setCategoryTouched(true)
    setGridOpen(false)
  }

  async function createCategory() {
    const trimmed = newCatName.trim()
    if (!trimmed) return
    setCreatingCat(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('custom_categories')
      .insert({ name: trimmed, icon: newCatIcon.trim() || '🏷️' })
      .select()
      .single()
    setCreatingCat(false)
    if (err || !data) {
      setError(t('entry.categoryCreateFailed'))
      return
    }
    setLocalCats((prev) => [...prev, data])
    setNewCatOpen(false)
    setNewCatName('')
    setNewCatIcon('')
    pickCategory(data.id)
    onCategoryCreated()
  }

  async function save() {
    if (!label.trim() || !amountValid) {
      setError(t('entry.validation'))
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      month_id: monthId,
      type,
      label: label.trim(),
      amount: parsedAmount,
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

  const addLabel = t(type === 'expense' ? 'entry.addExpense' : 'entry.addIncome')
  const saveLabel = saving
    ? t('common.saving')
    : entry
      ? t('entry.saveChanges')
      : amountValid
        ? `${addLabel} · ${formatMoney(parsedAmount)}`
        : addLabel
  const title = entry
    ? t(type === 'expense' ? 'entry.editExpenseTitle' : 'entry.editIncomeTitle')
    : t(type === 'expense' ? 'entry.newExpenseTitle' : 'entry.newIncomeTitle')

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${
      active ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted) active:bg-(--surface-2)'
    }`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)">
        {/* static header */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold text-(--text)">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="px-2 py-1 text-(--text-muted)"
          >
            <X size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* scrollable body */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-2">

        <div className="mt-2 flex justify-center">
          <div className="flex gap-1 rounded-full bg-(--surface) p-1">
            {(['expense', 'income'] as const).map((ty) => (
              <button
                key={ty}
                onClick={() => setType(ty)}
                className={`rounded-full px-5 py-2 text-sm font-semibold capitalize transition-colors ${
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
        </div>

        {/* Amount first — it's what you know when you open the form. */}
        <div className="mt-6 mb-1 flex items-baseline justify-center">
          <span
            className={`text-4xl font-semibold ${
              amount ? 'text-(--text)' : 'text-(--text-faint)'
            }`}
          >
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            autoFocus={!entry && !initial?.amount}
            aria-label={t('entry.amount')}
            // Inline font-size: the global unlayered `input { font-size: 16px }`
            // (iOS zoom guard) beats Tailwind's layered text-* utilities here.
            style={{
              width: `${Math.max(4, amount.length + 1)}ch`,
              fontSize: '3.5rem',
              lineHeight: 1.1,
            }}
            className="bg-transparent text-center font-bold tabular-nums font-display text-(--text) outline-none placeholder:text-(--text-faint)"
          />
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
          />
        </label>

        {type === 'expense' && (
          <div className="mt-4">
            <span className="text-sm text-(--text-muted)">
              {t('entry.category')}{' '}
              {!categoryTouched && (
                <span className="text-xs text-(--text-faint)">{t('entry.autoSuggested')}</span>
              )}
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1.5 rounded-full bg-(--accent) px-3.5 py-2 text-sm font-semibold text-white">
                <span>{selectedCat.icon}</span>
                {catName(selectedCat)}
              </span>
              {quickIds.map((id) => {
                const c = categoryById(id, localCats)
                return (
                  <button
                    key={id}
                    onClick={() => pickCategory(id)}
                    aria-label={catName(c)}
                    className="rounded-full bg-(--surface) px-3 py-1.5 text-lg active:bg-(--surface-2)"
                  >
                    {c.icon}
                  </button>
                )
              })}
              <button
                onClick={() => setGridOpen((o) => !o)}
                className="rounded-full border border-(--surface-2) bg-(--card) px-3.5 py-2 text-sm font-semibold text-(--text-muted) active:bg-(--surface)"
              >
                {t('common.all')} {gridOpen ? '▴' : '▾'}
              </button>
            </div>

            {gridOpen && (
              <div className="mt-2 grid grid-cols-4 gap-2">
                {allExpenseCats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickCategory(c.id)}
                    className={`flex flex-col items-center rounded-xl py-2 transition-colors ${
                      category === c.id
                        ? 'bg-(--accent-soft) ring-2 ring-(--accent)'
                        : 'bg-(--surface)'
                    }`}
                  >
                    <span className="text-xl">{c.icon}</span>
                    <span className="mt-0.5 truncate px-1 text-[10px] text-(--text-muted)">
                      {catName(c)}
                    </span>
                  </button>
                ))}
                <button
                  onClick={() => setNewCatOpen((o) => !o)}
                  className="flex flex-col items-center rounded-xl border border-dashed border-(--text-faint) py-2"
                >
                  <Plus size={20} strokeWidth={2} aria-hidden="true" className="text-(--text-muted)" />
                  <span className="mt-0.5 text-[10px] text-(--text-muted)">
                    {t('entry.newCategory')}
                  </span>
                </button>
              </div>
            )}

            {gridOpen && newCatOpen && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newCatIcon}
                  onChange={(e) => setNewCatIcon(e.target.value)}
                  placeholder="🏷️"
                  maxLength={4}
                  aria-label={t('entry.newCategoryIcon')}
                  className="w-14 rounded-xl bg-(--surface) py-3 text-center text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder={t('entry.newCategoryPlaceholder')}
                  maxLength={40}
                  autoFocus
                  className="min-w-0 flex-1 rounded-xl bg-(--surface) px-3 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
                <button
                  onClick={createCategory}
                  disabled={creatingCat || !newCatName.trim()}
                  className="rounded-xl bg-(--accent) px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t('common.add')}
                </button>
              </div>
            )}

            {!subOpen ? (
              <button
                onClick={() => setSubOpen(true)}
                className="mt-3 text-xs font-medium text-(--text-muted) underline decoration-dotted underline-offset-4 active:text-(--text)"
              >
                {t('entry.addSubcategory')}
              </button>
            ) : (
              <>
                <label className="mt-3 block text-sm text-(--text-muted)">
                  {t('entry.subcategory')}{' '}
                  <span className="text-xs text-(--text-faint)">{t('entry.optional')}</span>
                  <input
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    list="subcategory-suggestions"
                    placeholder={
                      isBuiltinCategory(category)
                        ? t(`entry.sub.${category}` as TKey)
                        : t('entry.subcategoryPlaceholder')
                    }
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
                   suggestions appear as tappable chips. Tap to fill, tap to clear. */}
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
              </>
            )}
          </div>
        )}

        <div className="mt-4">
          <span className="text-sm text-(--text-muted)">{t('entry.date')}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {inPeriod(today) && (
              <button
                onClick={() => {
                  setDate(today)
                  setPickOpen(false)
                }}
                className={chip(date === today)}
              >
                {t('entry.today')}
              </button>
            )}
            {inPeriod(yesterday) && (
              <button
                onClick={() => {
                  setDate(yesterday)
                  setPickOpen(false)
                }}
                className={chip(date === yesterday)}
              >
                {t('entry.yesterday')}
              </button>
            )}
            <button onClick={() => setPickOpen((o) => !o)} className={chip(dateIsOther)}>
              {dateIsOther ? formatDay(date) : t('entry.pickDate')}
            </button>
          </div>
          {pickOpen && (
            <input
              type="date"
              value={date}
              min={periodStart}
              max={periodEnd}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="mt-2 block h-12 w-full appearance-none rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          )}
        </div>

        <div className="mt-4">
          <span className="text-sm text-(--text-muted)">{t('entry.who')}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <button
                key={p.email}
                onClick={() => setPersonEmail(p.email)}
                className={chip(personEmail === p.email)}
              >
                {shortName(p.display_name)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-(--surface) px-4 py-3">
          <span className="text-(--text)">
            {t('entry.recurring')}{' '}
            <span className="text-xs text-(--text-faint)">{t('entry.recurringHint')}</span>
          </span>
          <button
            role="switch"
            aria-checked={recurring}
            aria-label={t('entry.recurring')}
            onClick={() => setRecurring((r) => !r)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              recurring ? 'bg-(--accent)' : 'bg-(--surface-2) border border-black/10'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                recurring ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

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
            {saveLabel}
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
