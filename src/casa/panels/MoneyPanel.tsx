// Dinheiro on the home device — behind the family's 4-digit PIN (set on the
// phone: Ajustes › Modo Casa). After it: this period's received / spent per
// budget, the latest entries, and a simple "new expense". The hub locks it
// again after 2 minutes without a touch.
import { useCallback, useEffect, useState } from 'react'
import { Delete, Lock, Plus, Smartphone, Wallet } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { categoryById } from '../../lib/categories'
import { formatMoney, periodEndISO } from '../../lib/format'
import { useAuth } from '../../hooks/useAuth'
import type { Budget } from '../../lib/types'
import type { HubData } from '../data'
import { addEntry, loadMoney, pinMatches, pinState, type BudgetSummary } from '../money'
import { chime, tick } from '../sound'
import { Avatar } from '../ui'
import { GRAD, LOCALE, budgetGradient, dateOf, grad } from '../util'
import { PanelHeader } from './Shell'

export default function MoneyPanel({ data, unlocked, onUnlock, onClose }: { data: HubData; unlocked: boolean; onUnlock: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const hid = profile?.household_id ?? ''
  const [pin, setPin] = useState<{ hash: string | null; loaded: boolean }>({
    hash: null,
    loaded: false,
  })

  useEffect(() => {
    if (unlocked || !hid) return
    let alive = true
    void pinState(hid).then((r) => alive && setPin({ hash: r.hash, loaded: true }))
    return () => {
      alive = false
    }
  }, [hid, unlocked])

  return (
    <div className="flex h-full flex-col bg-(--bg)">
      <PanelHeader
        icon={Wallet}
        g={GRAD.money}
        title={t('app.budget.name')}
        sub={unlocked ? t('casa.money.thisPeriod') : t('casa.money.pinSub')}
        onClose={onClose}
        closeLabel={t('casa.close')}
      />
      {unlocked ? (
        <MoneyOpen data={data} />
      ) : !pin.loaded ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="casa-dots text-(--text-faint)">
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : !pin.hash ? (
        <div className="casa-scroll min-h-0 flex-1">
          <div className="casa-fade flex min-h-full flex-col items-center justify-center px-6 py-[clamp(12px,4dvh,48px)] text-center">
            <span
              className="inline-flex h-[clamp(4rem,16dvh,7rem)] w-[clamp(4rem,16dvh,7rem)] shrink-0 items-center justify-center rounded-[30%]"
              style={{ background: grad(GRAD.money) }}
            >
              <Lock className="h-1/2 w-1/2" color="#fff" strokeWidth={2} aria-hidden />
            </span>
            <p className="font-display mt-[clamp(12px,3.5dvh,28px)] text-[clamp(1.6rem,min(5.5vw,6dvh),2.4rem)] leading-tight">{t('casa.money.noPinTitle')}</p>
            <p className="mt-3 flex max-w-[40ch] items-center gap-2 text-[1.05rem] text-(--text-muted)">
              <Smartphone size={22} className="shrink-0" aria-hidden />
              {t('casa.money.noPinBody')}
            </p>
          </div>
        </div>
      ) : (
        <PinPad householdId={hid} hash={pin.hash} onOk={onUnlock} />
      )}
    </div>
  )
}

export function PinPad({ householdId, hash, onOk }: { householdId: string; hash: string; onOk: () => void }) {
  const { t } = useI18n()
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(0)
  const [wrong, setWrong] = useState(false)

  const press = useCallback(
    async (d: string) => {
      if (digits.length >= 4) return
      tick()
      const next = digits + d
      setDigits(next)
      setWrong(false)
      if (next.length === 4) {
        const ok = await pinMatches(householdId, next, hash)
        if (ok) {
          chime('done')
          setTimeout(onOk, 180)
        } else {
          setShake((s) => s + 1)
          setWrong(true)
          setTimeout(() => setDigits(''), 380)
        }
      }
    },
    [digits, householdId, hash, onOk],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) void press(e.key)
      else if (e.key === 'Backspace') setDigits((d) => d.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  return (
    <div className="casa-scroll min-h-0 flex-1">
      <div className="casa-pin casa-fade">
        <div className="flex flex-col items-center text-center">
          <p className="font-display text-[clamp(1.5rem,min(6vw,5.5dvh),2.4rem)] leading-tight">
            {wrong ? t('casa.money.pinWrong') : t('casa.money.pinTitle')}
          </p>
          <div key={shake} className={`mt-[clamp(10px,2.6dvh,24px)] flex gap-[clamp(12px,2.4dvh,20px)] ${shake ? 'casa-shake' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-[clamp(16px,3dvh,1.75rem)] w-[clamp(16px,3dvh,1.75rem)] rounded-full"
                style={{
                  background: i < digits.length ? (wrong ? 'var(--expense)' : grad(GRAD.money)) : 'var(--surface-2)',
                  transform: i < digits.length ? 'scale(1.15)' : 'none',
                  transition: 'all .18s cubic-bezier(.2,1.4,.4,1)',
                }}
              />
            ))}
          </div>
        </div>
        <div className="casa-pin-keys">
          {keys.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                onClick={() => (k === 'del' ? setDigits((d) => d.slice(0, -1)) : void press(k))}
                aria-label={k === 'del' ? t('casa.money.delete') : k}
                className="casa-press casa-card casa-pin-key inline-flex items-center justify-center rounded-full font-semibold"
              >
                {k === 'del' ? <Delete aria-hidden /> : k}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function MoneyOpen({ data }: { data: HubData }) {
  const { t, lang } = useI18n()
  const loc = LOCALE[lang]
  const [rows, setRows] = useState<BudgetSummary[] | null>(null)
  const [adding, setAdding] = useState(false)
  const reload = useCallback(() => {
    void loadMoney().then(setRows)
  }, [])
  useEffect(reload, [reload])

  const nameOf = (email: string) => data.members.find((m) => m.email === email)

  return (
    <div className="casa-scroll min-h-0 flex-1 px-4 pb-10 sm:px-6">
      <div className="mb-[clamp(12px,3dvh,24px)] flex justify-end">
        <button
          onClick={() => setAdding((a) => !a)}
          className="casa-press inline-flex h-12 items-center gap-2 rounded-full px-7 text-[0.98rem] font-semibold text-white"
          style={{
            background: grad(GRAD.money),
            boxShadow: '0 12px 26px -14px #0FA37F',
          }}
        >
          <Plus size={24} strokeWidth={2.6} aria-hidden />
          {t('casa.money.newExpense')}
        </button>
      </div>
      {adding && rows ? (
        <NewEntry
          data={data}
          budgets={rows.map((r) => r.budget)}
          onDone={(saved) => {
            setAdding(false)
            if (saved) reload()
          }}
        />
      ) : null}
      {!rows ? (
        <div className="grid gap-5 landscape:grid-cols-2">
          <div className="casa-shimmer h-64 rounded-[32px]" />
          <div className="casa-shimmer h-64 rounded-[32px]" />
        </div>
      ) : rows.length === 0 ? (
        <p className="font-display py-16 text-center text-[1.5rem]">{t('casa.roof.noBudget')}</p>
      ) : (
        <div className="grid gap-5 landscape:grid-cols-2">
          {rows.map((r, i) => {
            const g = budgetGradient(r.budget.id)
            const max = Math.max(r.income, r.spent, 1)
            return (
              <section key={r.budget.id} className="casa-rise overflow-hidden rounded-[32px]" style={{ ['--i' as string]: i }}>
                <div className="p-[clamp(18px,3vmin,1.75rem)] text-white" style={{ background: grad(g) }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-display truncate text-[1.4rem]">{r.budget.name}</h3>
                    {r.month ? (
                      <span className="inline-block text-[1rem] opacity-80 first-letter:uppercase">{periodName(r.budget.period, r.month.start_date, loc)}</span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[1rem] opacity-80">{t('casa.money.balance')}</p>
                  <p className="font-display text-[clamp(2.2rem,min(7vw,7dvh),3.4rem)] leading-none">{formatMoney(r.balance)}</p>
                  {r.hasUpcoming ? (
                    <p className="mt-2 text-[1rem] opacity-80">
                      {t('casa.money.expected', {
                        amount: formatMoney(r.expected),
                      })}
                    </p>
                  ) : null}
                  <div className="mt-5 space-y-3">
                    <Bar label={t('chart.received')} value={r.income} max={max} color="#9FF2C9" />
                    <Bar label={t('chart.spent')} value={r.spent} max={max} color="#FFB4A8" />
                  </div>
                </div>
                <ul className="casa-card divide-y divide-(--surface) rounded-b-[32px] border-t-0">
                  {r.latest.length === 0 ? (
                    <li className="px-5 py-3 text-[0.92rem] sm:px-7 text-(--text-muted)">{t('casa.money.noEntries')}</li>
                  ) : (
                    r.latest.map((e) => {
                      const cat = categoryById(e.category)
                      const who = nameOf(e.person_email)
                      return (
                        <li key={e.id} className="flex items-center gap-4 px-5 py-3.5 sm:px-7">
                          <span className="text-[1.25rem]" aria-hidden>
                            {cat.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.98rem] font-medium">{e.label}</span>
                            <span className="block text-[0.9rem] text-(--text-faint)">
                              {dateOf(e.entry_date).toLocaleDateString(loc, {
                                day: 'numeric',
                                month: 'short',
                              })}
                              {who ? ` · ${who.first}` : ''}
                            </span>
                          </span>
                          <span className={`text-[1rem] font-semibold tabular-nums ${e.type === 'income' ? 'text-(--income)' : ''}`}>
                            {e.type === 'income' ? '+' : '−'}
                            {formatMoney(Number(e.amount))}
                          </span>
                        </li>
                      )
                    })
                  )}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function periodName(period: Budget['period'], start: string, loc: string): string {
  const d = dateOf(start)
  if (period === 'monthly') return d.toLocaleDateString(loc, { month: 'long', year: 'numeric' })
  const fmt = (x: Date) => x.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
  if (period === 'weekly') return `${fmt(d)} – ${fmt(dateOf(periodEndISO('weekly', start)))}`
  return d.toLocaleDateString(loc, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW((value / max) * 100))
    return () => cancelAnimationFrame(id)
  }, [value, max])
  return (
    <div>
      <div className="flex justify-between text-[1rem]">
        <span className="opacity-85">{label}</span>
        <span className="font-semibold tabular-nums">{formatMoney(value)}</span>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full"
          style={{
            width: `${w}%`,
            background: color,
            transition: 'width 1s cubic-bezier(.2,.8,.2,1)',
          }}
        />
      </div>
    </div>
  )
}

function NewEntry({ data, budgets, onDone }: { data: HubData; budgets: Budget[]; onDone: (saved: boolean) => void }) {
  const { t } = useI18n()
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [budgetId, setBudgetId] = useState(budgets[0]?.id ?? '')
  const [person, setPerson] = useState<string | null>(data.members.length === 1 ? data.members[0].email : null)
  const [busy, setBusy] = useState(false)
  const value = Number(amount.replace(',', '.'))
  const ok = value > 0 && !!budgetId && !!person

  async function save() {
    if (!ok || busy) return
    const budget = budgets.find((b) => b.id === budgetId)
    if (!budget || !person) return
    setBusy(true)
    try {
      await addEntry({
        budget,
        type,
        amount: Math.round(value * 100) / 100,
        label,
        person,
      })
      chime('done')
      onDone(true)
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="casa-card casa-rise mb-7 rounded-[30px] p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {(['expense', 'income'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setType(k)}
            className="casa-press h-11 rounded-full px-6 text-[0.95rem] font-semibold"
            style={type === k ? { background: grad(GRAD.money), color: '#fff' } : { background: 'var(--surface)' }}
          >
            {k === 'expense' ? t('casa.money.expense') : t('casa.money.income')}
          </button>
        ))}
        <span className="flex-1" />
        {budgets.length > 1
          ? budgets.map((b) => (
              <button
                key={b.id}
                onClick={() => setBudgetId(b.id)}
                className="casa-press h-11 rounded-full px-5 text-[0.92rem] font-semibold"
                style={budgetId === b.id ? { background: grad(budgetGradient(b.id)), color: '#fff' } : { background: 'var(--surface)' }}
              >
                {b.name}
              </button>
            ))
          : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0,00"
          aria-label={t('casa.money.amount')}
          className="font-display h-[clamp(3.5rem,10dvh,5rem)] w-full rounded-[22px] sm:w-[14rem] border border-(--surface-2) bg-(--bg) px-6 text-[2.4rem] outline-none focus:border-[#0FA37F]"
          style={{ fontSize: 'clamp(1.8rem, 6dvh, 2.4rem)' }}
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('casa.money.whatPlaceholder')}
          className="h-[clamp(3.5rem,10dvh,5rem)] min-w-[min(14rem,100%)] flex-1 rounded-[22px] border border-(--surface-2) bg-(--bg) px-6 text-[1.1rem] outline-none focus:border-[#0FA37F]"
          style={{ fontSize: 'clamp(1.15rem, 3.5dvh, 1.4rem)' }}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[1rem] font-semibold text-(--text-muted)">{t('casa.who.title')}</span>
        {data.members.map((m) => (
          <button
            key={m.email}
            onClick={() => setPerson(m.email)}
            className="casa-press inline-flex h-11 items-center gap-2 rounded-full pr-5 pl-1.5 text-[0.92rem] font-semibold"
            style={
              person === m.email
                ? {
                    background: `${m.color}33`,
                    boxShadow: `inset 0 0 0 2px ${m.color}`,
                  }
                : { background: 'var(--surface)' }
            }
          >
            <Avatar m={m} size={44} />
            {m.first}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => onDone(false)} className="casa-press h-11 rounded-full px-6 text-[0.95rem] font-semibold text-(--text-muted)">
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void save()}
          disabled={!ok || busy}
          className="casa-press h-11 rounded-full px-6 text-[0.95rem] font-semibold text-white disabled:opacity-50"
          style={{ background: grad(GRAD.money) }}
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
