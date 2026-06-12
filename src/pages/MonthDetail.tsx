import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EntryForm from '../components/EntryForm'
import SummaryChart from '../components/SummaryChart'
import { useAuth } from '../hooks/useAuth'
import { categoryById } from '../lib/categories'
import { formatDay, formatMoney, monthName } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { CategoryRule, Entry, Month, Profile } from '../lib/types'

type SortBy = 'date' | 'amount'
type View = 'list' | 'split'

export default function MonthDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile, profiles } = useAuth()

  const [month, setMonth] = useState<Month | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [loading, setLoading] = useState(true)

  const [person, setPerson] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [view, setView] = useState<View>('list')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [m, e, r] = await Promise.all([
      supabase.from('months').select('*').eq('id', id).single(),
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

  const sortEntries = useCallback(
    (list: Entry[]) =>
      [...list].sort((a, b) =>
        sortBy === 'date'
          ? a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at)
          : Number(b.amount) - Number(a.amount),
      ),
    [sortBy],
  )

  const nameOf = (email: string) =>
    profiles.find((p) => p.email === email)?.display_name ?? email

  if (loading || !month) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="animate-pulse text-stone-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="flex items-center gap-3 pt-6 pb-4">
        <button
          onClick={() => navigate('/')}
          className="rounded-lg px-2 py-1 text-xl text-stone-400 active:text-stone-200"
        >
          ‹
        </button>
        <h1 className="text-xl font-bold text-stone-100">
          {monthName(month.year, month.month)}
        </h1>
      </header>

      {/* Person filter — charts and lists below react to it */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-stone-800 p-1">
        {[
          { key: 'all', label: 'Both' },
          ...profiles.map((p: Profile) => ({ key: p.email, label: p.display_name })),
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setPerson(opt.key)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              person === opt.key ? 'bg-amber-400 text-stone-900' : 'text-stone-400'
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
        <div className="flex gap-1 rounded-lg bg-stone-800 p-1 text-xs font-semibold">
          {(['date', 'amount'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`rounded-md px-3 py-1.5 capitalize ${
                sortBy === s ? 'bg-stone-700 text-stone-100' : 'text-stone-500'
              }`}
            >
              By {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-stone-800 p-1 text-xs font-semibold">
          {(['list', 'split'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 capitalize ${
                view === v ? 'bg-stone-700 text-stone-100' : 'text-stone-500'
              }`}
            >
              {v === 'list' ? '☰ List' : '◫ Split'}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      {view === 'list' ? (
        <EntryColumn
          entries={sortEntries(filtered)}
          nameOf={nameOf}
          showPerson={person === 'all'}
          onSelect={(e) => {
            setEditing(e)
            setFormOpen(true)
          }}
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {profiles.map((p) => (
            <div key={p.email}>
              <h3 className="mb-2 text-center text-sm font-bold text-stone-300">
                {p.display_name}
              </h3>
              <EntryColumn
                entries={sortEntries(entries.filter((e) => e.person_email === p.email))}
                nameOf={nameOf}
                showPerson={false}
                compact
                onSelect={(e) => {
                  setEditing(e)
                  setFormOpen(true)
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
          className="w-full rounded-2xl bg-amber-400 py-4 text-lg font-bold text-stone-900 active:scale-[0.98] transition-transform"
        >
          ＋ Add entry
        </button>
      </div>

      {formOpen && profile && (
        <EntryForm
          month={month}
          profiles={profiles}
          myEmail={profile.email}
          rules={rules}
          entry={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false)
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
  compact = false,
  onSelect,
}: {
  entries: Entry[]
  nameOf: (email: string) => string
  showPerson: boolean
  compact?: boolean
  onSelect: (e: Entry) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-stone-600">No entries yet.</p>
    )
  }
  return (
    <ul className="mt-3 space-y-2">
      {entries.map((e) => {
        const cat = categoryById(e.category)
        const isIncome = e.type === 'income'
        return (
          <li key={e.id}>
            <button
              onClick={() => onSelect(e)}
              className={`flex w-full items-center gap-2 rounded-xl bg-stone-900 text-left active:bg-stone-800 transition-colors ${
                compact ? 'px-2.5 py-2' : 'px-4 py-3'
              }`}
            >
              <span className={compact ? 'text-base' : 'text-xl'}>
                {isIncome ? '💵' : cat.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate font-medium text-stone-100 ${
                    compact ? 'text-xs' : 'text-sm'
                  }`}
                >
                  {e.label}
                  {e.recurring && <span className="ml-1 text-stone-500">↻</span>}
                </div>
                <div className="text-[10px] text-stone-500">
                  {formatDay(e.entry_date)}
                  {showPerson && ` · ${nameOf(e.person_email)}`}
                </div>
              </div>
              <span
                className={`tabular-nums font-semibold ${
                  compact ? 'text-xs' : 'text-sm'
                } ${isIncome ? 'text-emerald-400' : 'text-stone-300'}`}
              >
                {isIncome ? '+' : '−'}
                {formatMoney(Number(e.amount))}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
