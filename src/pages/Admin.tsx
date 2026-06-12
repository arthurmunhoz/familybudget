import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useBack } from '../hooks/useBack'
import { formatDuration, timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Household, Profile } from '../lib/types'

interface UserActivity {
  user_email: string
  last_seen: string
  events: number
}

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
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('analytics')

  // base data
  const [households, setHouseholds] = useState<Household[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [hhLastSeen, setHhLastSeen] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  // analytics (reload when the period changes)
  const [days, setDays] = useState(30)
  const [activity, setActivity] = useState<Record<string, UserActivity>>({})
  const [stats, setStats] = useState<AppStat[]>([])

  // households tab controls
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')

  const [newHousehold, setNewHousehold] = useState('')
  // per-household "add member" drafts, keyed by household id
  const [drafts, setDrafts] = useState<Record<string, { name: string; email: string }>>({})
  const [busy, setBusy] = useState(false)

  const loadBase = useCallback(async () => {
    const [h, u, hh] = await Promise.all([
      supabase.from('households').select('*').order('created_at'),
      supabase.from('allowed_users').select('email, display_name, household_id, is_admin'),
      supabase.rpc('admin_household_activity'),
    ])
    setHouseholds(h.data ?? [])
    setUsers(u.data ?? [])
    setHhLastSeen(
      Object.fromEntries(
        ((hh.data ?? []) as { household_id: string; last_seen: string }[]).map((r) => [
          r.household_id,
          r.last_seen,
        ]),
      ),
    )
    setLoading(false)
  }, [])

  const loadAnalytics = useCallback(async (d: number) => {
    const [act, use, time] = await Promise.all([
      supabase.rpc('admin_user_activity', { days: d }),
      supabase.rpc('admin_app_usage', { days: d }),
      supabase.rpc('admin_app_time', { days: d }),
    ])
    setActivity(
      Object.fromEntries(
        ((act.data ?? []) as UserActivity[]).map((a) => [a.user_email, a]),
      ),
    )
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
    setStats([...merged.values()].sort((a, b) => b.views - a.views))
  }, [])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    loadAnalytics(days)
  }, [loadAnalytics, days])

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

  if (!profile?.is_admin) return <Navigate to="/" replace />

  function draft(id: string) {
    return drafts[id] ?? { name: '', email: '' }
  }

  function setDraft(id: string, d: { name: string; email: string }) {
    setDrafts((all) => ({ ...all, [id]: d }))
  }

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
    loadBase()
  }

  async function addMember(householdId: string) {
    const d = draft(householdId)
    const email = d.email.trim().toLowerCase()
    const name = d.name.trim()
    if (!email || !name || busy) return
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      alert('That doesn’t look like a valid email.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('allowed_users').insert({
      email,
      display_name: name,
      household_id: householdId,
    })
    setBusy(false)
    if (error) {
      alert(
        error.code === '23505'
          ? 'That email is already a member of a household.'
          : 'Could not add the member — please try again.',
      )
      return
    }
    setDraft(householdId, { name: '', email: '' })
    loadBase()
  }

  async function removeMember(user: Profile) {
    if (user.email === profile?.email) {
      alert('You can’t remove yourself.')
      return
    }
    if (!confirm(`Remove ${user.display_name} (${user.email})? They will lose access.`))
      return
    const { error } = await supabase
      .from('allowed_users')
      .delete()
      .eq('email', user.email)
    if (error) {
      alert(
        'Could not remove this member — they still have budget entries or other data attached.',
      )
      return
    }
    loadBase()
  }

  async function removeHousehold(h: Household) {
    const members = users.filter((u) => u.household_id === h.id)
    if (members.length > 0) {
      alert('Remove all members first.')
      return
    }
    if (!confirm(`Delete household "${h.name}"?`)) return
    const { error } = await supabase.from('households').delete().eq('id', h.id)
    if (error) {
      alert('Could not delete — the household still has data attached.')
      return
    }
    loadBase()
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-32">
      <header className="flex items-center gap-2 pt-6 pb-4">
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
        </div>
      ) : (
        <div className="space-y-4">
          {/* search + sort */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search households or members…"
            className="w-full rounded-xl bg-(--card) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
          />
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

          {visibleHouseholds.map((h) => {
            const members = users.filter((u) => u.household_id === h.id)
            const d = draft(h.id)
            return (
              <section key={h.id} className="rounded-2xl bg-(--card) p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <h2 className="truncate font-bold text-(--text)">🏠 {h.name}</h2>
                    <p className="text-xs text-(--text-faint)">
                      {hhLastSeen[h.id]
                        ? `Last active ${timeAgo(hhLastSeen[h.id])}`
                        : 'No activity yet'}
                    </p>
                  </div>
                  {members.length === 0 && (
                    <button
                      onClick={() => removeHousehold(h)}
                      className="px-1 text-(--text-faint) active:text-(--expense)"
                      aria-label={`Delete ${h.name}`}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <ul className="mt-3 space-y-2">
                  {members.map((u) => (
                    <li
                      key={u.email}
                      className="flex items-center gap-3 rounded-xl bg-(--surface) px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-(--text)">
                          {u.display_name}
                          {u.is_admin && (
                            <span className="ml-2 rounded-full bg-(--accent-soft) px-2 py-0.5 text-[10px] font-bold text-(--accent)">
                              ADMIN
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-(--text-faint)">{u.email}</p>
                        <p className="text-xs text-(--text-faint)">
                          {activity[u.email]
                            ? `Active ${timeAgo(activity[u.email].last_seen)} · ${activity[u.email].events} events / ${days}d`
                            : 'Never accessed'}
                        </p>
                      </div>
                      {!u.is_admin && (
                        <button
                          onClick={() => removeMember(u)}
                          aria-label={`Remove ${u.display_name}`}
                          className="px-1 text-(--text-faint) active:text-(--expense)"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex gap-2">
                  <input
                    value={d.name}
                    onChange={(e) => setDraft(h.id, { ...d, name: e.target.value })}
                    placeholder="Name"
                    className="w-24 min-w-0 rounded-xl bg-(--surface) px-3 py-2.5 text-sm text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                  />
                  <input
                    value={d.email}
                    onChange={(e) => setDraft(h.id, { ...d, email: e.target.value })}
                    placeholder="Google email"
                    type="email"
                    autoCapitalize="none"
                    className="min-w-0 flex-1 rounded-xl bg-(--surface) px-3 py-2.5 text-sm text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                  />
                  <button
                    onClick={() => addMember(h.id)}
                    disabled={!d.name.trim() || !d.email.trim() || busy}
                    className="rounded-xl bg-(--accent) px-3.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </section>
            )
          })}

          <div className="flex gap-2">
            <input
              value={newHousehold}
              onChange={(e) => setNewHousehold(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createHousehold()
              }}
              placeholder="New household name…"
              className="min-w-0 flex-1 rounded-2xl bg-(--card) px-4 py-3.5 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <button
              onClick={createHousehold}
              disabled={!newHousehold.trim() || busy}
              className="rounded-2xl bg-(--accent) px-5 font-bold text-white disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
