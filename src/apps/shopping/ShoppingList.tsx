import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import type { ShoppingItem } from '../../lib/types'

export default function ShoppingList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('shopping_items')
      .select('*')
      .order('created_at')
    setItems(data ?? [])
    setLoading(false)
  }, [])

  // Initial load + live sync: any change made on the other phone re-fetches.
  useEffect(() => {
    load()
    const channel = supabase
      .channel('shopping_items_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_items' },
        () => load(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  async function add() {
    const trimmed = label.trim()
    if (!trimmed || !profile) return
    setLabel('')
    const optimistic: ShoppingItem = {
      id: `tmp-${Math.random()}`,
      label: trimmed,
      checked: false,
      added_by: profile.email,
      created_at: new Date().toISOString(),
      checked_at: null,
    }
    setItems((list) => [...list, optimistic])
    const { error } = await supabase
      .from('shopping_items')
      .insert({ label: trimmed, added_by: profile.email })
    if (error) alert('Could not add the item — please try again.')
    load()
  }

  async function toggle(item: ShoppingItem) {
    const checked = !item.checked
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, checked } : i)),
    )
    await supabase
      .from('shopping_items')
      .update({ checked, checked_at: checked ? new Date().toISOString() : null })
      .eq('id', item.id)
  }

  async function remove(item: ShoppingItem) {
    setItems((list) => list.filter((i) => i.id !== item.id))
    await supabase.from('shopping_items').delete().eq('id', item.id)
  }

  async function clearChecked() {
    setItems((list) => list.filter((i) => !i.checked))
    await supabase.from('shopping_items').delete().eq('checked', true)
  }

  const open = items.filter((i) => !i.checked)
  const done = items.filter((i) => i.checked)

  return (
    <div className="mx-auto min-h-page max-w-md px-4 pb-32">
      <header className="flex items-center gap-2 pt-6 pb-4">
        <button
          onClick={() => navigate('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🛒 Shopping List</h1>
        {open.length > 0 && (
          <span className="rounded-full bg-(--surface) px-3 py-1 text-sm font-semibold text-(--text-muted)">
            {open.length}
          </span>
        )}
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="text-5xl">🧾</div>
          <p className="mt-4">The list is empty.</p>
          <p className="text-sm text-(--text-faint)">
            Add things below as they run out.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {open.map((item) => (
              <li key={item.id}>
                <div className="flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3">
                  <button
                    onClick={() => toggle(item)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-(--text-faint)" />
                    <span className="truncate font-medium text-(--text)">
                      {item.label}
                    </span>
                  </button>
                  <button
                    onClick={() => remove(item)}
                    aria-label={`Remove ${item.label}`}
                    className="px-1 text-(--text-faint) active:text-(--expense)"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {done.length > 0 && (
            <>
              <div className="mt-6 mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                  In the cart ({done.length})
                </h3>
                <button
                  onClick={clearChecked}
                  className="text-xs font-semibold text-(--accent) active:opacity-70"
                >
                  Clear checked
                </button>
              </div>
              <ul className="space-y-2">
                {done.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => toggle(item)}
                      className="flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3 text-left opacity-60"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--income) text-[11px] font-bold text-white">
                        ✓
                      </span>
                      <span className="truncate font-medium text-(--text-muted) line-through">
                        {item.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* add bar */}
      <div
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md gap-2 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="Add an item…"
          className="min-w-0 flex-1 rounded-2xl border border-white/30 bg-(--surface) px-4 py-4 text-(--text) shadow-lg outline-none focus:ring-2 focus:ring-(--accent)"
        />
        <button
          onClick={add}
          disabled={!label.trim()}
          className="rounded-2xl border border-white/30 bg-(--accent) px-6 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
