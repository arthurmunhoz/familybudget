import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useBack } from '../hooks/useBack'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { formatDuration, timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Household, Profile } from '../lib/types'

interface AppStat {
  label: string
  views: number
  seconds: number
}

const APP_LABELS: Record<string, string> = {
  '': '🏠 Hub',
  budget: '💰 Budget',
  month: '💰 Budget',
  shopping: '🛒 Shopping List',
  pets: '🐕 Pet Care',
  docs: '📄 Documents',
  admin: '🛠️ Admin',
}

const PERIODS = [7, 30, 90]

type Tab = 'analytics' | 'households'
type SortKey = 'name' | 'created' | 'active'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'A–Z' },
  { key: 'created', label: 'Newest' },
  { key: 'active', label: 'Last active' },
]

/** Admin-only: usage analytics plus household/member management. */
export default function Admin() {
  const back = useBack()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('analytics')

  // analytics period + households tab controls
  const [days, setDays] = useState(30)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [newHousehold, setNewHousehold] = useState('')
  const [busy, setBusy] = useState(false)

  type BaseData = {
    households: Household[]
    users: Profile[]
    hhLastSeen: Record<string, string>
  }
  // Cached: households + members render instantly on return; revalidate after edits.
  const {
    data: base = { households: [], users: [], hhLastSeen: {} },
    loading,
    revalidate: revalidateBase,
  } = useCachedQuery<BaseData>('admin:base', async () => {
    const [h, u, hh] = await Promise.all([
      supabase.from('households').select('*').order('created_at'),
      supabase.from('allowed_users').select('email, display_name, household_id, is_admin'),
      supabase.rpc('admin_household_activity'),
    ])
    return {
      households: h.data ?? [],
      users: u.data ?? [],
      hhLastSeen: Object.fromEntries(
        ((hh.data ?? []) as { household_id: string; last_seen: string }[]).map((r) => [
          r.household_id,
          r.last_seen,
        ]),
      ),
    }
  })
  const { households, users, hhLastSeen } = base

  type ErrorRow = {
    id: number
    user_email: string
    target: string | null
    path: string | null
    created_at: string
  }
  type AnalyticsData = { stats: AppStat[]; errors: ErrorRow[] }
  // Cached per period (key includes `days`) so switching back to a period is instant.
  const { data: analytics = { stats: [], errors: [] } } = useCachedQuery<AnalyticsData>(
    `admin:analytics:${days}`,
    async () => {
      const [use, time, errs] = await Promise.all([
        supabase.rpc('admin_app_usage', { days }),
        supabase.rpc('admin_app_time', { days }),
        supabase
          .from('web_events')
          .select('id, user_email, target, path, created_at')
          .eq('type', 'error')
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      // 'month' pages are budget-period details — fold them into Budget.
      const merged = new Map<string, AppStat>()
      for (const row of (use.data ?? []) as { root: string; views: number }[]) {
        const label = APP_LABELS[row.root] ?? row.root
        const s = merged.get(label) ?? { label, views: 0, seconds: 0 }
        s.views += Number(row.views)
        merged.set(label, s)
      }
      for (const row of (time.data ?? []) as { root: string; seconds: number }[]) {
        const label = APP_LABELS[row.root] ?? row.root
        const s = merged.get(label) ?? { label, views: 0, seconds: 0 }
        s.seconds += Number(row.seconds)
        merged.set(label, s)
      }
      return {
        stats: [...merged.values()].sort((a, b) => b.views - a.views),
        errors: (errs.data ?? []) as ErrorRow[],
      }
    },
  )
  const { stats, errors } = analytics

  const visibleHouseholds = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = households
    if (q) {
      list = list.filter(
        (h) =>
          h.name.toLowerCase().includes(q) ||
          users.some(
            (u) =>
              u.household_id === h.id &&
              (u.display_name.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q)),
          ),
      )
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'created') return b.created_at.localeCompare(a.created_at)
      return (hhLastSeen[b.id] ?? '').localeCompare(hhLastSeen[a.id] ?? '')
    })
  }, [households, users, search, sortKey, hhLastSeen])

  const profileName = (email: string) =>
    users.find((u) => u.email === email)?.display_name ?? email

  if (!profile?.is_admin) return <Navigate to="/" replace />

  async function createHousehold() {
    const name = newHousehold.trim()
    if (!name || busy) return
    setBusy(true)
    const { error } = await supabase.from('households').insert({ name })
    setBusy(false)
    if (error) {
      alert('Could not create the household — please try again.')
      return
    }
    setNewHousehold('')
    revalidateBase()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🛠️ Admin</h1>
      </header>

      {/* section tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-(--surface) p-1">
        {(
          [
            { key: 'analytics', label: '📊 Analytics' },
            { key: 'households', label: '🏠 Households' },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-(--accent) text-white' : 'text-(--text-muted)'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : tab === 'analytics' ? (
        <div className="space-y-4">
          {/* period selector */}
          <div className="flex gap-2">
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  days === p
                    ? 'bg-(--accent) text-white'
                    : 'bg-(--surface) text-(--text-muted)'
                }`}
              >
                {p} days
              </button>
            ))}
          </div>

          <section className="rounded-2xl bg-(--card) p-4">
            <h2 className="font-bold text-(--text)">📊 App usage</h2>
            {stats.length === 0 ? (
              <p className="mt-3 text-sm text-(--text-faint)">
                No activity in this period yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {stats.map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="text-(--text)">{s.label}</span>
                    <span className="font-semibold text-(--text-muted)">
                      {s.views} {s.views === 1 ? 'view' : 'views'} ·{' '}
                      {formatDuration(s.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-(--text-faint)">
              Admin accounts are excluded. Time is estimated from activity gaps
              (idle capped at 5 min).
            </p>
          </section>

          <section className="rounded-2xl bg-(--card) p-4">
            <h2 className="font-bold text-(--text)">🐞 Recent errors</h2>
            {errors.length === 0 ? (
              <p className="mt-3 text-sm text-(--text-faint)">
                No errors reported. 🎉
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {errors.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="break-words font-medium text-(--expense)">
                      {e.target ?? 'Unknown error'}
                    </p>
                    <p className="text-xs text-(--text-faint)">
                      {e.path ?? '?'} · {profileName(e.user_email)} ·{' '}
                      {timeAgo(e.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          {/* create — bordered so it reads as an action card, not a list item */}
          <section className="rounded-2xl border border-(--accent-soft) bg-(--card) p-4">
            <h2 className="text-sm font-semibold text-(--text-muted)">
              ➕ New household
            </h2>
            <div className="mt-2 flex gap-2">
              <input
                value={newHousehold}
                onChange={(e) => setNewHousehold(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createHousehold()
                }}
                placeholder="Family name…"
                className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-2.5 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <button
                onClick={createHousehold}
                disabled={!newHousehold.trim() || busy}
                className="rounded-xl bg-(--accent) px-4 font-bold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </section>

          {/* search + sort */}
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search households or members…"
              className="w-full rounded-xl bg-(--card) px-4 py-3 pr-11 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-(--text-faint) active:text-(--text)"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSortKey(s.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  sortKey === s.key
                    ? 'bg-(--accent) text-white'
                    : 'bg-(--surface) text-(--text-muted)'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {visibleHouseholds.length === 0 && (
            <p className="mt-8 text-center text-sm text-(--text-faint)">
              No households match “{search}”.
            </p>
          )}

          <ul className="space-y-2">
            {visibleHouseholds.map((h) => {
              const memberCount = users.filter((u) => u.household_id === h.id).length
              return (
                <li key={h.id}>
                  <button
                    onClick={() => navigate(`/admin/household/${h.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3 text-left active:bg-(--card-active) transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-bold text-(--text)">🏠 {h.name}</h2>
                      <p className="text-xs text-(--text-faint)">
                        {memberCount} {memberCount === 1 ? 'member' : 'members'} ·{' '}
                        {hhLastSeen[h.id]
                          ? `active ${timeAgo(hhLastSeen[h.id])}`
                          : 'no activity yet'}
                      </p>
                    </div>
                    <span className="shrink-0 text-(--text-faint)">›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
