import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MoreHorizontal, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Backdrop from '../../components/Backdrop'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import type { TKey } from '../../lib/i18n'
import {
  addDaysISO,
  currentPeriodStart,
  daysBetweenISO,
  formatMoney,
  nextPeriodStart,
  periodLabel,
  periodLengthDays,
  todayISO,
} from '../../lib/format'
import type { Budget, Entry, Month, Period } from '../../lib/types'

// Period-specific i18n key suffixes (month/week/day), so gendered nouns in
// es/pt agree with their adjectives ("Nuevo mes" vs "Nueva semana").
const CAP: Record<Period, string> = { monthly: 'Month', weekly: 'Week', daily: 'Day' }

export default function Months() {
  const { budgetId } = useParams<{ budgetId: string }>()
  const navigate = useNavigate()
  const back = useBack()
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  // YYYY-MM for monthly budgets (month input), YYYY-MM-DD otherwise
  const [pickValue, setPickValue] = useState('')

  // budget menu (rename / delete)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState('')
  useScrollLock(createOpen || menuOpen || renameOpen)
  const [saving, setSaving] = useState(false)

  type MonthsData = {
    budget: Budget | null
    months: Month[]
    entries: Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>[]
  }
  // Cached per budget: list + balances render instantly on return.
  const {
    data = { budget: null, months: [], entries: [] },
    loading,
    revalidate,
  } = useCachedQuery<MonthsData>(`months:${budgetId ?? ''}`, async () => {
    if (!budgetId) return { budget: null, months: [], entries: [] }
    const [b, m, e] = await Promise.all([
      supabase.from('budgets').select('*').eq('id', budgetId).single(),
      supabase
        .from('months')
        .select('*')
        .eq('budget_id', budgetId)
        .order('start_date', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount, entry_date'),
    ])
    return { budget: b.data, months: m.data ?? [], entries: e.data ?? [] }
  })
  const { budget, months, entries } = data

  const period = budget?.period ?? 'monthly'

  // Real to-date balance per period: future-dated entries (e.g. an upcoming
  // paycheck) don't count yet, matching the period detail's balance.
  const balances = useMemo(() => {
    const today = todayISO()
    const map = new Map<string, number>()
    for (const e of entries) {
      if (e.entry_date > today) continue
      const delta = e.type === 'income' ? Number(e.amount) : -Number(e.amount)
      map.set(e.month_id, (map.get(e.month_id) ?? 0) + delta)
    }
    return map
  }, [entries])

  const pk = CAP[period] // 'Month' | 'Week' | 'Day' — i18n key suffix

  // Suggested default: the current calendar period if missing, else the one
  // right after the latest existing period.
  const nextStart = useMemo(() => {
    const current = currentPeriodStart(period)
    if (!months.some((m) => m.start_date === current)) return current
    return nextPeriodStart(period, months[0].start_date)
  }, [months, period])

  /** Normalize whatever the picker holds to the period's start date:
   *  monthly = 1st of the month, weekly = that week's Sunday, daily = as is. */
  const pickedStart = useMemo(() => {
    if (!pickValue) return null
    if (period === 'monthly') return `${pickValue}-01`
    if (period === 'weekly') {
      const [y, m, d] = pickValue.split('-').map(Number)
      return addDaysISO(pickValue, -new Date(y, m - 1, d).getDay())
    }
    return pickValue
  }, [pickValue, period])

  const alreadyExists = Boolean(
    pickedStart && months.some((m) => m.start_date === pickedStart),
  )
  // Recurring entries only roll forward into the newest period; periods
  // added behind existing ones (backfill) start empty.
  const willCopyRecurring = Boolean(
    pickedStart && months.length > 0 && pickedStart > months[0].start_date,
  )

  function openCreate() {
    setPickValue(period === 'monthly' ? nextStart.slice(0, 7) : nextStart)
    setCreateOpen(true)
  }

  async function createMonth(startDate: string, copyRecurring: boolean) {
    if (!budgetId) return
    setCreating(true)
    try {
      const { data: created, error } = await supabase
        .from('months')
        .insert({ budget_id: budgetId, start_date: startDate })
        .select()
        .single()
      if (error || !created) {
        alert(error?.code === '23505' ? t('months.existsAlert') : t('months.createFailed'))
        return
      }

      // Copy recurring entries from this budget's most recent period, keeping
      // each entry's day offset within the period (clamped to its length).
      const source = copyRecurring ? months[0] : null
      if (source) {
        const { data: recurring } = await supabase
          .from('entries')
          .select('*')
          .eq('month_id', source.id)
          .eq('recurring', true)
        if (recurring && recurring.length > 0) {
          const len = periodLengthDays(period, created.start_date)
          const copies = recurring.map((e: Entry) => {
            const offset = Math.max(0, daysBetweenISO(source.start_date, e.entry_date))
            return {
              month_id: created.id,
              type: e.type,
              label: e.label,
              amount: e.amount,
              category: e.category,
              subcategory: e.subcategory,
              person_email: e.person_email,
              recurring: true,
              entry_date: addDaysISO(created.start_date, Math.min(offset, len - 1)),
            }
          })
          await supabase.from('entries').insert(copies)
        }
      }
      navigate(`/month/${created.id}`)
    } finally {
      setCreating(false)
    }
  }

  async function renameBudget() {
    const trimmed = name.trim()
    if (!trimmed || !budgetId) return
    setSaving(true)
    await supabase.from('budgets').update({ name: trimmed }).eq('id', budgetId)
    setSaving(false)
    setRenameOpen(false)
    revalidate()
  }

  async function deleteBudget() {
    if (!budget) return
    if (!confirm(t('months.deleteConfirm', { name: budget.name }))) return
    await supabase.from('budgets').delete().eq('id', budget.id)
    back('/budget')
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/budget')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-(--text) font-display">
          {budget?.name ?? '…'}
        </h1>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label={t('months.options')}
          className="rounded-lg px-3 py-2 text-(--text-muted) active:text-(--text)"
        >
          <MoreHorizontal size={22} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : months.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <CalendarDays size={40} className="text-(--text-faint)" aria-hidden="true" />
          </div>
          <p className="mt-4">{t('months.empty')}</p>
          <p className="text-sm text-(--text-faint)">{t(`months.emptyHint${pk}` as TKey)}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {months.map((m) => {
            const balance = balances.get(m.id) ?? 0
            return (
              <li key={m.id}>
                <button
                  onClick={() => navigate(`/month/${m.id}`)}
                  className="flex w-full items-center justify-between rounded-2xl bg-(--card) px-5 py-4 active:bg-(--card-active) transition-colors"
                >
                  <div className="text-lg font-bold text-(--text)">
                    {periodLabel(period, m.start_date)}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-(--text-faint)">
                        {t('common.balance')}
                      </div>
                      <div
                        className={`text-lg font-semibold tabular-nums ${
                          balance >= 0 ? 'text-(--income)' : 'text-(--expense)'
                        }`}
                      >
                        {formatMoney(balance)}
                      </div>
                    </div>
                    <span className="text-(--text-faint)">›</span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={openCreate}
          disabled={creating || loading}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {creating ? t('months.creating') : t(`months.new${pk}` as TKey)}
        </button>
      </div>

      {/* budget options menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-(--card) p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <button
              onClick={() => {
                setMenuOpen(false)
                setName(budget?.name ?? '')
                setRenameOpen(true)
              }}
              className="w-full rounded-xl px-4 py-3.5 text-left font-semibold text-(--text) active:bg-(--surface)"
            >
              {t('months.rename')}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                deleteBudget()
              }}
              className="w-full rounded-xl px-4 py-3.5 text-left font-semibold text-(--expense) active:bg-(--surface)"
            >
              {t('months.delete')}
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              className="mt-2 w-full rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* rename modal */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">{t('months.renameTitle')}</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-4 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setRenameOpen(false)}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={renameBudget}
                disabled={saving || !name.trim()}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">
              {t(`months.new${pk}Title` as TKey)}
            </h2>
            <label className="mt-4 block text-sm text-(--text-muted)">
              {t(`months.which${pk}` as TKey)}
            </label>
            <input
              type={period === 'monthly' ? 'month' : 'date'}
              value={pickValue}
              onChange={(e) => setPickValue(e.target.value)}
              className="mt-2 flex h-12 w-full items-center rounded-xl bg-(--surface) px-4 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            {pickedStart && (
              <p className="mt-3 text-sm text-(--text-muted)">
                {alreadyExists ? (
                  <span className="text-(--expense)">
                    {t('months.alreadyExists', { label: periodLabel(period, pickedStart) })}
                  </span>
                ) : willCopyRecurring ? (
                  t('months.willCopy', {
                    label: periodLabel(period, pickedStart),
                    source: periodLabel(period, months[0].start_date),
                  })
                ) : months.length > 0 ? (
                  t('months.addedBehind', { label: periodLabel(period, pickedStart) })
                ) : (
                  t('months.firstPeriod', { label: periodLabel(period, pickedStart) })
                )}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!pickedStart) return
                  setCreateOpen(false)
                  createMonth(pickedStart, willCopyRecurring)
                }}
                disabled={!pickedStart || alreadyExists || creating}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
