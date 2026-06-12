import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Backdrop from '../../components/Backdrop'
import { useBack } from '../../hooks/useBack'
import {
  addDaysISO,
  currentPeriodStart,
  daysBetweenISO,
  formatMoney,
  nextPeriodStart,
  periodLabel,
  periodLengthDays,
} from '../../lib/format'
import type { Budget, Entry, Month } from '../../lib/types'

export default function Months() {
  const { budgetId } = useParams<{ budgetId: string }>()
  const navigate = useNavigate()
  const back = useBack()
  const [budget, setBudget] = useState<Budget | null>(null)
  const [months, setMonths] = useState<Month[]>([])
  const [entries, setEntries] = useState<Pick<Entry, 'month_id' | 'type' | 'amount'>[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // budget menu (rename / delete)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!budgetId) return
    const [b, m, e] = await Promise.all([
      supabase.from('budgets').select('*').eq('id', budgetId).single(),
      supabase
        .from('months')
        .select('*')
        .eq('budget_id', budgetId)
        .order('start_date', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount'),
    ])
    setBudget(b.data)
    setMonths(m.data ?? [])
    setEntries(e.data ?? [])
    setLoading(false)
  }, [budgetId])

  useEffect(() => {
    load()
  }, [load])

  const period = budget?.period ?? 'monthly'

  const balances = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      const delta = e.type === 'income' ? Number(e.amount) : -Number(e.amount)
      map.set(e.month_id, (map.get(e.month_id) ?? 0) + delta)
    }
    return map
  }, [entries])

  // Next period to create: the current calendar period if missing, else the
  // one right after the latest existing period.
  const nextStart = useMemo(() => {
    const current = currentPeriodStart(period)
    if (!months.some((m) => m.start_date === current)) return current
    return nextPeriodStart(period, months[0].start_date)
  }, [months, period])

  async function createMonth() {
    if (!budgetId) return
    setCreating(true)
    try {
      const { data: created, error } = await supabase
        .from('months')
        .insert({ budget_id: budgetId, start_date: nextStart })
        .select()
        .single()
      if (error || !created) throw error

      // Copy recurring entries from this budget's most recent period, keeping
      // each entry's day offset within the period (clamped to its length).
      const source = months[0]
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
    load()
  }

  async function deleteBudget() {
    if (!budget) return
    if (
      !confirm(
        `Delete "${budget.name}" and ALL of its periods and entries? This cannot be undone.`,
      )
    )
      return
    await supabase.from('budgets').delete().eq('id', budget.id)
    back('/budget')
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => back('/budget')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-(--text)">
          {budget?.name ?? '…'}
        </h1>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Budget options"
          className="rounded-lg px-3 py-2 text-xl text-(--text-muted) active:text-(--text)"
        >
          ⋯
        </button>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : months.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">🗓️</div>
          <p className="mt-4">Nothing here yet.</p>
          <p className="text-sm text-(--text-faint)">
            Start your first {period === 'monthly' ? 'month' : period === 'weekly' ? 'week' : 'day'}{' '}
            below to begin tracking.
          </p>
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
                        Balance
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
          onClick={() => setConfirmOpen(true)}
          disabled={creating || loading}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {creating ? 'Creating…' : `＋ Start ${periodLabel(period, nextStart)}`}
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
              ✏️ Rename budget
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                deleteBudget()
              }}
              className="w-full rounded-xl px-4 py-3.5 text-left font-semibold text-(--expense) active:bg-(--surface)"
            >
              🗑️ Delete budget
            </button>
            <button
              onClick={() => setMenuOpen(false)}
              className="mt-2 w-full rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* rename modal */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">Rename budget</h2>
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
                Cancel
              </button>
              <button
                onClick={renameBudget}
                disabled={saving || !name.trim()}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">
              Start {periodLabel(period, nextStart)}?
            </h2>
            <p className="mt-2 text-sm text-(--text-muted)">
              {months.length > 0
                ? `Recurring entries from ${periodLabel(
                    period,
                    months[0].start_date,
                  )} will be copied over automatically.`
                : 'This creates the first period of this budget.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false)
                  createMonth()
                }}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white"
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
