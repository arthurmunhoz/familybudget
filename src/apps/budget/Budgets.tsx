import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BeachBackdrop from '../../components/BeachBackdrop'
import { formatMoney } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Budget, Entry, Month, Period } from '../../lib/types'

const PERIOD_OPTIONS: { id: Period; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'daily', label: 'Daily' },
]

export default function Budgets() {
  const navigate = useNavigate()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [months, setMonths] = useState<Pick<Month, 'id' | 'budget_id'>[]>([])
  const [entries, setEntries] = useState<Pick<Entry, 'month_id' | 'type' | 'amount'>[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [b, m, e] = await Promise.all([
      supabase.from('budgets').select('*').order('created_at'),
      supabase.from('months').select('id, budget_id'),
      supabase.from('entries').select('month_id, type, amount'),
    ])
    setBudgets(b.data ?? [])
    setMonths(m.data ?? [])
    setEntries(e.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const balances = useMemo(() => {
    const monthToBudget = new Map(months.map((m) => [m.id, m.budget_id]))
    const map = new Map<string, number>()
    for (const e of entries) {
      const budgetId = monthToBudget.get(e.month_id)
      if (!budgetId) continue
      const delta = e.type === 'income' ? Number(e.amount) : -Number(e.amount)
      map.set(budgetId, (map.get(budgetId) ?? 0) + delta)
    }
    return map
  }, [months, entries])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    setName('')
    setPeriod('monthly')
    load()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <BeachBackdrop />
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => navigate('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="text-2xl font-bold text-(--text)">💰 Budgets</h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : budgets.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">💼</div>
          <p className="mt-4">No budgets yet.</p>
          <p className="text-sm text-(--text-faint)">Create your first one below.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => {
            const balance = balances.get(b.id) ?? 0
            const periodName = PERIOD_OPTIONS.find((p) => p.id === b.period)?.label
            return (
              <li key={b.id}>
                <button
                  onClick={() => navigate(`/budget/${b.id}`)}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl bg-(--card) px-5 py-4 active:bg-(--card-active) transition-colors"
                >
                  <div className="min-w-0 text-left">
                    <div className="truncate text-lg font-bold text-(--text)">
                      {b.name}
                    </div>
                    <div className="text-xs text-(--text-faint)">{periodName}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
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
          onClick={() => {
            setName('')
            setPeriod('monthly')
            setCreateOpen(true)
          }}
          disabled={loading}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          ＋ New budget
        </button>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">New budget</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Our Home Budget, Trip to Brazil"
              autoFocus
              className="mt-4 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <div className="mt-4">
              <span className="text-sm text-(--text-muted)">Entries grouped by</span>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-(--surface) p-1">
                {PERIOD_OPTIONS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                      period === p.id ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setCreateOpen(false)
                  setName('')
                }}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={saving || !name.trim()}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
