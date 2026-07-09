import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, ShoppingCart, Store, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { readCache, writeCache } from '../../hooks/useCachedQuery'
import { enqueueOp, flushShoppingOutbox, loadLocal, saveLocal } from '../../lib/offline'
import { supabase } from '../../lib/supabase'
import { STORE_CATALOG, type StoreCatalogEntry } from '../../lib/stores'
import type { ShoppingItem, ShoppingStore } from '../../lib/types'
import StoreLogo from './StoreLogo'

const ITEMS_KEY = 'shopping:items'
const STORES_KEY = 'shopping:stores'
const ACTIVE_KEY = 'shopping:activeStore'

export default function ShoppingList() {
  const back = useBack()
  const { t } = useI18n()
  const { profile } = useAuth()
  // Seed from the in-memory cache so returning to the list shows it instantly
  // (no "Loading…" flash); Realtime + optimistic edits keep it fresh.
  const [items, setItemsState] = useState<ShoppingItem[]>(
    () => readCache<ShoppingItem[]>(ITEMS_KEY) ?? loadLocal<ShoppingItem[]>(ITEMS_KEY) ?? [],
  )
  const [stores, setStoresState] = useState<ShoppingStore[]>(
    () => readCache<ShoppingStore[]>(STORES_KEY) ?? loadLocal<ShoppingStore[]>(STORES_KEY) ?? [],
  )
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(
    () => readCache(ITEMS_KEY) === undefined && loadLocal(ITEMS_KEY) === undefined,
  )

  // Which store new items go to (null = "Anywhere"). Remembered across mounts.
  const [activeStoreId, setActiveStoreId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_KEY) || null,
  )
  const [picking, setPicking] = useState(false)
  const [storeInput, setStoreInput] = useState('')
  useScrollLock(picking)

  // Every update writes through to the cache, so the next mount restores it.
  const setItems = useCallback(
    (updater: ShoppingItem[] | ((prev: ShoppingItem[]) => ShoppingItem[])) => {
      setItemsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        writeCache(ITEMS_KEY, next)
        saveLocal(ITEMS_KEY, next) // durable copy for offline reads
        return next
      })
    },
    [],
  )
  const setStores = useCallback(
    (updater: ShoppingStore[] | ((prev: ShoppingStore[]) => ShoppingStore[])) => {
      setStoresState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        writeCache(STORES_KEY, next)
        saveLocal(STORES_KEY, next) // durable copy for offline reads
        return next
      })
    },
    [],
  )

  // Ids the user just deleted locally. A refetch already in flight when they tap
  // carries a pre-delete snapshot; without this guard its setItems would
  // resurrect the row for a few hundred ms (the "lag" that makes people tap
  // again and delete two). Hide these ids from every server snapshot until the
  // server confirms they're gone, then drop them from the set.
  const pendingRemovals = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    // Offline: keep the persisted list on screen, don't touch the network.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setLoading(false)
      return
    }
    // Push any queued offline edits first, then pull the reconciled state.
    await flushShoppingOutbox()
    const [itemsRes, storesRes] = await Promise.all([
      supabase.from('shopping_items').select('*').order('created_at'),
      supabase.from('shopping_stores').select('*').order('created_at'),
    ])
    // Only overwrite local state when the fetch actually succeeded — a failed
    // request (offline / captive wifi) must not wipe the list.
    if (!itemsRes.error) {
      const data = itemsRes.data ?? []
      if (pendingRemovals.current.size) {
        // Any pending id the server no longer returns is confirmed deleted —
        // clear it. Ids the snapshot still contains stay hidden (delete not yet
        // propagated), so a stale in-flight fetch can't bring the row back.
        const serverIds = new Set(data.map((i) => i.id))
        for (const id of pendingRemovals.current) {
          if (!serverIds.has(id)) pendingRemovals.current.delete(id)
        }
        setItems(data.filter((i) => !pendingRemovals.current.has(i.id)))
      } else {
        setItems(data)
      }
    }
    if (!storesRes.error) setStores(storesRes.data ?? [])
    setLoading(false)
  }, [setItems, setStores])

  // Coalesce the bursts of load() triggers (a mutation + its own Realtime echo,
  // or several quick toggles) into a single fetch.
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => void load(), 300)
  }, [load])

  // Initial load + live sync: any change made on the other phone re-fetches.
  useEffect(() => {
    load()
    const channel = supabase
      .channel('shopping_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () => scheduleLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_stores' }, () => scheduleLoad())
      .subscribe()
    // Back online → flush queued offline edits and pull fresh state.
    const onOnline = () => load()
    window.addEventListener('online', onOnline)
    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('online', onOnline)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  function selectStore(id: string | null) {
    setActiveStoreId(id)
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  }

  // If the remembered store was removed, fall back to Anywhere.
  useEffect(() => {
    if (loading) return
    if (activeStoreId && !stores.some((s) => s.id === activeStoreId)) selectStore(null)
  }, [stores, loading, activeStoreId])

  // All mutations are offline-first: update local state, queue the change, then
  // load() (which flushes the queue + refetches when online, or no-ops offline).
  function add() {
    const trimmed = label.trim()
    if (!trimmed || !profile) return
    setLabel('')
    const tempId = `tmp-${crypto.randomUUID()}`
    const optimistic: ShoppingItem = {
      id: tempId,
      label: trimmed,
      checked: false,
      added_by: profile.email,
      created_at: new Date().toISOString(),
      checked_at: null,
      store_id: activeStoreId,
    }
    setItems((list) => [...list, optimistic])
    enqueueOp({ k: 'item.add', tempId, label: trimmed, store_id: activeStoreId, added_by: profile.email })
    scheduleLoad()
  }

  function toggle(item: ShoppingItem) {
    const checked = !item.checked
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, checked } : i)))
    enqueueOp({ k: 'item.toggle', id: item.id, checked })
    scheduleLoad()
  }

  function remove(item: ShoppingItem) {
    pendingRemovals.current.add(item.id)
    setItems((list) => list.filter((i) => i.id !== item.id))
    enqueueOp({ k: 'item.remove', id: item.id })
    scheduleLoad()
  }

  function clearChecked() {
    items.filter((i) => i.checked).forEach((i) => pendingRemovals.current.add(i.id))
    setItems((list) => list.filter((i) => !i.checked))
    enqueueOp({ k: 'item.clearChecked' })
    scheduleLoad()
  }

  /** Build an offline-friendly store row with a temp id. */
  function newStore(name: string, slug: string | null): ShoppingStore | null {
    if (!profile) return null
    return {
      id: `tmp-${crypto.randomUUID()}`,
      household_id: profile.household_id,
      name,
      slug,
      created_at: new Date().toISOString(),
    }
  }

  // Add a store the user tapped in the catalog (or jump to it if already added).
  function addCatalogStore(entry: StoreCatalogEntry) {
    const existing = stores.find((s) => s.slug === entry.slug)
    if (existing) {
      selectStore(existing.id)
      setPicking(false)
      return
    }
    const store = newStore(entry.name, entry.slug)
    if (!store) return
    setStores((prev) => [...prev, store])
    enqueueOp({ k: 'store.add', tempId: store.id, name: entry.name, slug: entry.slug })
    selectStore(store.id)
    setPicking(false)
    scheduleLoad()
  }

  function addCustomStore() {
    const name = storeInput.trim()
    if (!name) return
    setStoreInput('')
    const store = newStore(name, null)
    if (!store) return
    setStores((prev) => [...prev, store])
    enqueueOp({ k: 'store.add', tempId: store.id, name, slug: null })
    selectStore(store.id)
    setPicking(false)
    scheduleLoad()
  }

  function removeStore(store: ShoppingStore) {
    if (!confirm(t('shopping.removeStoreConfirm', { name: store.name }))) return
    setStores((prev) => prev.filter((s) => s.id !== store.id))
    setItems((prev) => prev.map((i) => (i.store_id === store.id ? { ...i, store_id: null } : i)))
    if (activeStoreId === store.id) selectStore(null)
    enqueueOp({ k: 'store.remove', id: store.id })
    scheduleLoad()
  }

  // Build the visible groups: one per store (in store order) then "Anywhere",
  // each keeping open items above checked ones. Empty groups are hidden.
  const groups = useMemo(() => {
    const valid = new Set(stores.map((s) => s.id))
    // Stable, predictable order: open items above checked ones, each block
    // alphabetical by label. So checking an item just moves it into the
    // checked block at its alphabetical spot — nothing else shuffles around.
    const bucket = (sid: string | null) =>
      items
        .filter((i) =>
          sid === null ? !i.store_id || !valid.has(i.store_id) : i.store_id === sid,
        )
        .sort(
          (a, b) =>
            Number(a.checked) - Number(b.checked) ||
            a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
        )
    const out: {
      id: string
      name: string
      slug: string | null
      isStore: boolean
      rows: ShoppingItem[]
    }[] = []
    for (const s of stores) {
      const rows = bucket(s.id)
      if (rows.length)
        out.push({ id: s.id, name: s.name, slug: s.slug, isStore: true, rows })
    }
    const anywhere = bucket(null)
    if (anywhere.length)
      out.push({ id: '__any', name: t('shopping.anywhere'), slug: null, isStore: false, rows: anywhere })
    return out
  }, [items, stores, t])

  const showHeaders = stores.length > 0
  const doneCount = items.filter((i) => i.checked).length
  const openCount = items.length - doneCount
  const activeStore = stores.find((s) => s.id === activeStoreId)
  const catalogToAdd = STORE_CATALOG.filter(
    (e) => !stores.some((s) => s.slug === e.slug),
  ).sort((a, b) => a.name.localeCompare(b.name))

  function Row(item: ShoppingItem) {
    return (
      <li key={item.id}>
        <div
          className={`flex w-full items-center gap-3 rounded-xl bg-(--card) px-4 py-3 ${
            item.checked ? 'opacity-60' : ''
          }`}
        >
          <button
            onClick={() => toggle(item)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            {item.checked ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--income) text-white">
                <Check size={12} strokeWidth={3} aria-hidden="true" />
              </span>
            ) : (
              <span className="h-5 w-5 shrink-0 rounded-full border-2 border-(--text-faint)" />
            )}
            <span
              className={`truncate font-medium ${
                item.checked ? 'text-(--text-muted) line-through' : 'text-(--text)'
              }`}
            >
              {item.label}
            </span>
          </button>
          {!item.checked && (
            <button
              onClick={() => remove(item)}
              aria-label={t('common.removeName', { name: item.label })}
              className="px-1 text-(--text-faint) active:text-(--expense)"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-40">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4 mb-2">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 flex items-center gap-2 text-2xl font-bold font-display text-(--text)">
          <ShoppingCart size={24} strokeWidth={2} aria-hidden="true" />
          {t('shopping.title')}
        </h1>
        {openCount > 0 && (
          <span className="rounded-full bg-(--surface) px-3 py-1 text-sm font-semibold text-(--text-muted)">
            {openCount}
          </span>
        )}
      </header>

      {loading ? (
        <p className="mt-12 text-center text-(--text-faint) animate-pulse">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <div className="mt-16 text-center text-(--text-muted)">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-(--surface)">
            <ShoppingCart size={40} className="text-(--text-faint)" strokeWidth={2} aria-hidden="true" />
          </div>
          <p className="mt-4">{t('shopping.empty')}</p>
          <p className="text-sm text-(--text-faint)">{t('shopping.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const open = g.rows.filter((r) => !r.checked).length
            return (
              <div key={g.id}>
                {showHeaders && (
                  <div className="mb-2 flex items-center gap-2 px-1">
                    {g.isStore ? (
                      <StoreLogo slug={g.slug} name={g.name} size={20} />
                    ) : (
                      <ShoppingCart size={18} className="text-(--text-faint)" strokeWidth={2} aria-hidden="true" />
                    )}
                    <h3
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        g.isStore ? 'text-(--text)' : 'text-(--text-faint)'
                      }`}
                    >
                      {g.name}
                    </h3>
                    {open > 0 && <span className="text-xs text-(--text-faint)">{open}</span>}
                  </div>
                )}
                <ul className="space-y-2">{g.rows.map(Row)}</ul>
              </div>
            )
          })}

          {doneCount > 0 && (
            <button
              onClick={clearChecked}
              className="mx-auto block text-xs font-semibold text-(--accent) active:opacity-70"
            >
              {t('shopping.clearChecked')}
            </button>
          )}
        </div>
      )}

      {/* add bar: store chips + input */}
      <div
        className="fixed inset-x-0 bottom-0 mx-auto max-w-md px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        {stores.length === 0 ? (
          <div className="mb-2">
            <button
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 rounded-full border border-white/30 bg-(--surface) px-3 py-1.5 text-sm font-semibold text-(--text-muted) shadow-lg active:scale-95 transition-transform"
            >
              <Store size={16} strokeWidth={2} aria-hidden="true" />
              {t('shopping.selectStores')}
            </button>
          </div>
        ) : (
          <div
            className="mb-2 flex flex-nowrap gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            <button
              onClick={() => selectStore(null)}
              className={`shrink-0 rounded-full border border-white/30 px-3 py-1.5 text-sm font-semibold shadow-lg active:scale-95 transition-transform ${
                activeStoreId === null
                  ? 'bg-(--accent) text-white'
                  : 'bg-(--surface) text-(--text-muted)'
              }`}
            >
              {t('shopping.anywhere')}
            </button>
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => selectStore(s.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border border-white/30 py-1.5 pl-1.5 pr-3 text-sm font-semibold shadow-lg active:scale-95 transition-transform ${
                  activeStoreId === s.id
                    ? 'bg-(--accent) text-white'
                    : 'bg-(--surface) text-(--text-muted)'
                }`}
              >
                <StoreLogo slug={s.slug} name={s.name} size={22} />
                {s.name}
              </button>
            ))}
            <button
              onClick={() => setPicking(true)}
              aria-label={t('shopping.manageStores')}
              className="flex shrink-0 items-center rounded-full border border-white/30 bg-(--surface) px-3 py-1.5 text-sm font-semibold text-(--text-muted) shadow-lg active:scale-95 transition-transform"
            >
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder={
              activeStore
                ? t('shopping.addToStore', { store: activeStore.name })
                : t('shopping.addPlaceholder')
            }
            className="min-w-0 flex-1 rounded-2xl border border-white/30 bg-(--surface) px-4 py-4 text-(--text) shadow-lg outline-none focus:ring-2 focus:ring-(--accent)"
          />
          <button
            onClick={add}
            disabled={!label.trim()}
            className="rounded-2xl border border-white/30 bg-(--accent) px-6 text-lg font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {t('common.add')}
          </button>
        </div>
      </div>

      {/* store picker sheet */}
      {picking && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={() => setPicking(false)}>
          <div
            className="mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-(--card)"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
              <h2 className="flex items-center gap-2 text-lg font-bold text-(--text)">
                <Store size={20} strokeWidth={2} aria-hidden="true" />
                {t('shopping.stores')}
              </h2>
              <button
                onClick={() => setPicking(false)}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
              {stores.length > 0 && (
                <>
                  <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-(--accent)">
                    {t('shopping.onYourList')}
                  </h3>
                  <div className="mb-5 grid grid-cols-2 gap-2">
                    {stores.map((s) => (
                      <div
                        key={s.id}
                        className="relative flex items-center gap-2.5 rounded-xl bg-(--surface) px-3 py-2.5"
                      >
                        <button
                          onClick={() => {
                            selectStore(s.id)
                            setPicking(false)
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <StoreLogo slug={s.slug} name={s.name} size={32} />
                          <span className="truncate text-sm font-medium text-(--text)">{s.name}</span>
                        </button>
                        <button
                          onClick={() => removeStore(s)}
                          aria-label={t('common.removeName', { name: s.name })}
                          className="shrink-0 px-1 text-(--text-faint) active:text-(--expense)"
                        >
                          <X size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
                {t('shopping.allStores')}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {catalogToAdd.map((e) => (
                  <button
                    key={e.slug}
                    onClick={() => addCatalogStore(e)}
                    className="flex items-center gap-2.5 rounded-xl bg-(--surface) px-3 py-2.5 text-left active:scale-[0.98] transition-transform"
                  >
                    <StoreLogo slug={e.slug} name={e.name} size={32} />
                    <span className="truncate text-sm font-medium text-(--text)">{e.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div
              className="shrink-0 px-4 pt-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
              <div className="flex gap-2">
                <input
                  value={storeInput}
                  onChange={(e) => setStoreInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomStore()
                  }}
                  placeholder={t('shopping.otherStore')}
                  className="min-w-0 flex-1 rounded-xl bg-(--surface) px-4 py-3 text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
                />
                <button
                  onClick={addCustomStore}
                  disabled={!storeInput.trim()}
                  className="rounded-xl bg-(--accent) px-5 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  {t('common.add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
