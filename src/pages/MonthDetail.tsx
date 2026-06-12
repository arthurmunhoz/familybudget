import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EntryForm, { type EntryPrefill } from '../components/EntryForm'
import { fileToResizedBase64 } from '../lib/image'
import SummaryChart from '../components/SummaryChart'
import { useAuth } from '../hooks/useAuth'
import { categoryById } from '../lib/categories'
import {
  formatDay,
  formatDayHeading,
  formatMoney,
  periodEndISO,
  periodTitle,
  todayISO,
} from '../lib/format'
import { supabase } from '../lib/supabase'
import type { CategoryRule, Entry, Month, Period, Profile } from '../lib/types'

type MonthWithBudget = Month & {
  budgets: { name: string; period: Period } | null
}

type SortBy = 'date' | 'amount'
type SortDir = 'asc' | 'desc'
type View = 'list' | 'split'

export default function MonthDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, profiles } = useAuth()

  const [month, setMonth] = useState<MonthWithBudget | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [loading, setLoading] = useState(true)

  const [person, setPerson] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [dateDir, setDateDir] = useState<SortDir>('desc')
  const [view, setView] = useState<View>('list')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [prefill, setPrefill] = useState<EntryPrefill | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [showFuture, setShowFuture] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [m, e, r] = await Promise.all([
      supabase.from('months').select('*, budgets(name, period)').eq('id', id).single(),
      supabase.from('entries').select('*').eq('month_id', id),
      supabase.from('category_rules').select('keyword, category'),
    ])
    setMonth(m.data)
    setEntries(e.data ?? [])
    setRules(r.data ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () => (person === 'all' ? entries : entries.filter((e) => e.person_email === person)),
    [entries, person],
  )

  // Future-dated entries (e.g. upcoming recurring bills) are hidden from the
  // lists by default so today's activity is immediately visible. Charts and
  // balances still include them.
  const today = todayISO()
  const futureCount = useMemo(
    () => filtered.filter((e) => e.entry_date > today).length,
    [filtered, today],
  )
  const hideFuture = !showFuture && futureCount > 0
  const listVisible = (list: Entry[]) =>
    hideFuture ? list.filter((e) => e.entry_date <= today) : list

  const sortEntries = useCallback(
    (list: Entry[]) =>
      [...list].sort((a, b) => {
        if (sortBy === 'amount') return Number(b.amount) - Number(a.amount)
        const cmp =
          a.entry_date.localeCompare(b.entry_date) ||
          a.created_at.localeCompare(b.created_at)
        return dateDir === 'asc' ? cmp : -cmp
      }),
    [sortBy, dateDir],
  )

  const nameOf = (email: string) =>
    profiles.find((p) => p.email === email)?.display_name ?? email

  async function removeEntry(e: Entry) {
    setEntries((list) => list.filter((x) => x.id !== e.id))
    const { error } = await supabase.from('entries').delete().eq('id', e.id)
    if (error) {
      alert('Could not delete the entry — please try again.')
      load()
    }
  }

  async function scanReceipt(file: File) {
    setScanning(true)
    try {
      const { data, mediaType } = await fileToResizedBase64(file)
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ image: data, media_type: mediaType }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Scan failed')
      setEditing(null)
      setPrefill({
        label: result.label,
        amount: result.amount,
        category: result.category,
        entry_date: result.date,
      })
      setFormOpen(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read the receipt.')
    } finally {
      setScanning(false)
    }
  }

  if (loading || !month) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="animate-pulse text-(--text-faint)">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-full max-w-md px-4 pb-32">
      <header className="flex items-center gap-3 pt-6 pb-4">
        <button
          onClick={() => navigate(`/budget/${month.budget_id}`)}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="text-xl font-bold text-(--text)">
          {periodTitle(month.budgets?.period ?? 'monthly', month.start_date)}
        </h1>
      </header>

      {/* Person filter — charts and lists below react to it */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-(--surface) p-1">
        {[
          { key: 'all', label: 'Both' },
          ...profiles.map((p: Profile) => ({ key: p.email, label: p.display_name })),
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setPerson(opt.key)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              person === opt.key ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <SummaryChart entries={filtered} />
      </div>

      {/* List controls */}
      <div className="mt-5 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-(--surface) p-1 text-xs font-semibold">
          <button
            onClick={() =>
              sortBy === 'date'
                ? setDateDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                : setSortBy('date')
            }
            className={`rounded-md px-3 py-1.5 ${
              sortBy === 'date' ? 'bg-(--surface-2) text-(--text)' : 'text-(--text-faint)'
            }`}
          >
            By date {dateDir === 'asc' ? '↑' : '↓'}
          </button>
          <button
            onClick={() => setSortBy('amount')}
            className={`rounded-md px-3 py-1.5 ${
              sortBy === 'amount' ? 'bg-(--surface-2) text-(--text)' : 'text-(--text-faint)'
            }`}
          >
            By amount
          </button>
        </div>
        <div className="flex gap-1 rounded-lg bg-(--surface) p-1 text-xs font-semibold">
          {(['list', 'split'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 capitalize ${
                view === v ? 'bg-(--surface-2) text-(--text)' : 'text-(--text-faint)'
              }`}
            >
              {v === 'list' ? '☰ List' : '◫ Split'}
            </button>
          ))}
        </div>
      </div>

      {/* Future entries are collapsed behind a subtle toggle */}
      {futureCount > 0 && (
        <button
          onClick={() => setShowFuture((s) => !s)}
          className="mx-auto mt-3 block text-xs font-medium text-(--text-faint) underline decoration-dotted underline-offset-4 active:text-(--text-muted)"
        >
          {showFuture
            ? 'Hide future entries'
            : `Show ${futureCount} future ${futureCount === 1 ? 'entry' : 'entries'}`}
        </button>
      )}

      {/* Entries */}
      {view === 'list' ? (
        <EntryColumn
          entries={sortEntries(listVisible(filtered))}
          nameOf={nameOf}
          showPerson={person === 'all'}
          groupByDay={sortBy === 'date'}
          onSelect={(e) => {
            setEditing(e)
            setFormOpen(true)
          }}
          onDelete={removeEntry}
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {profiles.map((p) => (
            <div key={p.email}>
              <h3 className="mb-2 text-center text-sm font-bold text-(--text-muted)">
                {p.display_name}
              </h3>
              <EntryColumn
                entries={sortEntries(
                  listVisible(entries.filter((e) => e.person_email === p.email)),
                )}
                nameOf={nameOf}
                showPerson={false}
                groupByDay={sortBy === 'date'}
                compact
                onSelect={(e) => {
                  setEditing(e)
                  setFormOpen(true)
                }}
                onDelete={removeEntry}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add + scan buttons */}
      <div
        className="fixed inset-x-0 pin-bottom mx-auto flex max-w-md gap-3 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
          aria-label="Scan a receipt"
          className="rounded-2xl border border-white/30 bg-(--surface) px-5 text-2xl shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          📷
        </button>
        <button
          onClick={() => {
            setEditing(null)
            setPrefill(undefined)
            setFormOpen(true)
          }}
          className="flex-1 rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
        >
          ＋ New Entry
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) scanReceipt(file)
        }}
      />

      {scanning && (
        <div className="fixed inset-x-0 top-0 z-50 h-screen-real flex items-center justify-center bg-black/60">
          <div className="rounded-2xl bg-(--card) px-6 py-5 text-center">
            <div className="text-3xl">🧾</div>
            <p className="mt-2 animate-pulse font-semibold text-(--text)">
              Reading receipt…
            </p>
          </div>
        </div>
      )}

      {formOpen && profile && (
        <EntryForm
          monthId={month.id}
          periodStart={month.start_date}
          periodEnd={periodEndISO(month.budgets?.period ?? 'monthly', month.start_date)}
          profiles={profiles}
          myEmail={profile.email}
          rules={rules}
          entry={editing}
          initial={prefill}
          onClose={() => {
            setFormOpen(false)
            setPrefill(undefined)
          }}
          onSaved={() => {
            setFormOpen(false)
            setPrefill(undefined)
            load()
          }}
        />
      )}
    </div>
  )
}

function EntryColumn({
  entries,
  nameOf,
  showPerson,
  groupByDay = false,
  compact = false,
  onSelect,
  onDelete,
}: {
  entries: Entry[]
  nameOf: (email: string) => string
  showPerson: boolean
  groupByDay?: boolean
  compact?: boolean
  onSelect: (e: Entry) => void
  onDelete: (e: Entry) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-(--text-faint)">No entries yet.</p>
    )
  }

  if (groupByDay) {
    // Preserve the incoming sort order; just insert a heading whenever the day changes.
    const groups: { date: string; items: Entry[] }[] = []
    for (const e of entries) {
      const last = groups[groups.length - 1]
      if (last && last.date === e.entry_date) last.items.push(e)
      else groups.push({ date: e.entry_date, items: [e] })
    }
    return (
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <section key={g.date}>
            <h4
              className={`mb-1.5 font-semibold uppercase tracking-wide text-(--text-faint) ${
                compact ? 'text-[9px]' : 'text-[11px]'
              }`}
            >
              {formatDayHeading(g.date)}
            </h4>
            <ul className="space-y-2">
              {g.items.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  nameOf={nameOf}
                  showPerson={showPerson}
                  showDate={false}
                  compact={compact}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  return (
    <ul className="mt-3 space-y-2">
      {entries.map((e) => (
        <EntryRow
          key={e.id}
          entry={e}
          nameOf={nameOf}
          showPerson={showPerson}
          showDate
          compact={compact}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </ul>
  )
}

function EntryRow({
  entry: e,
  nameOf,
  showPerson,
  showDate,
  compact,
  onSelect,
  onDelete,
}: {
  entry: Entry
  nameOf: (email: string) => string
  showPerson: boolean
  showDate: boolean
  compact: boolean
  onSelect: (e: Entry) => void
  onDelete: (e: Entry) => void
}) {
  const REVEAL = compact ? 64 : 84
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const touchStart = useRef<{ x: number; y: number; base: number } | null>(null)

  const cancel = () => {
    setConfirming(false)
    setDx(0)
  }

  const cat = categoryById(e.category)
  const isIncome = e.type === 'income'
  const secondary = [
    showDate ? formatDay(e.entry_date) : null,
    showPerson ? nameOf(e.person_email) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="relative overflow-hidden rounded-xl">
      <button
        onClick={() => {
          if (confirming) cancel()
          else onSelect(e)
        }}
        onTouchStart={(t) => {
          if (confirming) return
          const p = t.touches[0]
          touchStart.current = { x: p.clientX, y: p.clientY, base: dx }
          setDragging(true)
        }}
        onTouchMove={(t) => {
          const s = touchStart.current
          if (!s) return
          const p = t.touches[0]
          const moveX = p.clientX - s.x
          if (Math.abs(moveX) < Math.abs(p.clientY - s.y)) return
          setDx(Math.min(0, Math.max(-REVEAL, s.base + moveX)))
        }}
        onTouchEnd={() => {
          setDragging(false)
          touchStart.current = null
          setDx((d) => {
            if (d < -REVEAL / 2) {
              setConfirming(true)
              return -REVEAL
            }
            return 0
          })
        }}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
          touchAction: 'pan-y',
        }}
        className={`relative flex w-full items-center gap-2 rounded-xl bg-(--card) text-left active:bg-(--card-active) ${
          compact ? 'px-2.5 py-2' : 'px-4 py-3'
        }`}
      >
        <span className={compact ? 'text-base' : 'text-xl'}>
          {isIncome ? '💵' : cat.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`truncate font-medium text-(--text) ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            {e.label}
            {e.recurring && <span className="ml-1 text-(--text-faint)">↻</span>}
          </div>
          {secondary && (
            <div className="text-[10px] text-(--text-faint)">{secondary}</div>
          )}
        </div>
        <span
          className={`tabular-nums font-semibold ${
            compact ? 'text-xs' : 'text-sm'
          } ${isIncome ? 'text-(--income)' : 'text-(--text-muted)'}`}
        >
          {isIncome ? '+' : '−'}
          {formatMoney(Number(e.amount))}
        </span>
      </button>

      {/* red delete layer: tracks the swipe, then fills the row to confirm */}
      <div
        onClick={cancel}
        className="absolute inset-y-0 right-0 flex items-center overflow-hidden rounded-xl bg-(--expense)"
        style={{
          width: confirming ? '100%' : Math.max(0, -dx),
          transition: dragging ? 'none' : 'width 0.25s ease',
          pointerEvents: confirming ? 'auto' : 'none',
        }}
      >
        {confirming ? (
          <div className="flex w-full items-center justify-between gap-2 px-3 whitespace-nowrap">
            <span className={`font-semibold text-white ${compact ? 'text-[11px]' : 'text-sm'}`}>
              {compact ? 'Delete?' : 'Confirm delete entry?'}
            </span>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                onDelete(e)
              }}
              className={`rounded-lg bg-white/25 font-bold text-white active:bg-white/40 ${
                compact ? 'px-2 py-1 text-[11px]' : 'px-4 py-1.5 text-sm'
              }`}
            >
              YES
            </button>
          </div>
        ) : (
          <span
            className={`mx-auto font-bold text-white ${compact ? 'text-[11px]' : 'text-xs'}`}
          >
            Delete
          </span>
        )}
      </div>
    </li>
  )
}
