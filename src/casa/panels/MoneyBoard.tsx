// Money on the home device, opened (owner, 2026-11-13: "you put the phone's
// layout in there — use the big screen to show the history and the spending").
// A dashboard per budget:
//   left  — the period hero (balance, received / spent, expected; ‹ › to walk
//           back through periods) and the HISTORY chart (received vs spent for
//           the last periods; tap a column to open that period)
//   right — where it went (categories), by person, and the period's entries
//           grouped by day
// One column on a narrow / portrait screen, in the same order. Money keeps
// GREEN = in, RED = out; category colours avoid both.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { categoryById, overriddenName } from '../../lib/categories'
import { formatMoney, periodEndISO, todayISO } from '../../lib/format'
import type { TKey } from '../../lib/i18n'
import type { Budget, Entry } from '../../lib/types'
import type { HubData, Member } from '../data'
import { loadHistory, type MoneyHistory, type PeriodData } from '../money'
import { Avatar } from '../ui'
import { GRAD, LOCALE, budgetGradient, dateOf, grad } from '../util'

const CAT_COLORS = ['#5B7CFA', '#8E6CF0', '#2BB3C0', '#E0A93B', '#C76BD8', '#4F9DDE', '#7C8BA1', '#B58A5A']
const IN = '#1FB57A'
const OUT = '#EF6B5E'

interface Sums {
  income: number
  spent: number
  /** Dated after today (only the current period has these). */
  comingIn: number
  due: number
}

function sums(entries: Entry[], today: string): Sums {
  const s: Sums = { income: 0, spent: 0, comingIn: 0, due: 0 }
  for (const e of entries) {
    const a = Number(e.amount)
    if (e.entry_date > today) {
      if (e.type === 'income') s.comingIn += a
      else s.due += a
    } else if (e.type === 'income') s.income += a
    else s.spent += a
  }
  return s
}

function periodLabel(period: Budget['period'], start: string, loc: string, short = false): string {
  const d = dateOf(start)
  if (period === 'monthly')
    return short ? d.toLocaleDateString(loc, { month: 'short' }).replace('.', '') : d.toLocaleDateString(loc, { month: 'long', year: 'numeric' })
  const fmt = (x: Date) => x.toLocaleDateString(loc, { day: 'numeric', month: 'short' }).replace('.', '')
  if (period === 'weekly') return short ? fmt(d) : `${fmt(d)} – ${fmt(dateOf(periodEndISO('weekly', start)))}`
  return short ? d.toLocaleDateString(loc, { day: 'numeric' }) : d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'short' })
}

export function MoneyBoard({
  data,
  budgets,
  version,
  onNew,
  top,
}: {
  data: HubData
  budgets: Budget[]
  /** Bumped after a new entry, to reload. */
  version: number
  onNew: () => void
  /** Shown under the toolbar (the new-entry form). */
  top?: ReactNode
}) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const today = todayISO()
  const [budgetId, setBudgetId] = useState(budgets[0]?.id ?? '')
  const budget = budgets.find((b) => b.id === budgetId) ?? budgets[0]
  const [hist, setHist] = useState<{ id: string; v: number; h: MoneyHistory } | null>(null)
  const [sel, setSel] = useState(0) // index into periods (0 = newest)

  useEffect(() => {
    if (!budget) return
    let alive = true
    void loadHistory(budget).then((h) => {
      if (!alive) return
      setHist({ id: budget.id, v: version, h })
      // Open on the period holding today, else the newest.
      const cur = h.periods.findIndex((p) => p.month.start_date <= today && today <= periodEndISO(budget.period, p.month.start_date))
      setSel(cur >= 0 ? cur : 0)
    })
    return () => {
      alive = false
    }
  }, [budget, version, today])

  const ready = hist && budget && hist.id === budget.id
  const periods = ready ? hist.h.periods : []
  const p: PeriodData | undefined = periods[sel]
  const s = p ? sums(p.entries, today) : null
  const g = budget ? budgetGradient(budget.id) : GRAD.money

  const catName = (id: string) => {
    const h = hist?.h
    const c = categoryById(id, h?.custom, h?.overrides)
    const builtin = !h?.custom.some((x) => x.id === id) && c.id === id
    return { icon: c.icon, name: builtin ? (overriddenName(id, h?.overrides) ?? t(`cat.${id}` as TKey)) : c.name }
  }

  return (
    // Wide: the two columns scroll on their own (no long empty column beside
    // the entry list); narrow: one column, the whole board scrolls.
    <div className="casa-scroll @container flex min-h-0 flex-1 flex-col px-4 pb-6 sm:px-6">
      {/* budgets + new expense */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2.5">
        {budgets.length > 1
          ? budgets.map((b) => (
              <button
                key={b.id}
                onClick={() => setBudgetId(b.id)}
                className="casa-press h-11 rounded-full px-5 text-[0.98rem] font-semibold"
                style={b.id === budget?.id ? { background: grad(budgetGradient(b.id)), color: '#fff' } : { background: 'var(--surface)' }}
              >
                {b.name}
              </button>
            ))
          : null}
        <span className="flex-1" />
        <button
          onClick={onNew}
          className="casa-press inline-flex h-12 items-center gap-2 rounded-full px-6 text-[0.98rem] font-semibold text-white"
          style={{ background: grad(GRAD.money), boxShadow: '0 12px 26px -14px #0FA37F' }}
        >
          <Plus size={22} strokeWidth={2.6} aria-hidden />
          {t('casa.money.newExpense')}
        </button>
      </div>

      {top}
      {!ready ? (
        <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="casa-shimmer h-72 rounded-[32px]" />
          <div className="casa-shimmer h-72 rounded-[32px]" />
        </div>
      ) : !p || !s || !budget ? (
        <p className="font-display py-16 text-center text-[1.5rem]">{t('casa.money.noEntries')}</p>
      ) : (
        <div className="grid gap-5 @4xl:min-h-0 @4xl:flex-1 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="casa-scroll flex flex-col gap-5 @4xl:min-h-0 @4xl:pb-4 [&>*]:shrink-0">
            <Hero
              g={g}
              name={budget.name}
              label={periodLabel(budget.period, p.month.start_date, loc)}
              s={s}
              canPrev={sel < periods.length - 1}
              canNext={sel > 0}
              onPrev={() => setSel((i) => Math.min(periods.length - 1, i + 1))}
              onNext={() => setSel((i) => Math.max(0, i - 1))}
            />
            <History budget={budget} periods={periods} sel={sel} onSel={setSel} today={today} />
            <Where entries={p.entries.filter((e) => e.type === 'expense' && e.entry_date <= today)} catName={catName} />
          </div>
          <div className="casa-scroll flex flex-col gap-5 @4xl:min-h-0 @4xl:pb-4 [&>*]:shrink-0">
            <ByPerson entries={p.entries.filter((e) => e.type === 'expense' && e.entry_date <= today)} members={data.members} />
            <Entries entries={p.entries} members={data.members} catName={catName} today={today} />
          </div>
        </div>
      )}
    </div>
  )
}

function Hero({
  g,
  name,
  label,
  s,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  g: readonly [string, string]
  name: string
  label: string
  s: Sums
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  const balance = s.income - s.spent
  const expected = balance + s.comingIn - s.due
  const usedPct = s.income > 0 ? Math.min(100, (s.spent / s.income) * 100) : s.spent > 0 ? 100 : 0
  const nav = (dir: -1 | 1) => {
    const Icon = dir < 0 ? ChevronLeft : ChevronRight
    const on = dir < 0 ? canPrev : canNext
    return (
      <button
        onClick={dir < 0 ? onPrev : onNext}
        disabled={!on}
        aria-label={dir < 0 ? t('casa.money.prev') : t('casa.money.next')}
        className="casa-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/18 text-white disabled:opacity-30"
      >
        <Icon size={22} aria-hidden />
      </button>
    )
  }
  return (
    <section className="casa-rise overflow-hidden rounded-[32px] p-[clamp(18px,3vmin,1.9rem)] text-white" style={{ background: grad(g), boxShadow: `0 28px 60px -32px ${g[1]}` }}>
      <div className="flex items-center gap-3">
        {nav(-1)}
        <span className="min-w-0 flex-1 text-center">
          <span className="block truncate text-[0.95rem] font-semibold tracking-[0.12em] uppercase opacity-80">{name}</span>
          <span className="font-display block truncate text-[1.35rem] leading-tight first-letter:uppercase">{label}</span>
        </span>
        {nav(1)}
      </div>
      <p className="mt-5 text-[1rem] opacity-80">{t('casa.money.balance')}</p>
      <p className="font-display text-[clamp(2.6rem,min(8vw,8dvh),4rem)] leading-none tabular-nums">{formatMoney(balance)}</p>
      {s.comingIn || s.due ? <p className="mt-2 text-[1rem] opacity-85">{t('casa.money.expected', { amount: formatMoney(expected) })}</p> : null}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat label={t('chart.received')} value={s.income} dot="#9FF2C9" />
        <Stat label={t('chart.spent')} value={s.spent} dot="#FFB4A8" />
      </div>
      <div className="mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white/85" style={{ width: `${usedPct}%`, transition: 'width 1s cubic-bezier(.2,.8,.2,1)' }} />
        </div>
        {s.income > 0 ? <p className="mt-1.5 text-[0.9rem] opacity-80">{t('casa.money.ofIncome', { pct: Math.round((s.spent / s.income) * 100) })}</p> : null}
      </div>
    </section>
  )
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-[20px] bg-white/14 px-4 py-3">
      <span className="flex items-center gap-2 text-[0.95rem] opacity-85">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
        {label}
      </span>
      <span className="font-display mt-0.5 block text-[1.5rem] leading-tight tabular-nums">{formatMoney(value)}</span>
    </div>
  )
}

/** Received vs spent per period, oldest left. Tap a column to open it. */
function History({ budget, periods, sel, onSel, today }: { budget: Budget; periods: PeriodData[]; sel: number; onSel: (i: number) => void; today: string }) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const cols = periods.map((p, i) => ({ i, p, s: sums(p.entries, today) })).reverse()
  const max = Math.max(1, ...cols.map((c) => Math.max(c.s.income, c.s.spent)))
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <section className="casa-card casa-rise rounded-[30px] p-[clamp(16px,2.6vmin,1.6rem)]" style={{ ['--i' as string]: 1 }}>
      <header className="mb-4 flex items-center gap-4">
        <h3 className="font-display flex-1 text-[1.3rem]">{t('casa.money.history')}</h3>
        <Legend color={IN} label={t('chart.received')} />
        <Legend color={OUT} label={t('chart.spent')} />
      </header>
      {cols.length < 2 ? (
        <p className="py-6 text-center text-[0.98rem] text-(--text-muted)">{t('casa.money.historySoon')}</p>
      ) : (
        <div className="flex h-[clamp(9rem,26dvh,14rem)] items-end justify-center gap-[clamp(4px,1vw,12px)]">
          {cols.map(({ i, p, s }) => {
            const on = i === sel
            return (
              <button
                key={p.month.id}
                onClick={() => onSel(i)}
                aria-label={periodLabel(budget.period, p.month.start_date, loc)}
                className="casa-press group flex h-full max-w-[5.5rem] min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-[14px] pt-1"
                style={on ? { background: 'color-mix(in srgb, var(--text) 6%, transparent)' } : undefined}
              >
                <span className="flex min-h-0 w-full flex-1 items-end justify-center gap-[3px] px-[2px]">
                  {[
                    [s.income, IN],
                    [s.spent, OUT],
                  ].map(([v, c], k) => (
                    <span
                      key={k}
                      className="block w-[min(44%,18px)] rounded-t-[6px]"
                      style={{
                        height: grown ? `${Math.max(2, ((v as number) / max) * 100)}%` : '2%',
                        background: c as string,
                        opacity: on ? 1 : 0.45,
                        transition: `height .9s cubic-bezier(.2,.8,.2,1) ${k * 60}ms, opacity .25s`,
                      }}
                    />
                  ))}
                </span>
                <span className={`max-w-full truncate pb-1 text-[0.8rem] ${on ? 'font-semibold text-(--text)' : 'text-(--text-faint)'}`}>
                  {periodLabel(budget.period, p.month.start_date, loc, true)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="hidden items-center gap-1.5 text-[0.88rem] text-(--text-muted) @lg:inline-flex">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

/** Spending by category: one stacked bar, then the top ones. */
function Where({ entries, catName }: { entries: Entry[]; catName: (id: string) => { icon: string; name: string } }) {
  const { t } = useI18n()
  const rows = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + Number(e.amount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])
  const total = rows.reduce((n, [, v]) => n + v, 0)
  const top = rows.slice(0, 6)
  const rest = rows.slice(6).reduce((n, [, v]) => n + v, 0)
  return (
    <section className="casa-card casa-rise rounded-[30px] p-[clamp(16px,2.6vmin,1.6rem)]" style={{ ['--i' as string]: 2 }}>
      <header className="mb-3 flex items-baseline gap-3">
        <h3 className="font-display flex-1 text-[1.3rem]">{t('casa.money.where')}</h3>
        {total ? <span className="text-[1rem] font-semibold tabular-nums text-(--text-muted)">{formatMoney(total)}</span> : null}
      </header>
      {!total ? (
        <p className="py-4 text-[0.98rem] text-(--text-muted)">{t('casa.money.noSpending')}</p>
      ) : (
        <>
          <div className="flex h-3.5 overflow-hidden rounded-full bg-(--surface)">
            {top.map(([id, v], k) => (
              <span key={id} style={{ width: `${(v / total) * 100}%`, background: CAT_COLORS[k % CAT_COLORS.length] }} />
            ))}
            {rest ? <span style={{ width: `${(rest / total) * 100}%`, background: 'var(--surface-2)' }} /> : null}
          </div>
          <ul className="mt-4 grid gap-2.5 @lg:grid-cols-2 @4xl:grid-cols-1 @6xl:grid-cols-2">
            {top.map(([id, v], k) => {
              const c = catName(id)
              return (
                <li key={id} className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[1.2rem]" style={{ background: `${CAT_COLORS[k % CAT_COLORS.length]}22` }}>
                    {c.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[1rem] font-medium">{c.name}</span>
                      <span className="text-[0.98rem] font-semibold tabular-nums">{formatMoney(v)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface)">
                        <span className="block h-full rounded-full" style={{ width: `${(v / total) * 100}%`, background: CAT_COLORS[k % CAT_COLORS.length] }} />
                      </span>
                      <span className="w-9 text-right text-[0.82rem] tabular-nums text-(--text-faint)">{Math.round((v / total) * 100)}%</span>
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

/** Who spent what this period (only when more than one person did). */
function ByPerson({ entries, members }: { entries: Entry[]; members: Member[] }) {
  const { t } = useI18n()
  const rows = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.person_email, (m.get(e.person_email) ?? 0) + Number(e.amount))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [entries])
  if (rows.length < 2) return null
  const max = rows[0][1] || 1
  return (
    <section className="casa-card casa-rise rounded-[30px] p-[clamp(16px,2.6vmin,1.6rem)]" style={{ ['--i' as string]: 3 }}>
      <h3 className="font-display mb-3 text-[1.3rem]">{t('casa.money.byPerson')}</h3>
      <ul className="grid gap-3">
        {rows.map(([email, v]) => {
          const m = members.find((x) => x.email === email)
          return (
            <li key={email} className="flex items-center gap-3">
              {m ? <Avatar m={m} size={40} /> : <span className="h-10 w-10 rounded-full bg-(--surface)" />}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[1rem] font-medium">{m?.first ?? email.split('@')[0]}</span>
                  <span className="text-[0.98rem] font-semibold tabular-nums">{formatMoney(v)}</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-(--surface)">
                  <span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: m?.color ?? 'var(--text-faint)' }} />
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The period's entries, grouped by day (upcoming ones first, marked). */
function Entries({ entries, members, catName, today }: { entries: Entry[]; members: Member[]; catName: (id: string) => { icon: string; name: string }; today: string }) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const days = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const e of entries) {
      const l = m.get(e.entry_date) ?? []
      l.push(e)
      m.set(e.entry_date, l)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [entries])
  return (
    <section className="casa-card casa-rise rounded-[30px] p-[clamp(16px,2.6vmin,1.6rem)]" style={{ ['--i' as string]: 4 }}>
      <header className="mb-1 flex items-baseline gap-3">
        <h3 className="font-display flex-1 text-[1.3rem]">{t('casa.money.entries')}</h3>
        <span className="text-[0.95rem] text-(--text-muted) tabular-nums">{entries.length}</span>
      </header>
      {!days.length ? (
        <p className="py-4 text-[0.98rem] text-(--text-muted)">{t('casa.money.noEntries')}</p>
      ) : (
        days.map(([day, list]) => (
          <div key={day} className="mt-3">
            <p className="mb-1 text-[0.8rem] font-semibold tracking-[0.12em] text-(--text-faint) uppercase">
              {dateOf(day).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })}
              {day > today ? ` · ${t('casa.money.upcoming')}` : ''}
            </p>
            <ul className="divide-y divide-(--surface)">
              {list.map((e) => {
                const c = catName(e.category)
                const who = members.find((m) => m.email === e.person_email)
                return (
                  <li key={e.id} className={`flex items-center gap-3 py-2.5 ${day > today ? 'opacity-60' : ''}`}>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-(--surface) text-[1.15rem]" aria-hidden>
                      {c.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[1rem] font-medium">{e.label}</span>
                      <span className="block truncate text-[0.88rem] text-(--text-faint)">
                        {c.name}
                        {who ? ` · ${who.first}` : ''}
                      </span>
                    </span>
                    <span className="text-[1rem] font-semibold tabular-nums" style={{ color: e.type === 'income' ? IN : undefined }}>
                      {e.type === 'income' ? '+' : '−'}
                      {formatMoney(Number(e.amount))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
