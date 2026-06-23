import { supabase } from './supabase'

/** Durable JSON storage — survives full reloads, unlike the in-memory query
 *  cache. Used so the shopping list is readable with no connection. */
export function loadLocal<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
export function saveLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / quota exceeded — in-memory state still works this session
  }
}

// ── Shopping list offline outbox ─────────────────────────────────────────────
// Mutations made with no connection (the "no wifi at Costco" case) are queued
// here and replayed, in order, the next time we reach Supabase. The list stays
// fully editable in the aisle; it syncs on reconnect.

const OUTBOX_KEY = 'shopping:outbox'

export type ShoppingOp =
  | { k: 'item.add'; tempId: string; label: string; store_id: string | null; added_by: string }
  | { k: 'item.toggle'; id: string; checked: boolean }
  | { k: 'item.remove'; id: string }
  | { k: 'item.clearChecked' }
  | { k: 'store.add'; tempId: string; name: string; slug: string | null }
  | { k: 'store.remove'; id: string }

export function enqueueOp(op: ShoppingOp): void {
  const q = loadLocal<ShoppingOp[]>(OUTBOX_KEY) ?? []
  q.push(op)
  saveLocal(OUTBOX_KEY, q)
}

/** Offline-created rows carry a `tmp-…` client id until they're inserted. */
const isTemp = (id: string) => id.startsWith('tmp-')

/** Rewrite a queued op that referenced a just-inserted temp id. Persisting the
 *  remapped queue means a later op (e.g. toggling an offline-added item) still
 *  resolves correctly even across multiple flush attempts. */
function remapTemp(op: ShoppingOp, tempId: string, realId: string): ShoppingOp {
  if (op.k === 'item.add' && op.store_id === tempId) return { ...op, store_id: realId }
  if (
    (op.k === 'item.toggle' || op.k === 'item.remove' || op.k === 'store.remove') &&
    op.id === tempId
  ) {
    return { ...op, id: realId }
  }
  return op
}

let flushing = false

/** Replay queued mutations in order. Stops at the first failure and keeps the
 *  rest, so it's safe to call again (after the next mutation or on reconnect). */
export async function flushShoppingOutbox(): Promise<void> {
  if (flushing) return
  let q = loadLocal<ShoppingOp[]>(OUTBOX_KEY) ?? []
  if (!q.length) return
  flushing = true
  try {
    while (q.length) {
      const op = q[0]
      let mapped: { tempId: string; realId: string } | null = null
      try {
        if (op.k === 'item.add') {
          // A temp store id can only remain if its store.add never synced —
          // fall back to "Anywhere" rather than send a bad foreign key.
          const store_id = op.store_id && isTemp(op.store_id) ? null : op.store_id
          const { data, error } = await supabase
            .from('shopping_items')
            .insert({ label: op.label, added_by: op.added_by, store_id })
            .select('id')
            .single()
          if (error) throw error
          if (data) mapped = { tempId: op.tempId, realId: (data as { id: string }).id }
        } else if (op.k === 'item.toggle') {
          if (!isTemp(op.id)) {
            const { error } = await supabase
              .from('shopping_items')
              .update({ checked: op.checked, checked_at: op.checked ? new Date().toISOString() : null })
              .eq('id', op.id)
            if (error) throw error
          }
        } else if (op.k === 'item.remove') {
          if (!isTemp(op.id)) {
            const { error } = await supabase.from('shopping_items').delete().eq('id', op.id)
            if (error) throw error
          }
        } else if (op.k === 'item.clearChecked') {
          const { error } = await supabase.from('shopping_items').delete().eq('checked', true)
          if (error) throw error
        } else if (op.k === 'store.add') {
          const { data, error } = await supabase
            .from('shopping_stores')
            .insert({ name: op.name, slug: op.slug })
            .select('id')
            .single()
          if (error) throw error
          if (data) mapped = { tempId: op.tempId, realId: (data as { id: string }).id }
        } else if (op.k === 'store.remove') {
          if (!isTemp(op.id)) {
            const { error } = await supabase.from('shopping_stores').delete().eq('id', op.id)
            if (error) throw error
          }
        }
      } catch {
        return // still offline / failed — keep this op and the rest for next time
      }
      q = q.slice(1)
      if (mapped) q = q.map((o) => remapTemp(o, mapped!.tempId, mapped!.realId))
      saveLocal(OUTBOX_KEY, q)
    }
  } finally {
    flushing = false
  }
}
