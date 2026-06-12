import { useEffect, useState } from 'react'
import { CATEGORIES, normalizeLabel, suggestCategory } from '../../lib/categories'
import { todayISO } from '../../lib/format'
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
  entry,
  initial,
  onClose,
  onSaved,
}: Props) {
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
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  async function save() {
    const value = parseFloat(amount)
    if (!label.trim() || !value || value <= 0) {
      setError('Please enter a label and a positive amount.')
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
    if (type === 'expense') {
      await supabase
        .from('category_rules')
        .upsert({ keyword: normalizeLabel(label), category })
    }
    onSaved()
  }

  async function remove() {
    if (!entry) return
    if (!confirm(`Delete "${entry.label}"?`)) return
    setSaving(true)
    await supabase.from('entries').delete().eq('id', entry.id)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div
        className="w-full max-w-md rounded-t-3xl bg-(--card) p-5 max-h-[92dvh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.25rem)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-(--text)">
            {entry ? 'Edit entry' : 'New entry'}
          </h2>
          <button onClick={onClose} className="px-2 py-1 text-(--text-muted)">
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-(--surface) p-1">
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
                type === t
                  ? t === 'expense'
                    ? 'bg-rose-500/90 text-white'
                    : 'bg-emerald-500/90 text-white'
                  : 'text-(--text-muted)'
              }`}
            >
              {t === 'expense' ? '− Expense' : '＋ Income'}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm text-(--text-muted)">
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={type === 'expense' ? 'e.g. Groceries at Safeway' : 'e.g. Paycheck'}
            className="mt-1 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            autoFocus={!entry}
          />
        </label>

        <label className="mt-3 block text-sm text-(--text-muted)">
          Amount (USD)
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
            <span className="text-sm text-(--text-muted)">Category</span>
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
                  <span className="mt-0.5 text-[10px] text-(--text-muted)">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="block text-sm text-(--text-muted)">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block h-12 w-full appearance-none rounded-xl bg-(--surface) px-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </label>
          <label className="block text-sm text-(--text-muted)">
            Who
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
            ↻ Recurring{' '}
            <span className="text-xs text-(--text-faint)">(auto-added to new months)</span>
          </span>
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-5 w-5 accent-(--accent)"
          />
        </label>

        {error && <p className="mt-3 text-sm text-(--expense)">{error}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="mt-5 w-full rounded-2xl bg-(--accent) py-4 text-lg font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {saving ? 'Saving…' : entry ? 'Save changes' : 'Add entry'}
        </button>

        {entry && (
          <button
            onClick={remove}
            disabled={saving}
            className="mt-3 w-full rounded-2xl py-3 font-semibold text-(--expense) active:bg-rose-400/10"
          >
            Delete entry
          </button>
        )}
      </div>
    </div>
  )
}
