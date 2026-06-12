import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BeachBackdrop from '../components/BeachBackdrop'
import Drawer from '../components/Drawer'
import { useAuth } from '../hooks/useAuth'
import { formatMoney } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Budget, Entry, Month } from '../lib/types'

export default function Budgets() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [months, setMonths] = useState<Pick<Month, 'id' | 'budget_id'>[]>([])
  const [entries, setEntries] = useState<Pick<Entry, 'month_id' | 'type' | 'amount'>[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // create / rename modal state
  const [editing, setEditing] = useState<Budget | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
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

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    if (editing) {
      await supabase.from('budgets').update({ name: trimmed }).eq('id', editing.id)
    } else {
      await supabase.from('budgets').insert({ name: trimmed })
    }
    setSaving(false)
    setEditing(null)
    setCreateOpen(false)
    setName('')
    load()
  }

  async function removeBudget(b: Budget) {
    if (
      !confirm(
        `Delete "${b.name}" and ALL of its months and entries? This cannot be undone.`,
      )
    )
      return
    setSaving(true)
    await supabase.from('budgets').delete().eq('id', b.id)
    setSaving(false)
    setEditing(null)
    setName('')
    load()
  }

  const modalOpen = createOpen || editing !== null

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pb-28">
      <BeachBackdrop />
      <header className="flex items-center justify-between pt-6 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-(--text)">Our Budgets</h1>
          <p className="text-sm text-(--text-muted)">Hi, {profile?.display_name} 👋</p>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open settings"
          className="rounded-lg px-3 py-2 text-xl text-(--text-muted) active:text-(--text)"
        >
          ☰
        </button>
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
            return (
              <li key={b.id}>
                <button
                  onClick={() => navigate(`/budget/${b.id}`)}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl bg-(--card) px-5 py-4 active:bg-(--card-active) transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-lg font-bold text-(--text)">
                      {b.name}
                    </span>
                    <span
                      role="button"
                      aria-label={`Rename ${b.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation()
                        setEditing(b)
                        setName(b.name)
                      }}
                      className="px-1.5 py-1 text-sm text-(--text-faint) active:text-(--text)"
                    >
                      ✎
                    </span>
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
            setCreateOpen(true)
          }}
          disabled={loading}
          className="w-full rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          ＋ New budget
        </button>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">
              {editing ? 'Rename budget' : 'New budget'}
            </h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Our Home Budget, Trip to Brazil"
              autoFocus
              className="mt-4 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setEditing(null)
                  setCreateOpen(false)
                  setName('')
                }}
                className="rounded-xl bg-(--surface) py-3 font-semibold text-(--text)"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="rounded-xl bg-(--accent) py-3 font-semibold text-white disabled:opacity-50"
              >
                {editing ? 'Save' : 'Create'}
              </button>
            </div>
            {editing && (
              <button
                onClick={() => removeBudget(editing)}
                disabled={saving}
                className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-(--expense) active:bg-(--expense)/10"
              >
                Delete budget
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
