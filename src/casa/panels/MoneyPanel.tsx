// Dinheiro on the home device — behind the family's 4-digit PIN (set on the
// phone: Ajustes › Modo Casa). After it: this period's received / spent per
// budget, the latest entries, and a simple "new expense". The hub locks it
// again after 2 minutes without a touch.
import { useCallback, useEffect, useState } from 'react'
import { Delete, Lock, Smartphone, Wallet } from 'lucide-react'
import { useI18n } from '../../hooks/useI18n'
import { useAuth } from '../../hooks/useAuth'
import type { Budget } from '../../lib/types'
import type { HubData } from '../data'
import { addEntry, loadMoney, pinState, unlockMoney } from '../money'
import { chime, tick } from '../sound'
import { Avatar } from '../ui'
import { GRAD, budgetGradient, grad } from '../util'
import { PanelHeader } from './Shell'
import { MoneyBoard } from './MoneyBoard'

export default function MoneyPanel({ data, unlocked, onUnlock, onClose }: { data: HubData; unlocked: boolean; onUnlock: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const hid = profile?.household_id ?? ''
  const [pin, setPin] = useState<{ set: boolean; loaded: boolean }>({
    set: false,
    loaded: false,
  })

  useEffect(() => {
    if (unlocked || !hid) return
    let alive = true
    void pinState(hid).then((r) => alive && setPin({ set: r.set, loaded: true }))
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
      ) : !pin.set ? (
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
        <PinPad onOk={onUnlock} />
      )}
    </div>
  )
}

export function PinPad({ onOk }: { onOk: () => void }) {
  const { t } = useI18n()
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(0)
  const [wrong, setWrong] = useState<false | 'wrong' | 'too_many'>(false)

  const press = useCallback(
    async (d: string) => {
      if (digits.length >= 4) return
      tick()
      const next = digits + d
      setDigits(next)
      setWrong(false)
      if (next.length === 4) {
        const r = await unlockMoney(next)
        if (r === 'ok') {
          chime('done')
          setTimeout(onOk, 180)
        } else {
          setShake((s) => s + 1)
          setWrong(r === 'too_many' ? 'too_many' : 'wrong')
          setTimeout(() => setDigits(''), 380)
        }
      }
    },
    [digits, onOk],
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
            {wrong === 'too_many' ? t('casa.money.pinTooMany') : wrong ? t('casa.money.pinWrong') : t('casa.money.pinTitle')}
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
  const [budgets, setBudgets] = useState<Budget[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    void loadMoney().then((rows) => setBudgets(rows.map((r) => r.budget)))
  }, [])
  if (!budgets) {
    return (
      <div className="grid gap-5 px-4 sm:px-6 landscape:grid-cols-2">
        <div className="casa-shimmer h-72 rounded-[32px]" />
        <div className="casa-shimmer h-72 rounded-[32px]" />
      </div>
    )
  }
  return (
    <MoneyBoard
      data={data}
      budgets={budgets}
      version={version}
      onNew={() => setAdding((a) => !a)}
      top={
        adding ? (
          <NewEntry
            data={data}
            budgets={budgets}
            onDone={(saved) => {
              setAdding(false)
              if (saved) setVersion((v) => v + 1)
            }}
          />
        ) : null
      }
    />
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
