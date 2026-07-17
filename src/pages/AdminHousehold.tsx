import { useCallback, useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Activity, Bug, Home, LogIn, Trash2, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useBack } from '../hooks/useBack'
import { appForPath } from '../lib/appRoutes'
import { formatDay, timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Household, Profile } from '../lib/types'

/** Mirrors the database trigger (migration 016) — keep the two in sync. */
const MAX_MEMBERS = 6

interface UserActivity {
  user_email: string
  last_seen: string
  events: number
}

/** Raw row from admin_household_events (migration 059). */
interface EventRow {
  id: number
  user_email: string
  type: string
  path: string | null
  target: string | null
  created_at: string
}

/** An interpreted, ready-to-render line in the activity feed. */
interface FeedItem {
  id: number
  user_email: string
  icon: LucideIcon
  predicate: string // reads after the actor's name: "tapped “Save”"
  app: string | null // app context for the sub-line, if any
  detail: string | null // extra sub-line (e.g. an error message)
  isError: boolean
  created_at: string
}

const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Turn a raw web_event into a readable line, or null to skip it as noise. */
function describe(row: EventRow): Omit<FeedItem, 'user_email' | 'created_at'> | null {
  if (row.type === 'session_start')
    return { id: row.id, icon: LogIn, predicate: 'opened the app', app: null, detail: null, isError: false }
  if (row.type === 'error')
    return { id: row.id, icon: Bug, predicate: 'hit an error', app: null, detail: clean(row.target) || null, isError: true }
  // click — the button label is the closest thing we have to an "action".
  const label = clean(row.target)
  // Skip chrome (back chevrons, ✕, bare arrows): require at least one letter/number.
  if (label.length < 2 || !/[a-z0-9]/i.test(label)) return null
  const app = appForPath(row.path)
  return { id: row.id, icon: app.icon, predicate: `tapped “${label}”`, app: app.name, detail: null, isError: false }
}

/**
 * Interpret the raw rows and drop consecutive duplicates — the capture-phase
 * click listener can log the same label twice for one tap (nested button/link).
 */
function buildFeed(rows: EventRow[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const row of rows) {
    const d = describe(row)
    if (!d) continue
    const prev = out[out.length - 1]
    if (prev && prev.user_email === row.user_email && prev.predicate === d.predicate) continue
    out.push({ ...d, user_email: row.user_email, created_at: row.created_at })
  }
  return out
}

/** Admin-only: one household's members and management actions. */
export default function AdminHousehold() {
  const { id } = useParams<{ id: string }>()
  const back = useBack()
  const { profile } = useAuth()

  const [household, setHousehold] = useState<Household | null>(null)
  const [members, setMembers] = useState<Profile[]>([])
  const [activity, setActivity] = useState<Record<string, UserActivity>>({})
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)

  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const [h, u, act, ev] = await Promise.all([
      supabase.from('households').select('*').eq('id', id).single(),
      supabase
        .from('allowed_users')
        .select('email, display_name, household_id, is_admin')
        .eq('household_id', id)
        .order('display_name'),
      supabase.rpc('admin_user_activity', { days: 30 }),
      supabase.rpc('admin_household_events', { p_household: id, lim: 40 }),
    ])
    setHousehold(h.data)
    setMembers(u.data ?? [])
    setActivity(
      Object.fromEntries(
        ((act.data ?? []) as UserActivity[]).map((a) => [a.user_email, a]),
      ),
    )
    setFeed(buildFeed((ev.data ?? []) as EventRow[]))
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (!profile?.is_admin) return <Navigate to="/" replace />

  const atLimit = members.length >= MAX_MEMBERS
  const nameFor = (email: string) =>
    members.find((m) => m.email === email)?.display_name ?? email.split('@')[0]

  async function addMember() {
    const email = mEmail.trim().toLowerCase()
    const name = mName.trim()
    if (!email || !name || busy || !id) return
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      alert('That doesn’t look like a valid email.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('allowed_users').insert({
      email,
      display_name: name,
      household_id: id,
    })
    setBusy(false)
    if (error) {
      alert(
        error.code === '23505'
          ? 'That email is already a member of a household.'
          : error.message.includes('household_member_limit')
            ? `This household is full (max ${MAX_MEMBERS} members).`
            : 'Could not add the member — please try again.',
      )
      return
    }
    setMName('')
    setMEmail('')
    load()
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
    load()
  }

  async function removeHousehold() {
    if (!household) return
    if (members.length > 0) {
      alert('Remove all members first.')
      return
    }
    if (!confirm(`Delete household "${household.name}"?`)) return
    const { error } = await supabase.from('households').delete().eq('id', household.id)
    if (error) {
      alert('Could not delete — the household still has data attached.')
      return
    }
    back('/admin')
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-16">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/admin')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="font-display flex min-w-0 flex-1 items-center gap-2 truncate text-2xl font-bold text-(--text)">
          <Home size={22} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          {household?.name ?? '…'}
        </h1>
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : !household ? (
        <p className="mt-12 text-center text-(--text-faint)">Household not found.</p>
      ) : (
        <>
          <p className="text-sm text-(--text-muted)">
            {members.length}/{MAX_MEMBERS} members · created{' '}
            {formatDay(household.created_at.slice(0, 10))}
          </p>

          <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
            Members
          </h2>
          {members.length === 0 ? (
            <p className="rounded-xl bg-(--card) px-4 py-3 text-sm text-(--text-muted)">
              No members yet — add the first one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {members.map((u) => (
                <li
                  key={u.email}
                  className="flex items-center gap-3 rounded-xl bg-(--card) px-4 py-3"
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
                        ? `Active ${timeAgo(activity[u.email].last_seen)} · ${activity[u.email].events} events / 30d`
                        : 'Never accessed'}
                    </p>
                  </div>
                  {!u.is_admin && (
                    <button
                      onClick={() => removeMember(u)}
                      aria-label={`Remove ${u.display_name}`}
                      className="px-1 text-(--text-faint) active:text-(--expense)"
                    >
                      <X size={18} strokeWidth={2} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
            Add member
          </h2>
          {atLimit ? (
            <p className="rounded-xl bg-(--card) px-4 py-3 text-sm text-(--text-muted)">
              This household is full ({MAX_MEMBERS} members max).
            </p>
          ) : (
            <div className="flex gap-2">
              <input
                value={mName}
                onChange={(e) => setMName(e.target.value)}
                placeholder="Name"
                className="w-24 min-w-0 rounded-xl bg-(--card) px-3 py-2.5 text-sm text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <input
                value={mEmail}
                onChange={(e) => setMEmail(e.target.value)}
                placeholder="Google email"
                type="email"
                autoCapitalize="none"
                className="min-w-0 flex-1 rounded-xl bg-(--card) px-3 py-2.5 text-sm text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
              />
              <button
                onClick={addMember}
                disabled={!mName.trim() || !mEmail.trim() || busy}
                className="rounded-xl bg-(--accent) px-3.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>
          )}

          <h2 className="mt-6 mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
            <Activity size={13} strokeWidth={2.5} aria-hidden="true" />
            Recent activity
          </h2>
          {feed.length === 0 ? (
            <p className="rounded-xl bg-(--card) px-4 py-3 text-sm text-(--text-muted)">
              No activity recorded yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {feed.map((f) => (
                <li
                  key={f.id}
                  className="flex items-start gap-3 rounded-xl bg-(--card) px-3 py-2.5"
                >
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      f.isError
                        ? 'bg-(--accent-soft) text-(--expense)'
                        : 'bg-(--surface) text-(--accent)'
                    }`}
                  >
                    <f.icon size={15} strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-(--text)">
                      <span className="font-medium">{nameFor(f.user_email)}</span> {f.predicate}
                    </p>
                    <p className="text-xs text-(--text-faint)">
                      {[f.app, timeAgo(f.created_at)].filter(Boolean).join(' · ')}
                    </p>
                    {f.detail && (
                      <p className="mt-0.5 break-words text-xs text-(--expense)">{f.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {members.length === 0 && (
            <button
              onClick={removeHousehold}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-(--card) py-3 font-semibold text-(--expense) active:bg-(--card-active)"
            >
              <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
              Delete household
            </button>
          )}
        </>
      )}
    </div>
  )
}
