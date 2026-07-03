import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Camera, Check, Receipt } from 'lucide-react'
import EntryForm, { type EntryPrefill } from './EntryForm'
import { fileToResizedBase64 } from '../../lib/image'
import SummaryChart from './SummaryChart'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useCachedQuery } from '../../hooks/useCachedQuery'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useI18n } from '../../hooks/useI18n'
import { categoryById } from '../../lib/categories'
import {
  formatDay,
  formatDayHeading,
  formatMoney,
  periodEndISO,
  periodTitle,
  todayISO,
} from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type {
  CategoryRule,
  CustomCategory,
  Entry,
  Month,
  Period,
  Profile,
} from '../../lib/types'

type MonthWithBudget = Month & {
  budgets: { name: string; period: Period } | null
}

type SortBy = 'date' | 'amount'
type SortDir = 'asc' | 'desc'

export default function MonthDetail() {
  const { id } = useParams<{ id: string }>()
  const back = useBack()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()

  const [person, setPerson] = useState<string>('all')
  const [personMenuOpen, setPersonMenuOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [dateDir, setDateDir] = useState<SortDir>('desc')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [prefill, setPrefill] = useState<EntryPrefill | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [showScanTip, setShowScanTip] = useState(false)
  const [showFuture, setShowFuture] = useState(false)
  // Optimistic-delete overlay: ids hidden immediately on swipe-delete, before
  // the cached query revalidates.
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  // EntryForm self-locks; this covers the receipt-scan overlay.
  useScrollLock(scanning)
  const fileInputRef = useRef<HTMLInputElement>(null)

  type DetailData = {
    month: MonthWithBudget | null
    entries: Entry[]
    rules: CategoryRule[]
    subcatSuggestions: Record<string, string[]>
    customCats: CustomCategory[]
    topCategories: string[]
  }
  const EMPTY: DetailData = {
    month: null,
    entries: [],
    rules: [],
    subcatSuggestions: {},
    customCats: [],
    topCategories: [],
  }
  // Cached per period: detail renders instantly on return, revalidates quietly.
  const {
    data = EMPTY,
    loading,
    revalidate,
  } = useCachedQuery<DetailData>(`monthDetail:${id ?? ''}`, async () => {
    if (!id) return EMPTY
    const [m, e, r, subs, custom] = await Promise.all([
      supabase.from('months').select('*, budgets(name, period)').eq('id', id).single(),
      supabase.from('entries').select('*').eq('month_id', id),
      supabase.from('category_rules').select('keyword, category'),
      // Household-wide usage (RLS scopes this to the family): feeds both the
      // subcategory autocomplete and the entry form's most-used category chips.
      supabase.from('entries').select('type, category, subcategory'),
      supabase.from('custom_categories').select('*').order('created_at'),
    ])
    const counts = new Map<string, Map<string, number>>()
    const catCounts = new Map<string, number>()
    for (const row of (subs.data ?? []) as {
      type: string
      category: string
      subcategory: string | null
    }[]) {
      if (row.type === 'expense' && row.category !== 'salary') {
        catCounts.set(row.category, (catCounts.get(row.category) ?? 0) + 1)
      }
      const key = row.subcategory?.trim()
      if (!key) continue
      if (!counts.has(row.category)) counts.set(row.category, new Map())
      const bucket = counts.get(row.category)!
      // dedupe case-insensitively, keeping the first-seen casing
      const existing = [...bucket.keys()].find((k) => k.toLowerCase() === key.toLowerCase())
      const useKey = existing ?? key
      bucket.set(useKey, (bucket.get(useKey) ?? 0) + 1)
    }
    const map: Record<string, string[]> = {}
    for (const [cat, bucket] of counts) {
      map[cat] = [...bucket.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
    }
    return {
      month: m.data,
      entries: e.data ?? [],
      rules: r.data ?? [],
      subcatSuggestions: map,
      customCats: custom.data ?? [],
      topCategories: [...catCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    }
  })

  // ?add=1 (the home card's "＋ New entry") opens the form on arrival, then
  // clears the param so back/refresh doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (loading || !data.month) return
    if (searchParams.get('add') === '1') {
      setEditing(null)
      setPrefill(undefined)
      setFormOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [loading, data.month, searchParams, setSearchParams])

  const month = data.month
  const rules = data.rules
  const subcatSuggestions = data.subcatSuggestions
  const filtered = useMemo(() => {
    const live = data.entries.filter((e) => !removed.has(e.id))
    return person === 'all' ? live : live.filter((e) => e.person_email === person)
  }, [data.entries, removed, person])

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
    setRemoved((prev) => new Set(prev).add(e.id)) // optimistic hide
    const { error } = await supabase.from('entries').delete().eq('id', e.id)
    if (error) {
      alert(t('detail.deleteFailed'))
      setRemoved((prev) => {
        const next = new Set(prev)
        next.delete(e.id) // roll back the hide
        return next
      })
    } else {
      revalidate()
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
      if (!res.ok) throw new Error(result.error ?? t('detail.scanFailed'))
      setEditing(null)
      setPrefill({
        label: result.label,
        amount: result.amount,
        category: result.category,
        subcategory: result.subcategory,
        entry_date: result.date,
      })
      setFormOpen(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : t('detail.scanFailed'))
    } finally {
      setScanning(false)
    }
  }

  if (loading || !month) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="animate-pulse text-(--text-faint)">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-3 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back(`/budget/${month.budget_id}`)}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-(--text) font-display">
          {periodTitle(month.budgets?.period ?? 'monthly', month.start_date)}
        </h1>

        {/* Person filter chip — charts and lists react to it */}
        <div className="relative shrink-0">
          <button
            onClick={() => setPersonMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-full border border-(--surface-2) bg-(--surface) px-3.5 py-1.5 text-sm font-semibold text-(--text)"
          >
            {person === 'all' ? t('common.everyone') : nameOf(person)}
            <span className="text-[9px] text-(--text-faint)">▼</span>
          </button>
          {personMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPersonMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-xl border border-(--surface) bg-(--card) shadow-xl">
                {[
                  { key: 'all', label: t('common.everyone') },
                  ...profiles.map((p: Profile) => ({
                    key: p.email,
                    label: p.display_name,
                  })),
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setPerson(opt.key)
                      setPersonMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium active:bg-(--surface) ${
                      person === opt.key ? 'text-(--accent)' : 'text-(--text)'
                    }`}
                  >
                    {opt.label}
                    {person === opt.key && (
                      <Check size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="mt-1">
        <SummaryChart entries={filtered} customCats={data.customCats} />
      </div>

      {/* Sort controls */}
      <div className="mt-5 flex items-center justify-end">
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
            {t('detail.byDate')} {dateDir === 'asc' ? '↑' : '↓'}
          </button>
          <button
            onClick={() => setSortBy('amount')}
            className={`rounded-md px-3 py-1.5 ${
              sortBy === 'amount' ? 'bg-(--surface-2) text-(--text)' : 'text-(--text-faint)'
            }`}
          >
            {t('detail.byAmount')}
          </button>
        </div>
      </div>

      {/* Future entries are collapsed behind a subtle toggle */}
      {futureCount > 0 && (
        <button
          onClick={() => setShowFuture((s) => !s)}
          className="mx-auto mt-3 block text-xs font-medium text-(--text-faint) underline decoration-dotted underline-offset-4 active:text-(--text-muted)"
        >
          {showFuture
            ? t('detail.hideFuture')
            : t('detail.showFuture', { count: futureCount })}
        </button>
      )}

      {/* Entries */}
      <EntryColumn
        entries={sortEntries(listVisible(filtered))}
        nameOf={nameOf}
        customCats={data.customCats}
        showPerson={person === 'all'}
        groupByDay={sortBy === 'date'}
        onSelect={(e) => {
          setEditing(e)
          setFormOpen(true)
        }}
        onDelete={removeEntry}
      />

      {/* Add + scan buttons */}
      <div
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md gap-3 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <button
          onClick={() => setShowScanTip(true)}
          disabled={scanning}
          aria-label={t('detail.scanAria')}
          className="flex items-center justify-center rounded-2xl border border-white/30 bg-(--surface) px-5 shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          <Camera size={24} strokeWidth={2} aria-hidden="true" className="text-(--text)" />
        </button>
        <button
          onClick={() => {
            setEditing(null)
            setPrefill(undefined)
            setFormOpen(true)
          }}
          className="flex-1 rounded-2xl border border-white/30 bg-(--accent) py-4 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
        >
          {t('detail.newEntry')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-2xl bg-(--card) px-6 py-5 text-center">
            <Receipt size={32} strokeWidth={2} aria-hidden="true" className="mx-auto text-(--accent)" />
            <p className="mt-2 animate-pulse font-semibold text-(--text)">
              {t('detail.readingReceipt')}
            </p>
          </div>
        </div>
      )}

      {/* Quick guidance before the native camera opens — a clear shot of the
          store name + total is what the scanner needs to read the receipt. */}
      {showScanTip && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50"
          onClick={() => setShowScanTip(false)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-3xl bg-(--card) p-6"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="flex items-center gap-2 text-lg font-bold text-(--text)">
              <Camera size={22} strokeWidth={2} aria-hidden="true" className="text-(--accent)" />
              {t('detail.scanTipTitle')}
            </h2>
            <p className="mt-2 text-sm text-(--text-muted)">{t('detail.scanTipBody')}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-(--text)">
              {[t('detail.scanTipStore'), t('detail.scanTipTotal'), t('detail.scanTipClear')].map(
                (line) => (
                  <li key={line} className="flex items-center gap-2">
                    <Check size={16} strokeWidth={2.5} aria-hidden="true" className="shrink-0 text-(--accent)" />
                    {line}
                  </li>
                ),
              )}
            </ul>
            <button
              onClick={() => {
                setShowScanTip(false)
                // Synchronous within this tap so iOS allows the native camera.
                fileInputRef.current?.click()
              }}
              className="mt-5 w-full rounded-2xl bg-(--accent) py-3.5 font-bold text-white active:scale-[0.98] transition-transform"
            >
              {t('detail.scanTipOpen')}
            </button>
            <button
              onClick={() => setShowScanTip(false)}
              className="mt-2 w-full py-2 text-sm font-medium text-(--text-muted)"
            >
              {t('common.cancel')}
            </button>
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
          subcategorySuggestions={subcatSuggestions}
          customCategories={data.customCats}
          topCategories={data.topCategories}
          onCategoryCreated={revalidate}
          entry={editing}
          initial={prefill}
          onClose={() => {
            setFormOpen(false)
            setPrefill(undefined)
          }}
          onSaved={() => {
            setFormOpen(false)
            setPrefill(undefined)
            revalidate()
          }}
        />
      )}
    </div>
  )
}

function EntryColumn({
  entries,
  nameOf,
  customCats,
  showPerson,
  groupByDay = false,
  compact = false,
  onSelect,
  onDelete,
}: {
  entries: Entry[]
  nameOf: (email: string) => string
  customCats: CustomCategory[]
  showPerson: boolean
  groupByDay?: boolean
  compact?: boolean
  onSelect: (e: Entry) => void
  onDelete: (e: Entry) => void
}) {
  const { t } = useI18n()
  if (entries.length === 0) {
    return (
      <p className="mt-6 text-center text-sm text-(--text-faint)">{t('detail.noEntries')}</p>
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
                  customCats={customCats}
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
          customCats={customCats}
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
  customCats,
  showPerson,
  showDate,
  compact,
  onSelect,
  onDelete,
}: {
  entry: Entry
  nameOf: (email: string) => string
  customCats: CustomCategory[]
  showPerson: boolean
  showDate: boolean
  compact: boolean
  onSelect: (e: Entry) => void
  onDelete: (e: Entry) => void
}) {
  const { t } = useI18n()
  const REVEAL = compact ? 64 : 84
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const touchStart = useRef<{ x: number; y: number; base: number } | null>(null)

  const cancel = () => {
    setConfirming(false)
    setDx(0)
  }

  const cat = categoryById(e.category, customCats)
  const isIncome = e.type === 'income'
  const secondary = [
    e.subcategory,
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
              {compact ? t('detail.confirmDeleteShort') : t('detail.confirmDelete')}
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
              {t('detail.yes')}
            </button>
          </div>
        ) : (
          <span
            className={`mx-auto font-bold text-white ${compact ? 'text-[11px]' : 'text-xs'}`}
          >
            {t('common.delete')}
          </span>
        )}
      </div>
    </li>
  )
}
