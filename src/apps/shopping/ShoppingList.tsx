import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useBack } from '../../hooks/useBack'
import { useI18n } from '../../hooks/useI18n'
import { useScrollLock } from '../../hooks/useScrollLock'
import { readCache, writeCache } from '../../hooks/useCachedQuery'
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
    () => readCache<ShoppingItem[]>(ITEMS_KEY) ?? [],
  )
  const [stores, setStoresState] = useState<ShoppingStore[]>(
    () => readCache<ShoppingStore[]>(STORES_KEY) ?? [],
  )
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(() => readCache(ITEMS_KEY) === undefined)

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
        return next
      })
    },
    [],
  )

  const load = useCallback(async () => {
    const [itemsRes, storesRes] = await Promise.all([
      supabase.from('shopping_items').select('*').order('created_at'),
      supabase.from('shopping_stores').select('*').order('created_at'),
    ])
    setItems(itemsRes.data ?? [])
    setStores(storesRes.data ?? [])
    setLoading(false)
  }, [setItems, setStores])

  // Initial load + live sync: any change made on the other phone re-fetches.
  useEffect(() => {
    load()
    const channel = supabase
      .channel('shopping_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_stores' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

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
      store_id: activeStoreId,
    }
    setItems((list) => [...list, optimistic])
    const { error } = await supabase
      .from('shopping_items')
      .insert({ label: trimmed, added_by: profile.email, store_id: activeStoreId })
    if (error) alert(t('shopping.addFailed'))
    load()
  }

  async function toggle(item: ShoppingItem) {
    const checked = !item.checked
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, checked } : i)))
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

  // Add a store the user tapped in the catalog (or jump to it if already added).
  async function addCatalogStore(entry: StoreCatalogEntry) {
    const existing = stores.find((s) => s.slug === entry.slug)
    if (existing) {
      selectStore(existing.id)
      setPicking(false)
      return
    }
    const { data, error } = await supabase
      .from('shopping_stores')
      .insert({ name: entry.name, slug: entry.slug })
      .select()
      .single()
    if (error || !data) {
      alert(t('shopping.storeAddFailed'))
      return
    }
    setStores((prev) => [...prev, data as ShoppingStore])
    selectStore((data as ShoppingStore).id)
    setPicking(false)
  }

  async function addCustomStore() {
    const name = storeInput.trim()
    if (!name) return
    setStoreInput('')
    const { data, error } = await supabase
      .from('shopping_stores')
      .insert({ name, slug: null })
      .select()
      .single()
    if (error || !data) {
      alert(t('shopping.storeAddFailed'))
      return
    }
    setStores((prev) => [...prev, data as ShoppingStore])
    selectStore((data as ShoppingStore).id)
    setPicking(false)
  }

  async function removeStore(store: ShoppingStore) {
    if (!confirm(t('shopping.removeStoreConfirm', { name: store.name }))) return
    setStores((prev) => prev.filter((s) => s.id !== store.id))
    setItems((prev) => prev.map((i) => (i.store_id === store.id ? { ...i, store_id: null } : i)))
    if (activeStoreId === store.id) selectStore(null)
    await supabase.from('shopping_stores').delete().eq('id', store.id)
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
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--income) text-[11px] font-bold text-white">
                ✓
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
              ✕
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-40">
      <header className="sticky top-0 z-10 -mx-4 -mt-[env(safe-area-inset-top)] flex items-center gap-2 bg-(--bg) px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-4">
        <button
          onClick={() => back('/')}
          className="rounded-lg px-2 py-1 text-xl text-(--text-muted) active:text-(--text)"
        >
          ‹
        </button>
        <h1 className="flex-1 text-2xl font-bold text-(--text)">🛒 {t('shopping.title')}</h1>
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
          <div className="text-5xl">🧾</div>
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
                      <span className="text-base">🧺</span>
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
              className="rounded-full border border-white/30 bg-(--surface) px-3 py-1.5 text-sm font-semibold text-(--text-muted) shadow-lg active:scale-95 transition-transform"
            >
              🏪 {t('shopping.selectStores')}
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
              className="shrink-0 rounded-full border border-white/30 bg-(--surface) px-3 py-1.5 text-sm font-semibold text-(--text-muted) shadow-lg active:scale-95 transition-transform"
            >
              ＋
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
              <h2 className="text-lg font-bold text-(--text)">🏪 {t('shopping.stores')}</h2>
              <button
                onClick={() => setPicking(false)}
                aria-label={t('common.close')}
                className="px-2 py-1 text-(--text-muted) active:text-(--text)"
              >
                ✕
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
                          ✕
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
