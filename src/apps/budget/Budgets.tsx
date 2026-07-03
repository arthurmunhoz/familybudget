import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Briefcase, ChevronDown } from 'lucide-react'
import Backdrop from '../../components/Backdrop'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useI18n } from '../../hooks/useI18n'
import { supabase } from '../../lib/supabase'
import {
  daysBetweenISO,
  formatMoney,
  periodEndISO,
  periodLabel,
  todayISO,
} from '../../lib/format'
import type { Budget, Entry, Month, Period } from '../../lib/types'

const PERIOD_IDS: Period[] = ['monthly', 'weekly', 'daily']

interface BudgetStats {
  /** The period shown on the card: the one containing today, else the latest. */
  month: Month | null
  income: number
  spent: number
  balance: number
  /** Balance once all future-dated entries land; only meaningful if hasUpcoming. */
  expected: number
  hasUpcoming: boolean
  /** Days left in the shown period (null when it isn't the current one). */
  daysLeft: number | null
}

export default function Budgets() {
  const navigate = useNavigate()
  const back = useBack()
  const { t } = useI18n()

  type HomeData = {
    budgets: Budget[]
    months: Month[]
    entries: Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>[]
  }
  // One cached query for the whole home: budget cards render instantly on
  // return with live balances, then revalidate quietly.
  const {
    data = { budgets: [], months: [], entries: [] },
    loading,
    revalidate,
  } = useCachedQuery<HomeData>('budgets:home', async () => {
    const [b, m, e] = await Promise.all([
      supabase.from('budgets').select('*').order('created_at'),
      supabase.from('months').select('*').order('start_date', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount, entry_date'),
    ])
    return { budgets: b.data ?? [], months: m.data ?? [], entries: e.data ?? [] }
  })
  const { budgets, months, entries } = data

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)
  useScrollLock(createOpen)

  // Per-budget snapshot of the period shown on its card.
  const stats = useMemo(() => {
    const today = todayISO()
    const byMonth = new Map<string, HomeData['entries']>()
    for (const e of entries) {
      const list = byMonth.get(e.month_id)
      if (list) list.push(e)
      else byMonth.set(e.month_id, [e])
    }
    const map = new Map<string, BudgetStats>()
    for (const b of budgets) {
      const own = months.filter((m) => m.budget_id === b.id) // already newest-first
      const current = own.find(
        (m) => m.start_date <= today && today <= periodEndISO(b.period, m.start_date),
      )
      const month = current ?? own[0] ?? null
      if (!month) {
        map.set(b.id, {
          month: null,
          income: 0,
          spent: 0,
          balance: 0,
          expected: 0,
          hasUpcoming: false,
          daysLeft: null,
        })
        continue
      }
      let income = 0
      let spent = 0
      let comingIn = 0
      let due = 0
      for (const e of byMonth.get(month.id) ?? []) {
        const amount = Number(e.amount)
        if (e.entry_date > today) {
          if (e.type === 'income') comingIn += amount
          else due += amount
        } else if (e.type === 'income') income += amount
        else spent += amount
      }
      const balance = income - spent
      map.set(b.id, {
        month,
        income,
        spent,
        balance,
        expected: balance + comingIn - due,
        hasUpcoming: comingIn > 0 || due > 0,
        daysLeft: current
          ? daysBetweenISO(today, periodEndISO(b.period, current.start_date))
          : null,
      })
    }
    return map
  }, [budgets, months, entries])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    setName('')
    setPeriod('monthly')
    revalidate()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-28">
      <Backdrop />
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-(--text) font-display">
          <Wallet size={22} strokeWidth={2} aria-hidden="true" className="text-(--accent)" />
          {t('budget.title')}
        </h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : budgets.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <Briefcase size={40} className="text-(--text-faint)" aria-hidden="true" />
          </div>
          <p className="mt-4">{t('budget.empty')}</p>
          <p className="text-sm text-(--text-faint)">{t('budget.emptyHint')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => (
            <BudgetCard
              key={b.id}
              budget={b}
              stats={stats.get(b.id)}
              onOpen={(monthId) => navigate(`/month/${monthId}`)}
              onAdd={(monthId) => navigate(`/month/${monthId}?add=1`)}
              onHistory={() => navigate(`/budget/${b.id}`)}
            />
          ))}
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
          className="w-full rounded-2xl border border-(--accent) bg-(--card) py-3.5 text-lg font-bold text-(--accent) shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {t('budget.new')}
        </button>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-(--card) p-6">
            <h2 className="text-lg font-bold text-(--text)">{t('budget.newTitle')}</h2>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('budget.namePlaceholder')}
              autoFocus
              className="mt-4 w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <div className="mt-4">
              <span className="text-sm text-(--text-muted)">{t('budget.groupedBy')}</span>
              <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-(--surface) p-1">
                {PERIOD_IDS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                      period === p ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                    }`}
                  >
                    {t(`budget.${p}` as const)}
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
                {t('common.cancel')}
              </button>
              <button
                onClick={create}
                disabled={saving || !name.trim()}
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

function BudgetCard({
  budget: b,
  stats,
  onOpen,
  onAdd,
  onHistory,
}: {
  budget: Budget
  stats: BudgetStats | undefined
  onOpen: (monthId: string) => void
  onAdd: (monthId: string) => void
  onHistory: () => void
}) {
  const { t } = useI18n()
  const m = stats?.month ?? null
  const { income = 0, spent = 0, balance = 0, expected = 0, hasUpcoming = false } =
    stats ?? {}
  const daysLeft = stats?.daysLeft ?? null
  const barMax = Math.max(income, spent, 1)

  return (
    <li className="rounded-2xl bg-(--card) p-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => (m ? onOpen(m.id) : onHistory())}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-lg font-bold text-(--text)">{b.name}</span>
        </button>
        <button
          onClick={onHistory}
          className="flex shrink-0 items-center gap-1 rounded-full bg-(--accent-soft) px-3 py-1.5 text-xs font-semibold text-(--accent) active:opacity-70"
        >
          {m ? periodLabel(b.period, m.start_date) : t(`budget.${b.period}` as const)}
          <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>

      {m ? (
        <>
          <button onClick={() => onOpen(m.id)} className="mt-1 block w-full text-left">
            <span
              className={`block text-3xl font-bold tabular-nums font-display ${
                balance >= 0 ? 'text-(--income)' : 'text-(--expense)'
              }`}
            >
              {formatMoney(balance)}
            </span>
            <span className="mt-0.5 block text-xs text-(--text-faint)">
              {t('home.balanceToday')}
              {daysLeft !== null && daysLeft >= 1 && ` · ${t('home.daysLeft', { count: daysLeft })}`}
            </span>
            {hasUpcoming && (
              <span className="mt-1 block text-xs text-(--text-muted)">
                {t('home.withUpcoming')}{' '}
                <span
                  className={`font-semibold tabular-nums ${
                    expected >= 0 ? 'text-(--income)' : 'text-(--expense)'
                  }`}
                >
                  {formatMoney(expected)}
                </span>
              </span>
            )}
            <span className="mt-3 block space-y-1.5">
              <BarRow
                label={t('chart.received')}
                value={income}
                max={barMax}
                color="var(--income)"
              />
              <BarRow
                label={t('chart.spent')}
                value={spent}
                max={barMax}
                color="var(--expense)"
              />
            </span>
          </button>
          <button
            onClick={() => onAdd(m.id)}
            className="mt-3 w-full rounded-xl bg-(--accent) py-2.5 text-sm font-bold text-white active:scale-[0.98] transition-transform"
          >
            {t('detail.newEntry')}
          </button>
        </>
      ) : (
        <button
          onClick={onHistory}
          className="mt-2 block w-full text-left text-sm text-(--text-muted)"
        >
          {t('home.noneYet')}
        </button>
      )}
    </li>
  )
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-(--text-muted)">
      <span className="w-16 shrink-0 truncate">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface)">
        <span
          className="block h-full rounded-full"
          style={{ width: `${(value / max) * 100}%`, background: color }}
        />
      </span>
      <span className="w-16 shrink-0 text-right tabular-nums">{formatMoney(value)}</span>
    </span>
  )
}
