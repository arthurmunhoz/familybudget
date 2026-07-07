import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Briefcase, Camera, Check, ChevronDown, ChevronRight } from 'lucide-react'
import Backdrop from '../../components/Backdrop'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useI18n } from '../../hooks/useI18n'
import { supabase } from '../../lib/supabase'
import { formatMoney, periodEndISO, periodLabel, todayISO } from '../../lib/format'
import type { Budget, Entry, Month, Period } from '../../lib/types'

const PERIOD_IDS: Period[] = ['monthly', 'weekly', 'daily']

interface MonthStat {
  income: number
  spent: number
  balance: number
  /** Balance once all future-dated entries land; only meaningful if hasUpcoming. */
  expected: number
  hasUpcoming: boolean
}

export default function Budgets() {
  const navigate = useNavigate()
  const back = useBack()
  const { t } = useI18n()

  type HomeData = {
    budgets: Budget[]
    months: Month[]
    entries: Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>[]
    isPlus: boolean
  }
  // One cached query for the whole home: budget cards render instantly on
  // return with live balances, then revalidate quietly.
  const {
    data = { budgets: [], months: [], entries: [], isPlus: false },
    loading,
    revalidate,
  } = useCachedQuery<HomeData>('budgets:home', async () => {
    const [b, m, e, plus] = await Promise.all([
      supabase.from('budgets').select('*').order('created_at'),
      supabase.from('months').select('*').order('start_date', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount, entry_date'),
      supabase.rpc('current_household_is_plus'),
    ])
    return {
      budgets: b.data ?? [],
      months: m.data ?? [],
      entries: e.data ?? [],
      isPlus: plus.data === true,
    }
  })
  const { budgets, months, entries, isPlus } = data

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)
  useScrollLock(createOpen)

  // Per-month stats (for whichever period a card previews) + each budget's own
  // periods (newest-first) and the default one to show (current, else latest).
  const { statsById, byBudget } = useMemo(() => {
    const today = todayISO()
    const byMonth = new Map<string, HomeData['entries']>()
    for (const e of entries) {
      const list = byMonth.get(e.month_id)
      if (list) list.push(e)
      else byMonth.set(e.month_id, [e])
    }
    const statsById = new Map<string, MonthStat>()
    const byBudget = new Map<string, { months: Month[]; defaultId: string | null }>()
    for (const b of budgets) {
      const own = months.filter((m) => m.budget_id === b.id) // already newest-first
      let defaultId: string | null = null
      for (const m of own) {
        let income = 0
        let spent = 0
        let comingIn = 0
        let due = 0
        for (const e of byMonth.get(m.id) ?? []) {
          const amount = Number(e.amount)
          if (e.entry_date > today) {
            if (e.type === 'income') comingIn += amount
            else due += amount
          } else if (e.type === 'income') income += amount
          else spent += amount
        }
        const end = periodEndISO(b.period, m.start_date)
        const isCurrent = m.start_date <= today && today <= end
        if (isCurrent && !defaultId) defaultId = m.id
        const balance = income - spent
        statsById.set(m.id, {
          income,
          spent,
          balance,
          expected: balance + comingIn - due,
          hasUpcoming: comingIn > 0 || due > 0,
        })
      }
      byBudget.set(b.id, { months: own, defaultId: defaultId ?? own[0]?.id ?? null })
    }
    return { statsById, byBudget }
  }, [budgets, months, entries])

  // Free households may keep only one budget; Plus is unlimited. The button
  // gates before opening the sheet; the DB trigger is the real backstop.
  const canCreateBudget = isPlus || budgets.length < 1

  function startCreate() {
    if (!canCreateBudget) {
      alert(t('budget.freeLimit'))
      return
    }
    setName('')
    setPeriod('monthly')
    setCreateOpen(true)
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    const { error } = await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    if (error) {
      // Backstop for the server-side free-plan limit (client already gates it).
      if (error.message.includes('free_plan_budget_limit')) alert(t('budget.freeLimit'))
      return
    }
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
          {budgets.map((b) => {
            const info = byBudget.get(b.id)
            return (
              <BudgetCard
                key={b.id}
                budget={b}
                months={info?.months ?? []}
                defaultId={info?.defaultId ?? null}
                statsById={statsById}
                onOpen={(monthId) => navigate(`/month/${monthId}`)}
                onAdd={(monthId) => navigate(`/month/${monthId}?add=1`)}
                onScan={(monthId) => navigate(`/month/${monthId}?scan=1`)}
                onHistory={() => navigate(`/budget/${b.id}`)}
              />
            )
          })}
        </ul>
      )}

      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={startCreate}
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
  months,
  defaultId,
  statsById,
  onOpen,
  onAdd,
  onScan,
  onHistory,
}: {
  budget: Budget
  months: Month[]
  defaultId: string | null
  statsById: Map<string, MonthStat>
  onOpen: (monthId: string) => void
  onAdd: (monthId: string) => void
  onScan: (monthId: string) => void
  onHistory: () => void
}) {
  const { t } = useI18n()

  // Which period this card previews. Defaults to current/latest; resets if the
  // selected one disappears after a revalidate.
  const [selectedId, setSelectedId] = useState<string | null>(defaultId)
  useEffect(() => {
    if (!selectedId || !months.some((m) => m.id === selectedId)) setSelectedId(defaultId)
  }, [defaultId, months, selectedId])

  const selected = months.find((m) => m.id === selectedId) ?? null
  const stats = selected ? statsById.get(selected.id) : undefined
  const { income = 0, spent = 0, balance = 0, expected = 0, hasUpcoming = false } = stats ?? {}
  const barMax = Math.max(income, spent, 1)

  return (
    <li className="rounded-2xl bg-(--card) p-4">
      {/* title row: budget name + details chevron */}
      <button onClick={onHistory} className="flex w-full items-center gap-2 text-left">
        <span className="block min-w-0 flex-1 truncate text-lg font-bold text-(--text)">
          {b.name}
        </span>
        <ChevronRight size={20} strokeWidth={2} aria-hidden="true" className="shrink-0 text-(--text-faint)" />
      </button>

      {selected ? (
        <div className="mt-3 space-y-3 border-t border-(--surface-2) pt-3">
          {/* overview header: labelled balance (left) + period dropdown (right) */}
          <div className="flex items-start gap-2">
            <button onClick={() => onOpen(selected.id)} className="min-w-0 flex-1 text-left">
              <span className="block text-xs text-(--text-faint)">{t('chart.currentBalance')}</span>
              <span
                className={`block text-[22px] font-bold tabular-nums font-display ${
                  balance >= 0 ? 'text-(--income)' : 'text-(--expense)'
                }`}
              >
                {formatMoney(balance)}
              </span>
            </button>
            <PeriodDropdown
              value={selected.id}
              options={months.map((m) => ({ id: m.id, label: periodLabel(b.period, m.start_date) }))}
              onChange={setSelectedId}
            />
          </div>

          {hasUpcoming && (
            <p className="text-xs text-(--text-muted)">
              {t('home.withUpcoming')}{' '}
              <span
                className={`font-semibold tabular-nums ${
                  expected >= 0 ? 'text-(--income)' : 'text-(--expense)'
                }`}
              >
                {formatMoney(expected)}
              </span>
            </p>
          )}

          <div className="space-y-1.5">
            <BarRow label={t('chart.received')} value={income} max={barMax} color="var(--income)" />
            <BarRow label={t('chart.spent')} value={spent} max={barMax} color="var(--expense)" />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onScan(selected.id)}
              aria-label={t('detail.scanAria')}
              className="flex w-[46px] shrink-0 items-center justify-center rounded-xl bg-(--surface) active:opacity-80"
            >
              <Camera size={20} strokeWidth={2} aria-hidden="true" className="text-(--text)" />
            </button>
            <button
              onClick={() => onAdd(selected.id)}
              className="flex-1 rounded-xl bg-(--accent) py-2.5 text-sm font-bold text-white active:scale-[0.98] transition-transform"
            >
              {t('detail.newEntry')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onHistory}
          className="mt-3 block w-full border-t border-(--surface-2) pt-3 text-left text-sm text-(--text-muted)"
        >
          {t('home.noneYet')}
        </button>
      )}
    </li>
  )
}

/** In-card period picker: a pill that opens a dropdown of the budget's periods,
 *  anchored below the pill via a relatively-positioned wrapper. */
function PeriodDropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.id === value)

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-full bg-(--accent-soft) px-3 py-1.5 text-xs font-semibold text-(--accent) active:opacity-70"
      >
        {current?.label ?? ''}
        <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Tap outside to dismiss. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 max-h-[280px] min-w-[180px] overflow-y-auto rounded-xl border border-(--surface-2) bg-(--card) shadow-lg">
            {options.map((o) => {
              const active = o.id === value
              return (
                <button
                  key={o.id}
                  onClick={() => {
                    onChange(o.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-(--surface) ${
                    active ? 'font-semibold text-(--accent)' : 'text-(--text)'
                  }`}
                >
                  {o.label}
                  {active && <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
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
