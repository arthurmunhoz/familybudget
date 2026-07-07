import { useEffect, useRef, useState } from 'react'
import {
  Calculator as CalcIcon,
  Camera,
  Check,
  ChevronRight,
  Receipt,
  Scale,
  Tag,
  Users,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { formatMoney } from '../../lib/format'
import { fileToResizedBase64 } from '../../lib/image'
import type { TKey } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

type Tool = 'split' | 'unit' | 'discount'
const TOOLS: { id: Tool; icon: LucideIcon; title: TKey; sub: TKey }[] = [
  { id: 'split', icon: Utensils, title: 'calc.tool.split', sub: 'calc.tool.splitSub' },
  { id: 'unit', icon: Scale, title: 'calc.tool.unit', sub: 'calc.tool.unitSub' },
  { id: 'discount', icon: Tag, title: 'calc.tool.discount', sub: 'calc.tool.discountSub' },
]

// Currency with extra precision for tiny per-unit prices.
const perUnitFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
})

/** Parse a user-typed amount; blank/garbage → 0. */
function num(s: string): number {
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function Calculator() {
  const back = useBack()
  const { t } = useI18n()
  const [tool, setTool] = useState<Tool | null>(null)
  const active = TOOLS.find((x) => x.id === tool)

  // Leave room for the sticky header when iOS scrolls a focused input into view
  // (otherwise the on-screen keyboard can tuck content under the header). Scoped
  // to this page: set on the scrolling root while mounted, restored on exit.
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.scrollPaddingTop
    root.style.scrollPaddingTop = 'calc(env(safe-area-inset-top) + 4.5rem)'
    return () => {
      root.style.scrollPaddingTop = prev
    }
  }, [])

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => (tool ? setTool(null) : back('/'))}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex flex-1 items-center gap-2 font-display text-2xl font-semibold text-(--text)">
          {active ? (
            <>
              <active.icon size={22} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
              {t(active.title)}
            </>
          ) : (
            <>
              <CalcIcon size={22} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
              {t('calc.title')}
            </>
          )}
        </h1>
      </header>

      {tool === 'split' ? (
        <SplitBill />
      ) : tool === 'unit' ? (
        <BetterDeal />
      ) : tool === 'discount' ? (
        <Discount />
      ) : (
        <Menu onPick={setTool} />
      )}
    </div>
  )
}

// ── Tool menu ────────────────────────────────────────────────────────────────

function Menu({ onPick }: { onPick: (t: Tool) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      {TOOLS.map((tl) => (
        <button
          key={tl.id}
          onClick={() => onPick(tl.id)}
          className="flex w-full items-center gap-4 rounded-2xl bg-(--card) p-4 text-left active:bg-(--card-active) transition-colors"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-(--surface) text-(--accent)">
            <tl.icon size={24} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-(--text)">{t(tl.title)}</span>
            <span className="block text-xs text-(--text-faint)">{t(tl.sub)}</span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-(--text-faint)" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-(--text-faint)">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)'

function ResultRow({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-sm text-(--text-muted)">{label}</span>
      <span
        className={`tabular-nums ${strong ? 'text-xl font-bold text-(--text)' : 'font-semibold text-(--text)'}`}
      >
        {value}
      </span>
    </div>
  )
}

/** Percentage chips + a free-form "custom" field. The custom input keeps its
 *  own raw string so partial entries like "12." type cleanly; picking a preset
 *  clears it. */
function PercentPicker({
  value,
  onChange,
  presets,
}: {
  value: number
  onChange: (n: number) => void
  presets: number[]
}) {
  const { t } = useI18n()
  const [custom, setCustom] = useState('')
  const usingCustom = custom !== ''
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {presets.map((v) => (
        <button
          key={v}
          onClick={() => {
            setCustom('')
            onChange(v)
          }}
          className={`min-w-14 flex-1 rounded-lg py-1.5 text-sm font-semibold transition-colors ${
            value === v && !usingCustom ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
          }`}
        >
          {v}%
        </button>
      ))}
      <input
        inputMode="decimal"
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value)
          onChange(num(e.target.value))
        }}
        placeholder={t('calc.custom')}
        className={`w-20 rounded-lg py-1.5 text-center text-sm font-semibold outline-none transition-colors ${
          usingCustom
            ? 'bg-(--accent) text-white placeholder:text-white/70'
            : 'bg-(--surface) text-(--text) placeholder:text-(--text-faint)'
        }`}
      />
    </div>
  )
}

// ── Split a bill (evenly, or by item from a photo) ───────────────────────────

function SplitBill() {
  const { t } = useI18n()
  const [mode, setMode] = useState<'even' | 'item'>('even')
  return (
    <div>
      <div className="mt-3 mb-6 grid grid-cols-2 gap-1 rounded-xl bg-(--surface) p-1">
        {(['even', 'item'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              mode === m ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
            }`}
          >
            {t(m === 'even' ? 'calc.evenly' : 'calc.byItem')}
          </button>
        ))}
      </div>
      {mode === 'even' ? <EvenSplit /> : <ItemSplit />}
    </div>
  )
}

// ── Split evenly ─────────────────────────────────────────────────────────────

function EvenSplit() {
  const { t } = useI18n()
  const [bill, setBill] = useState('')
  const [tipPct, setTipPct] = useState(20)
  const [people, setPeople] = useState(2)
  // Focus the amount on open WITHOUT scrolling — the field is already at the top
  // above the keyboard, so iOS won't leave the page scrolled under the header
  // (which `autoFocus` did). See the Calculator scroll-padding note too.
  const billRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    billRef.current?.focus({ preventScroll: true })
  }, [])

  const b = num(bill)
  const tip = (b * tipPct) / 100
  const total = b + tip
  const per = total / Math.max(1, people)

  return (
    <div className="space-y-4">
      <div className="pb-1 text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
          {t('calc.bill')}
        </span>
        <div className="mt-1 flex items-center justify-center gap-1">
          <span className="text-3xl font-semibold text-(--text-muted)">$</span>
          {/* font-size/weight are set inline: an unlayered global `input` rule in
              index.css (font-size:16px) outranks Tailwind's layered text utility. */}
          <input
            ref={billRef}
            value={bill}
            onChange={(e) => setBill(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            style={{ fontSize: '2.75rem', fontWeight: 700 }}
            className="w-52 bg-transparent text-center tracking-tight text-(--text) outline-none placeholder:text-(--text-faint)"
          />
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold text-(--text-faint)">
          {t('calc.tipPct')} · {tipPct}%
        </span>
        <PercentPicker value={tipPct} onChange={setTipPct} presets={[18, 20, 22]} />
      </div>

      <div>
        <span className="text-xs font-semibold text-(--text-faint)">{t('calc.split')}</span>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => setPeople((p) => Math.max(1, p - 1))}
            className="h-10 w-10 shrink-0 rounded-xl bg-(--surface) text-xl font-bold text-(--text-muted) active:scale-95 transition-transform"
          >
            −
          </button>
          <span className="flex-1 text-center text-lg font-bold text-(--text)">
            {t('calc.people', { count: people })}
          </span>
          <button
            onClick={() => setPeople((p) => p + 1)}
            className="h-10 w-10 shrink-0 rounded-xl bg-(--surface) text-xl font-bold text-(--text-muted) active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-(--card) px-4 py-3">
        <ResultRow label={t('calc.tipAmount')} value={formatMoney(tip)} />
        <ResultRow label={t('calc.total')} value={formatMoney(total)} />
        <div className="my-1 h-px bg-(--surface-2)" />
        <ResultRow label={t('calc.perPerson')} value={formatMoney(per)} strong />
      </div>
    </div>
  )
}

// ── Better deal (unit price) ─────────────────────────────────────────────────

const UNITS = ['kg', 'g', 'lb', 'oz', 'L', 'mL', 'each']

function BetterDeal() {
  const { t } = useI18n()
  const [unit, setUnit] = useState('kg')
  const [pA, setPA] = useState('')
  const [qA, setQA] = useState('')
  const [pB, setPB] = useState('')
  const [qB, setQB] = useState('')

  const uA = num(qA) > 0 ? num(pA) / num(qA) : NaN
  const uB = num(qB) > 0 ? num(pB) / num(qB) : NaN
  const unitLabel = unit === 'each' ? t('calc.unitEach') : unit

  const both = Number.isFinite(uA) && Number.isFinite(uB)
  const winner = both ? (uA < uB ? 'A' : uB < uA ? 'B' : 'tie') : null
  const pct =
    both && winner !== 'tie' ? Math.round((Math.abs(uA - uB) / Math.max(uA, uB)) * 100) : 0

  const card = (
    side: 'A' | 'B',
    price: string,
    setPrice: (s: string) => void,
    qty: string,
    setQty: (s: string) => void,
    unitPrice: number,
  ) => (
    <div
      className={`rounded-2xl border-2 bg-(--card) p-3 transition-all ${
        winner === side ? 'border-(--income) shadow-md' : 'border-transparent'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-(--text)">
          {side === 'A' ? t('calc.optionA') : t('calc.optionB')}
        </span>
        {winner === side && (
          <span className="animate-pop inline-flex items-center gap-1 rounded-full bg-(--income) px-2 py-0.5 text-[11px] font-bold text-white">
            <Check size={12} strokeWidth={2.5} aria-hidden="true" /> {t('calc.betterDeal')}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder={t('calc.price')}
          className={inputCls}
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="decimal"
          placeholder={t('calc.amount')}
          className={inputCls}
        />
      </div>
      <p className="mt-2 text-sm text-(--text-muted)">
        {Number.isFinite(unitPrice) ? (
          <span className="font-semibold text-(--text)">
            {perUnitFmt.format(unitPrice)} / {unitLabel}
          </span>
        ) : (
          '—'
        )}
      </p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-(--text-faint)">{t('calc.unit')}</span>
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {UNITS.map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                unit === u ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
              }`}
            >
              {u === 'each' ? t('calc.unitEach') : u}
            </button>
          ))}
        </div>
      </div>
      {card('A', pA, setPA, qA, setQA, uA)}
      {card('B', pB, setPB, qB, setQB, uB)}
      {winner === 'tie' ? (
        <p className="text-center text-sm font-semibold text-(--text-muted)">{t('calc.tie')}</p>
      ) : both ? (
        <p className="animate-pop text-center text-sm font-semibold text-(--income)">
          {t('calc.cheaperBy', { side: winner === 'A' ? 'A' : 'B', pct })}
        </p>
      ) : null}
    </div>
  )
}

// ── Discount ─────────────────────────────────────────────────────────────────
// Deal-forward layout: the sale price ("You pay") is the hero, the original is
// struck through beside it, a green "Save $X · N%" pill sits below, and the
// discount itself is a big "N% OFF" readout with quick chips, a Custom field,
// and − / + fine-tuning.

const DISCOUNT_CHIPS = [10, 15, 20, 50]

function Discount() {
  const { t } = useI18n()
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState(20)
  const [custom, setCustom] = useState('')
  // Focus without scrolling — see SplitBill / the Calculator scroll-padding note.
  const priceRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    priceRef.current?.focus({ preventScroll: true })
  }, [])

  const p = num(price)
  const save = (p * pct) / 100
  const final = Math.max(0, p - save)
  const hasDeal = p > 0 && save > 0

  function pickChip(v: number) {
    setPct(v)
    setCustom('')
  }
  function onCustom(val: string) {
    setCustom(val)
    setPct(num(val))
  }
  function adjust(delta: number) {
    setCustom('')
    setPct((cur) => Math.min(100, Math.max(0, Math.round(cur) + delta)))
  }

  return (
    <div className="space-y-4">
      <Field label={t('calc.original')}>
        <input
          ref={priceRef}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className={inputCls}
        />
      </Field>

      {/* Discount % — big readout + fine-tune, quick chips, custom */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-display text-2xl text-(--accent)">
            {pct}%{' '}
            <span className="text-sm tracking-wide text-(--accent)">{t('calc.off')}</span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => adjust(-1)}
              aria-label="−1%"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-full bg-(--surface) text-lg font-bold text-(--text-muted) active:scale-95 transition-transform"
            >
              −
            </button>
            <button
              onClick={() => adjust(1)}
              aria-label="+1%"
              className="flex h-8.5 w-8.5 items-center justify-center rounded-full bg-(--surface) text-lg font-bold text-(--text-muted) active:scale-95 transition-transform"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {DISCOUNT_CHIPS.map((v) => {
            const active = pct === v && custom === ''
            return (
              <button
                key={v}
                onClick={() => pickChip(v)}
                className={`min-w-14 flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${
                  active ? 'bg-(--accent) text-white' : 'bg-(--surface) text-(--text-muted)'
                }`}
              >
                {v}%
              </button>
            )
          })}
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            placeholder={t('calc.custom')}
            className={`w-20 rounded-lg py-2 text-center text-sm font-bold outline-none transition-colors ${
              custom !== ''
                ? 'bg-(--accent) text-white placeholder:text-white/70'
                : 'bg-(--surface) text-(--text) placeholder:text-(--text-faint)'
            }`}
          />
        </div>
      </div>

      {/* Result — the sale price is the hero */}
      <div className="space-y-2 rounded-2xl bg-(--card) p-4">
        <span className="block text-xs font-semibold tracking-wide text-(--text-faint) uppercase">
          {t('calc.youPay')}
        </span>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-display text-4xl tabular-nums text-(--text)">
            {formatMoney(final)}
          </span>
          {hasDeal && (
            <span className="text-base text-(--text-faint) line-through">{formatMoney(p)}</span>
          )}
        </div>
        {hasDeal && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-(--income)/12 px-2.5 py-1 text-[13px] font-semibold text-(--income)">
            <Tag size={14} strokeWidth={2} aria-hidden="true" />
            {t('calc.savePill', { amount: formatMoney(save), pct })}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Split by item (scan + assign) ────────────────────────────────────────────

type BillItem = { id: string; name: string; price: string; people: string[] }
type ScanResult = { items: { name: string; price: number }[]; tax: number | null; tip: number | null }

// Dev-only sample so the assign UI is testable without the (deployed) scan API.
const SAMPLE_BILL: ScanResult = {
  items: [
    { name: 'Margherita Pizza', price: 18 },
    { name: 'Caesar Salad', price: 12 },
    { name: '2× Lemonade', price: 9 },
    { name: 'Tiramisu', price: 8 },
  ],
  tax: 4.2,
  tip: 9,
}

// Each person gets a stable colour (hashed from their name, so it doesn't shift
// when someone is removed) — used on their avatar, their item chips, and their
// total, so it's easy to track who's who at a glance.
const PALETTE = ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5']
function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
const firstName = (name: string) => name.trim().split(/\s+/)[0]

function Avatar({ name, sm }: { name: string; sm?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        sm ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs'
      }`}
      style={{ backgroundColor: colorFor(name) }}
    >
      {initials(name)}
    </span>
  )
}

function ItemSplit() {
  const { t } = useI18n()
  const { profiles } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const nextId = () => `it-${idRef.current++}`

  const [phase, setPhase] = useState<'start' | 'scanning' | 'assign'>('start')
  const [items, setItems] = useState<BillItem[]>([])
  const [tax, setTax] = useState('')
  const [tip, setTip] = useState('')
  // Tip can be a flat amount or a % of the subtotal. A scanned bill that
  // already has a tip starts in amount mode; one without starts in % mode so
  // you can just tap a percentage.
  const [tipMode, setTipMode] = useState<'amount' | 'percent'>('amount')
  const [tipPct, setTipPct] = useState(20)
  const [people, setPeople] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const [err, setErr] = useState('')

  function loadScan(r: ScanResult) {
    setItems(
      r.items.map((it) => ({ id: nextId(), name: it.name, price: String(it.price), people: [] })),
    )
    setTax(r.tax != null ? String(r.tax) : '')
    if (r.tip != null) {
      setTip(String(r.tip))
      setTipMode('amount')
    } else {
      setTip('')
      setTipMode('percent')
    }
    setPhase('assign')
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')
    setPhase('scanning')
    try {
      const { data, mediaType } = await fileToResizedBase64(file, 2048)
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/scan-bill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token}`,
        },
        body: JSON.stringify({ image: data, media_type: mediaType }),
      })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error ?? t('bill.scanFailed'))
      if (!r.items?.length) throw new Error(t('bill.scanFailed'))
      loadScan(r)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('bill.scanFailed'))
      setPhase('start')
    }
  }

  function addPerson(name: string) {
    const n = name.trim()
    if (!n || people.includes(n)) return
    setPeople((p) => [...p, n])
    setNameInput('')
  }
  function removePerson(name: string) {
    setPeople((p) => p.filter((x) => x !== name))
    setItems((its) => its.map((it) => ({ ...it, people: it.people.filter((x) => x !== name) })))
  }
  function toggle(id: string, name: string) {
    setItems((its) =>
      its.map((it) =>
        it.id !== id
          ? it
          : {
              ...it,
              people: it.people.includes(name)
                ? it.people.filter((x) => x !== name)
                : [...it.people, name],
            },
      ),
    )
  }
  const setField = (id: string, field: 'name' | 'price', val: string) =>
    setItems((its) => its.map((it) => (it.id === id ? { ...it, [field]: val } : it)))
  const removeItem = (id: string) => setItems((its) => its.filter((it) => it.id !== id))
  const addItem = () =>
    setItems((its) => [...its, { id: nextId(), name: '', price: '', people: [] }])

  const itemsSubtotal = items.reduce((s, it) => s + num(it.price), 0)
  // Percentage tips are figured on the (pre-tax) items subtotal, as is standard.
  const tipAmount = tipMode === 'percent' ? (itemsSubtotal * tipPct) / 100 : num(tip)
  const extras = num(tax) + tipAmount
  const assignedSubtotal = items
    .filter((it) => it.people.length > 0)
    .reduce((s, it) => s + num(it.price), 0)
  const unassignedCount = items.filter((it) => it.people.length === 0).length

  function personTotal(name: string) {
    const base = items
      .filter((it) => it.people.includes(name))
      .reduce((s, it) => s + num(it.price) / it.people.length, 0)
    const share = assignedSubtotal > 0 ? (base / assignedSubtotal) * extras : 0
    return base + share
  }

  // ── start ──
  if (phase === 'start') {
    const steps: [LucideIcon, TKey][] = [
      [Camera, 'bill.step1'],
      [Users, 'bill.step2'],
      [Utensils, 'bill.step3'],
    ]
    return (
      <div className="flex flex-col items-center gap-6 pt-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-(--surface) text-(--accent)">
          <Receipt size={36} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <p className="max-w-xs text-sm text-(--text-muted)">{t('bill.scanHint')}</p>
        {err && <p className="text-sm font-medium text-(--expense)">{err}</p>}
        <div className="w-full max-w-xs space-y-2">
          {steps.map(([StepIcon, key], i) => (
            <div
              key={key}
              className="flex items-center gap-3 rounded-xl bg-(--card) px-3 py-2.5 text-left"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--surface) text-xs font-bold text-(--text-muted)">
                {i + 1}
              </span>
              <StepIcon size={18} strokeWidth={2} className="text-(--accent)" aria-hidden="true" />
              <span className="text-sm font-medium text-(--text)">{t(key)}</span>
            </div>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-(--accent) py-3.5 font-bold text-white active:scale-[0.99] transition-transform"
        >
          <Camera size={18} strokeWidth={2} aria-hidden="true" />
          {t('bill.takePhoto')}
        </button>
        {import.meta.env.DEV && (
          <button
            onClick={() => loadScan(SAMPLE_BILL)}
            className="text-xs text-(--text-faint) underline"
          >
            Load sample bill (dev)
          </button>
        )}
      </div>
    )
  }

  // ── scanning ──
  if (phase === 'scanning') {
    return (
      <div className="flex flex-col items-center gap-4 pt-16 text-center">
        <div className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-(--surface) text-(--accent)">
          <Receipt size={30} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <p className="animate-pulse font-medium text-(--text-muted)">{t('bill.scanning')}</p>
      </div>
    )
  }

  // ── assign ──
  const others = profiles.map((p) => p.display_name).filter((n) => !people.includes(n))

  const countFor = (name: string) => items.filter((it) => it.people.includes(name)).length

  return (
    <div className="space-y-5">
      {/* who's splitting */}
      <div>
        <span className="text-xs font-semibold text-(--text-faint)">{t('bill.people')}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {people.map((p) => (
            <button
              key={p}
              onClick={() => removePerson(p)}
              className="flex items-center gap-1.5 rounded-full bg-(--card) py-1 pl-1 pr-2.5 text-sm font-semibold text-(--text)"
            >
              <Avatar name={p} sm />
              {firstName(p)}
              <X size={14} strokeWidth={2} className="text-(--text-faint)" aria-hidden="true" />
            </button>
          ))}
          {others.map((n) => (
            <button
              key={n}
              onClick={() => addPerson(n)}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-(--surface-2) py-1 pl-1 pr-2.5 text-sm font-semibold text-(--text-muted)"
            >
              <Avatar name={n} sm />+ {firstName(n)}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPerson(nameInput)}
            placeholder={t('bill.addName')}
            className={inputCls}
          />
          <button
            onClick={() => addPerson(nameInput)}
            className="shrink-0 rounded-xl bg-(--surface) px-4 text-xl font-bold text-(--text-muted) active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
      </div>

      {/* items */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-(--text-faint)">{t('bill.items')}</span>
          {unassignedCount > 0 && (
            <span className="text-xs font-medium text-amber-500">
              {t('bill.unassignedWarn', { count: unassignedCount })}
            </span>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {items.map((it) => {
            const unassigned = it.people.length === 0
            const shared = it.people.length > 1
            return (
              <div
                key={it.id}
                className={`rounded-2xl bg-(--card) p-3 transition-shadow ${
                  unassigned && people.length > 0 ? 'ring-1 ring-amber-400/50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={it.name}
                    onChange={(e) => setField(it.id, 'name', e.target.value)}
                    placeholder={t('bill.itemName')}
                    className="min-w-0 flex-1 bg-transparent font-semibold text-(--text) outline-none"
                  />
                  <span className="text-(--text-faint)">$</span>
                  <input
                    value={it.price}
                    onChange={(e) => setField(it.id, 'price', e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-16 rounded-lg bg-(--surface) px-2 py-1 text-right tabular-nums text-(--text) outline-none"
                  />
                  <button
                    onClick={() => removeItem(it.id)}
                    className="shrink-0 px-1 text-(--text-faint) active:text-(--expense)"
                  >
                    <X size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                {people.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {people.map((p) => {
                      const on = it.people.includes(p)
                      return (
                        <button
                          key={p}
                          onClick={() => toggle(it.id, p)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            on ? 'text-white' : 'bg-(--surface) text-(--text-muted)'
                          }`}
                          style={on ? { backgroundColor: colorFor(p) } : undefined}
                        >
                          {firstName(p)}
                        </button>
                      )
                    })}
                    {unassigned ? (
                      <span className="px-1 text-xs text-(--text-faint)">{t('bill.tapWho')}</span>
                    ) : shared ? (
                      <span className="ml-auto text-xs text-(--text-faint)">
                        {t('bill.splitWays', { count: it.people.length })} ·{' '}
                        {formatMoney(num(it.price) / it.people.length)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button
          onClick={addItem}
          className="mt-2 w-full rounded-xl bg-(--surface) py-2 text-sm font-semibold text-(--text-muted) active:scale-[0.99] transition-transform"
        >
          {t('bill.addItem')}
        </button>
      </div>

      {/* tax / tip / total */}
      <div className="rounded-2xl bg-(--card) px-4 py-3">
        <ResultRow label={t('bill.subtotal')} value={formatMoney(itemsSubtotal)} />
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-(--text-muted)">{t('bill.tax')}</span>
          <input
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-24 rounded-lg bg-(--surface) px-2 py-1 text-right tabular-nums text-(--text) outline-none"
          />
        </div>
        <div className="py-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-(--text-muted)">{t('bill.tip')}</span>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-(--surface) p-0.5">
                {(['percent', 'amount'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTipMode(m)}
                    className={`rounded-md px-2.5 py-0.5 text-sm font-bold transition-colors ${
                      tipMode === m ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
                    }`}
                  >
                    {m === 'percent' ? '%' : '$'}
                  </button>
                ))}
              </div>
              {tipMode === 'amount' ? (
                <input
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-24 rounded-lg bg-(--surface) px-2 py-1 text-right tabular-nums text-(--text) outline-none"
                />
              ) : (
                <span className="w-24 text-right text-sm font-semibold tabular-nums text-(--text)">
                  {formatMoney(tipAmount)}
                </span>
              )}
            </div>
          </div>
          {tipMode === 'percent' && (
            <PercentPicker value={tipPct} onChange={setTipPct} presets={[18, 20, 22]} />
          )}
        </div>
        <div className="my-1 h-px bg-(--surface-2)" />
        <ResultRow label={t('bill.billTotal')} value={formatMoney(itemsSubtotal + extras)} strong />
      </div>

      {/* per-person */}
      <div>
        <span className="text-xs font-semibold text-(--text-faint)">{t('bill.each')}</span>
        {people.length === 0 ? (
          <p className="mt-2 rounded-2xl bg-(--card) px-4 py-3 text-sm text-(--text-muted)">
            {t('bill.noPeople')}
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-2xl bg-(--card)">
            {people.map((p, i) => (
              <div
                key={p}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-(--surface-2)' : ''
                }`}
              >
                <Avatar name={p} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-(--text)">{p}</div>
                  <div className="text-xs text-(--text-faint)">
                    {t('bill.itemsCount', { count: countFor(p) })}
                  </div>
                </div>
                <div className="shrink-0 text-lg font-bold tabular-nums text-(--text)">
                  {formatMoney(personTotal(p))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-xl bg-(--surface) py-2.5 text-sm font-semibold text-(--text-muted) active:scale-[0.99] transition-transform"
      >
        {t('bill.newPhoto')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        className="hidden"
      />
    </div>
  )
}
