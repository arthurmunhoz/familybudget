import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useBack } from '../hooks/useBack'
import { supabase } from '../lib/supabase'
import type { Household, Profile } from '../lib/types'

/** Admin-only: create households and manage which Google accounts belong to
 *  each. Members sign in with Google using the exact email added here. */
export default function Admin() {
  const back = useBack()
  const { profile } = useAuth()
  const [households, setHouseholds] = useState<Household[]>([])
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [newHousehold, setNewHousehold] = useState('')
  // per-household "add member" drafts, keyed by household id
  const [drafts, setDrafts] = useState<Record<string, { name: string; email: string }>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [h, u] = await Promise.all([
      supabase.from('households').select('*').order('created_at'),
      supabase.from('allowed_users').select('email, display_name, household_id, is_admin'),
    ])
    setHouseholds(h.data ?? [])
    setUsers(u.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
    load()
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
    load()
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

      <p className="mb-4 text-sm text-(--text-muted)">
        Each household gets its own private hub — same apps, separate data.
        Members sign in with Google using the email you add here.
      </p>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : (
        <div className="space-y-4">
          {households.map((h) => {
            const members = users.filter((u) => u.household_id === h.id)
            const d = draft(h.id)
            return (
              <section key={h.id} className="rounded-2xl bg-(--card) p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-(--text)">🏠 {h.name}</h2>
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
