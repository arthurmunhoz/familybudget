import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { daysInMonth, formatMoney, monthLabel, monthName } from '../lib/format'
import type { Entry, Month } from '../lib/types'

export default function Months() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [months, setMonths] = useState<Month[]>([])
  const [entries, setEntries] = useState<Pick<Entry, 'month_id' | 'type' | 'amount'>[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase
        .from('months')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount'),
    ]).then(([m, e]) => {
      setMonths(m.data ?? [])
      setEntries(e.data ?? [])
      setLoading(false)
    })
  }, [])

  const balances = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      const delta = e.type === 'income' ? Number(e.amount) : -Number(e.amount)
      map.set(e.month_id, (map.get(e.month_id) ?? 0) + delta)
    }
    return map
  }, [entries])

  // Next month to create: current calendar month if missing, else the month
  // right after the latest one.
  const nextMonth = useMemo(() => {
    const now = new Date()
    const cur = { year: now.getFullYear(), month: now.getMonth() + 1 }
    const has = (y: number, m: number) =>
      months.some((x) => x.year === y && x.month === m)
    if (!has(cur.year, cur.month)) return cur
    const latest = months[0]
    return latest.month === 12
      ? { year: latest.year + 1, month: 1 }
      : { year: latest.year, month: latest.month + 1 }
  }, [months])

  async function createMonth() {
    setCreating(true)
    try {
      const { data: created, error } = await supabase
        .from('months')
        .insert({ year: nextMonth.year, month: nextMonth.month })
        .select()
        .single()
      if (error || !created) throw error

      // Copy recurring entries from the most recent existing month.
      const source = months[0]
      if (source) {
        const { data: recurring } = await supabase
          .from('entries')
          .select('*')
          .eq('month_id', source.id)
          .eq('recurring', true)
        if (recurring && recurring.length > 0) {
          const maxDay = daysInMonth(created.year, created.month)
          const copies = recurring.map((e: Entry) => ({
            month_id: created.id,
            type: e.type,
            label: e.label,
            amount: e.amount,
            category: e.category,
            person_email: e.person_email,
            recurring: true,
            entry_date: `${created.year}-${String(created.month).padStart(2, '0')}-${String(
              Math.min(Number(e.entry_date.split('-')[2]), maxDay),
            ).padStart(2, '0')}`,
          }))
          await supabase.from('entries').insert(copies)
        }
      }
      navigate(`/month/${created.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <header className="flex items-center justify-between pt-6 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Our Budget</h1>
          <p className="text-sm text-stone-400">Hi, {profile?.display_name} 👋</p>
        </div>
        <button
          onClick={signOut}
          className="rounded-lg px-3 py-2 text-sm text-stone-500 active:text-stone-300"
        >
          Sign out
        </button>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-stone-500 animate-pulse">Loading…</p>
      ) : months.length === 0 ? (
        <div className="mt-16 text-center text-stone-400">
          <div className="text-5xl">🗓️</div>
          <p className="mt-4">No months yet.</p>
          <p className="text-sm text-stone-500">
            Start your first one below to begin tracking.
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
                  className="flex w-full items-center justify-between rounded-2xl bg-stone-900 px-5 py-4 active:bg-stone-800 transition-colors"
                >
                  <div className="text-left">
                    <div className="text-lg font-bold text-stone-100">
                      {monthLabel(m.year, m.month)}
                    </div>
                    <div className="text-xs text-stone-500">
                      {monthName(m.year, m.month)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-lg font-semibold tabular-nums ${
                        balance >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatMoney(balance)}
                    </span>
                    <span className="text-stone-600">›</span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pb-6 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={createMonth}
          disabled={creating || loading}
          className="w-full rounded-2xl bg-amber-400 py-4 text-lg font-bold text-stone-900 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {creating
            ? 'Creating…'
            : `＋ Start ${monthLabel(nextMonth.year, nextMonth.month)}`}
        </button>
      </div>
    </div>
  )
}
