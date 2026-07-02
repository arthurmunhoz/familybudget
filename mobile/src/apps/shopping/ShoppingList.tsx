// Shopping List — RN port of the PWA's ShoppingList. Shared, live-synced family
// list: open items first, checked items struck-through below, optimistic
// add/toggle/delete, optional per-store grouping, and Supabase Realtime so an
// edit on another phone shows up here. RLS scopes everything to the household;
// inserts get household_id / added_by stamped server-side, so the client never
// passes household_id.
//
// OFFLINE: fully supported (RN port of the PWA's outbox, see @/lib/offline).
// Mutations are queued in AsyncStorage and replayed on reconnect; the list stays
// editable and readable with no connection and survives an app restart.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Plus, ShoppingCart, Store, X } from 'lucide-react-native'

import { AppHeader, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { readCache, writeCache } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import {
  enqueueOp,
  flushShoppingOutbox,
  loadLocal,
  saveLocal,
  LOCAL_ITEMS,
  LOCAL_STORES,
} from '@/lib/offline'
import { supabase } from '@/lib/supabase'
import { STORE_CATALOG, type StoreCatalogEntry } from '@/lib/stores'
import type { ShoppingItem, ShoppingStore } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import StoreLogo from './StoreLogo'

// RN has no crypto.randomUUID on all engines — a temp id only needs to be unique
// within this session (it's replaced by the server row on the next refetch).
let tmpCounter = 0
const tempId = () => `tmp-${Date.now()}-${tmpCounter++}`

interface Section {
  id: string
  title: string
  slug: string | null
  isStore: boolean
  data: ShoppingItem[]
}

export default function ShoppingList() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { t } = useI18n()
  const { profile } = useAuth()

  // Seed from the in-memory cache so the list renders instantly on return; a
  // durable AsyncStorage copy (below) hydrates it on a cold start / offline.
  const [items, setItemsState] = useState<ShoppingItem[]>(
    () => readCache<ShoppingItem[]>(LOCAL_ITEMS) ?? [],
  )
  const [stores, setStoresState] = useState<ShoppingStore[]>(
    () => readCache<ShoppingStore[]>(LOCAL_STORES) ?? [],
  )
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(() => readCache(LOCAL_ITEMS) === undefined)

  // Every update writes through to the in-memory cache AND the durable store, so
  // the next mount restores it and the list stays readable with no connection.
  const setItems = useCallback(
    (updater: ShoppingItem[] | ((prev: ShoppingItem[]) => ShoppingItem[])) => {
      setItemsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        writeCache(LOCAL_ITEMS, next)
        void saveLocal(LOCAL_ITEMS, next)
        return next
      })
    },
    [],
  )
  const setStores = useCallback(
    (updater: ShoppingStore[] | ((prev: ShoppingStore[]) => ShoppingStore[])) => {
      setStoresState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        writeCache(LOCAL_STORES, next)
        void saveLocal(LOCAL_STORES, next)
        return next
      })
    },
    [],
  )

  // Cold start with an empty in-memory cache: hydrate from durable storage so
  // the list is visible offline before (or without) a network fetch resolves.
  useEffect(() => {
    if (readCache(LOCAL_ITEMS) !== undefined) return
    let active = true
    void loadLocal<ShoppingItem[]>(LOCAL_ITEMS).then((v) => {
      if (active && v && v.length) {
        setItemsState(v)
        writeCache(LOCAL_ITEMS, v)
        setLoading(false)
      }
    })
    void loadLocal<ShoppingStore[]>(LOCAL_STORES).then((v) => {
      if (active && v && v.length) {
        setStoresState(v)
        writeCache(LOCAL_STORES, v)
      }
    })
    return () => {
      active = false
    }
  }, [])

  // Which store new items go to (null = "Anywhere").
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [storeInput, setStoreInput] = useState('')

  const load = useCallback(async () => {
    // Push any queued offline edits first, then pull the reconciled state. Both
    // steps fail silently when offline — the queue and the local list survive.
    await flushShoppingOutbox()
    const [itemsRes, storesRes] = await Promise.all([
      supabase.from('shopping_items').select('*').order('created_at'),
      supabase.from('shopping_stores').select('*').order('created_at'),
    ])
    // Only overwrite local state when the fetch actually succeeded — a failed
    // request (offline / captive wifi) must not wipe the list.
    if (!itemsRes.error) setItems((itemsRes.data as ShoppingItem[]) ?? [])
    if (!storesRes.error) setStores((storesRes.data as ShoppingStore[]) ?? [])
    setLoading(false)
  }, [setItems, setStores])

  // Coalesce bursts of refresh triggers (a mutation + its own Realtime echo, or
  // several quick toggles) into a single fetch.
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => void load(), 300)
  }, [load])

  // Initial load + live sync: any change made on the other phone re-fetches.
  useEffect(() => {
    void load()
    const channel = supabase
      .channel('shopping_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () =>
        scheduleLoad(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_stores' }, () =>
        scheduleLoad(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  function selectStore(id: string | null) {
    setActiveStoreId(id)
  }

  // If the selected store was removed, fall back to Anywhere.
  useEffect(() => {
    if (loading) return
    if (activeStoreId && !stores.some((s) => s.id === activeStoreId)) setActiveStoreId(null)
  }, [stores, loading, activeStoreId])

  // ── Mutations: offline-first. Update local state, queue the change, then
  // scheduleLoad() — which flushes the queue + refetches when online, or just
  // keeps the local list when offline. Single write path (the outbox) works
  // identically on- and offline; nothing writes to Supabase directly here. ────
  function add() {
    const trimmed = label.trim()
    if (!trimmed || !profile) return
    setLabel('')
    const id = tempId()
    const optimistic: ShoppingItem = {
      id,
      label: trimmed,
      checked: false,
      added_by: profile.email,
      created_at: new Date().toISOString(),
      checked_at: null,
      store_id: activeStoreId,
    }
    setItems((list) => [...list, optimistic])
    void enqueueOp({ k: 'item.add', tempId: id, label: trimmed, store_id: activeStoreId, added_by: profile.email })
    scheduleLoad()
  }

  function toggle(item: ShoppingItem) {
    const checked = !item.checked
    setItems((list) =>
      list.map((i) =>
        i.id === item.id
          ? { ...i, checked, checked_at: checked ? new Date().toISOString() : null }
          : i,
      ),
    )
    void enqueueOp({ k: 'item.toggle', id: item.id, checked })
    scheduleLoad()
  }

  function remove(item: ShoppingItem) {
    setItems((list) => list.filter((i) => i.id !== item.id))
    void enqueueOp({ k: 'item.remove', id: item.id })
    scheduleLoad()
  }

  function clearChecked() {
    if (!items.some((i) => i.checked)) return
    setItems((list) => list.filter((i) => !i.checked))
    void enqueueOp({ k: 'item.clearChecked' })
    scheduleLoad()
  }

  /** Build an offline-friendly store row with a temp id. */
  function newStore(name: string, slug: string | null): ShoppingStore | null {
    if (!profile) return null
    return {
      id: tempId(),
      household_id: profile.household_id,
      name,
      slug,
      created_at: new Date().toISOString(),
    }
  }

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
    void enqueueOp({ k: 'store.add', tempId: store.id, name: entry.name, slug: entry.slug })
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
    void enqueueOp({ k: 'store.add', tempId: store.id, name, slug: null })
    selectStore(store.id)
    setPicking(false)
    scheduleLoad()
  }

  function removeStore(store: ShoppingStore) {
    Alert.alert(
      t('shopping.stores'),
      t('shopping.removeStoreConfirm', { name: store.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            setStores((prev) => prev.filter((s) => s.id !== store.id))
            setItems((prev) =>
              prev.map((i) => (i.store_id === store.id ? { ...i, store_id: null } : i)),
            )
            if (activeStoreId === store.id) selectStore(null)
            void enqueueOp({ k: 'store.remove', id: store.id })
            scheduleLoad()
          },
        },
      ],
      { cancelable: true },
    )
  }

  // Build sections: one per store (in store order) then "Anywhere". Within each,
  // open items above checked ones, each block alphabetical — so checking an item
  // only slides it into the checked block, nothing else reshuffles.
  const sections = useMemo<Section[]>(() => {
    const valid = new Set(stores.map((s) => s.id))
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
    const out: Section[] = []
    for (const s of stores) {
      const data = bucket(s.id)
      if (data.length) out.push({ id: s.id, title: s.name, slug: s.slug, isStore: true, data })
    }
    const anywhere = bucket(null)
    if (anywhere.length)
      out.push({ id: '__any', title: t('shopping.anywhere'), slug: null, isStore: false, data: anywhere })
    return out
  }, [items, stores, t])

  const showHeaders = stores.length > 0
  const doneCount = items.filter((i) => i.checked).length
  const openCount = items.length - doneCount
  const activeStore = stores.find((s) => s.id === activeStoreId)
  const catalogToAdd = STORE_CATALOG.filter(
    (e) => !stores.some((s) => s.slug === e.slug),
  ).sort((a, b) => a.name.localeCompare(b.name))

  const renderItem = ({ item }: { item: ShoppingItem }) => (
    <View style={[styles.row, { backgroundColor: c.card }, item.checked && { opacity: 0.6 }]}>
      <Pressable
        onPress={() => toggle(item)}
        style={styles.rowMain}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked }}
      >
        {item.checked ? (
          <View style={[styles.checkOn, { backgroundColor: c.income }]}>
            <Check size={12} strokeWidth={3} color="#ffffff" />
          </View>
        ) : (
          <View style={[styles.checkOff, { borderColor: c.textFaint }]} />
        )}
        <Txt
          numberOfLines={2}
          style={[
            styles.itemLabel,
            { color: item.checked ? c.textMuted : c.text },
            item.checked && styles.struck,
          ]}
        >
          {item.label}
        </Txt>
      </Pressable>
      <Pressable
        onPress={() => remove(item)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.removeName', { name: item.label })}
        style={styles.removeBtn}
      >
        <X size={18} strokeWidth={2} color={c.textFaint} />
      </Pressable>
    </View>
  )

  const renderSectionHeader = ({ section }: { section: Section }) => {
    if (!showHeaders) return <View style={{ height: sp.xs }} />
    const open = section.data.filter((r) => !r.checked).length
    return (
      <View style={[styles.sectionHeader, { backgroundColor: c.bg }]}>
        {section.isStore ? (
          <StoreLogo slug={section.slug} name={section.title} size={20} />
        ) : (
          <ShoppingCart size={18} strokeWidth={2} color={c.textFaint} />
        )}
        <Txt
          variant="label"
          style={{
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: section.isStore ? c.text : c.textFaint,
          }}
        >
          {section.title}
        </Txt>
        {open > 0 ? <Txt variant="faint">{open}</Txt> : null}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={t('shopping.title')}
          right={
            openCount > 0 ? (
              <View style={[styles.countPill, { backgroundColor: c.surface }]}>
                <Txt variant="label">{openCount}</Txt>
              </View>
            ) : undefined
          }
        />
      </View>

      {loading ? (
        <Loader />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surface }]}>
            <ShoppingCart size={40} strokeWidth={2} color={c.textFaint} />
          </View>
          <Txt variant="body" style={{ color: c.textMuted, marginTop: sp.lg }}>
            {t('shopping.empty')}
          </Txt>
          <Txt variant="faint">{t('shopping.emptyHint')}</Txt>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{
            paddingHorizontal: sp.lg,
            paddingBottom: 220 + insets.bottom,
          }}
          ItemSeparatorComponent={() => <View style={{ height: sp.sm }} />}
          SectionSeparatorComponent={() => <View style={{ height: sp.xs }} />}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            doneCount > 0 ? (
              <Pressable onPress={clearChecked} style={styles.clearBtn}>
                <Txt variant="label" style={{ color: c.accent }}>
                  {t('shopping.clearChecked')}
                </Txt>
              </Pressable>
            ) : null
          }
        />
      )}

      {/* Add bar: store chips + text field, pinned above the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
        style={styles.addBarWrap}
      >
        <View style={[styles.addBar, { backgroundColor: c.bg, paddingBottom: insets.bottom + sp.md }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            keyboardShouldPersistTaps="handled"
          >
            {stores.length === 0 ? (
              <Chip
                onPress={() => setPicking(true)}
                active={false}
                c={c}
                icon={<Store size={16} strokeWidth={2} color={c.textMuted} />}
                label={t('shopping.selectStores')}
              />
            ) : (
              <>
                <Chip
                  onPress={() => selectStore(null)}
                  active={activeStoreId === null}
                  c={c}
                  label={t('shopping.anywhere')}
                />
                {stores.map((s) => (
                  <Chip
                    key={s.id}
                    onPress={() => selectStore(s.id)}
                    active={activeStoreId === s.id}
                    c={c}
                    icon={<StoreLogo slug={s.slug} name={s.name} size={20} />}
                    label={s.name}
                  />
                ))}
                <Chip
                  onPress={() => setPicking(true)}
                  active={false}
                  c={c}
                  icon={<Plus size={18} strokeWidth={2} color={c.textMuted} />}
                  label=""
                  accessibilityLabel={t('shopping.manageStores')}
                />
              </>
            )}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              value={label}
              onChangeText={setLabel}
              onSubmitEditing={add}
              returnKeyType="done"
              blurOnSubmit={false}
              placeholder={
                activeStore
                  ? t('shopping.addToStore', { store: activeStore.name })
                  : t('shopping.addPlaceholder')
              }
              placeholderTextColor={c.textFaint}
              style={[styles.input, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
            />
            <Pressable
              onPress={add}
              disabled={!label.trim()}
              style={[
                styles.addBtn,
                { backgroundColor: c.accent, opacity: label.trim() ? 1 : 0.5 },
              ]}
            >
              <Txt style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>
                {t('common.add')}
              </Txt>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Store picker sheet */}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.card, paddingBottom: insets.bottom + sp.md }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheetHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Store size={20} strokeWidth={2} color={c.text} />
                <Txt variant="h2">{t('shopping.stores')}</Txt>
              </View>
              <Pressable onPress={() => setPicking(false)} hitSlop={10} accessibilityLabel={t('common.close')}>
                <X size={20} strokeWidth={2} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingBottom: sp.md }}
              keyboardShouldPersistTaps="handled"
            >
              {stores.length > 0 ? (
                <>
                  <Txt variant="label" style={[styles.groupLabel, { color: c.accent }]}>
                    {t('shopping.onYourList').toUpperCase()}
                  </Txt>
                  <View style={styles.grid}>
                    {stores.map((s) => (
                      <View key={s.id} style={[styles.storeTile, { backgroundColor: c.surface }]}>
                        <Pressable
                          onPress={() => {
                            selectStore(s.id)
                            setPicking(false)
                          }}
                          style={styles.storeTileMain}
                        >
                          <StoreLogo slug={s.slug} name={s.name} size={28} />
                          <Txt numberOfLines={1} style={{ flex: 1, fontWeight: '500' }}>
                            {s.name}
                          </Txt>
                        </Pressable>
                        <Pressable
                          onPress={() => removeStore(s)}
                          hitSlop={8}
                          accessibilityLabel={t('common.removeName', { name: s.name })}
                        >
                          <X size={16} strokeWidth={2} color={c.textFaint} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Txt variant="label" style={[styles.groupLabel, { color: c.textFaint }]}>
                {t('shopping.allStores').toUpperCase()}
              </Txt>
              <View style={styles.grid}>
                {catalogToAdd.map((e) => (
                  <Pressable
                    key={e.slug}
                    onPress={() => addCatalogStore(e)}
                    style={[styles.storeTile, { backgroundColor: c.surface }]}
                  >
                    <StoreLogo slug={e.slug} name={e.name} size={28} />
                    <Txt numberOfLines={1} style={{ flex: 1, fontWeight: '500' }}>
                      {e.name}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.inputRow}>
              <TextInput
                value={storeInput}
                onChangeText={setStoreInput}
                onSubmitEditing={addCustomStore}
                returnKeyType="done"
                placeholder={t('shopping.otherStore')}
                placeholderTextColor={c.textFaint}
                style={[styles.input, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
              />
              <Pressable
                onPress={addCustomStore}
                disabled={!storeInput.trim()}
                style={[styles.addBtn, { backgroundColor: c.accent, opacity: storeInput.trim() ? 1 : 0.5 }]}
              >
                <Txt style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>
                  {t('common.add')}
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// A pill chip in the store strip. Plain helper so styles stay co-located.
function Chip({
  onPress,
  active,
  c,
  label,
  icon,
  accessibilityLabel,
}: {
  onPress: () => void
  active: boolean
  c: ReturnType<typeof useTheme>['c']
  label: string
  icon?: React.ReactNode
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.accent : c.surface,
          borderColor: c.border,
        },
      ]}
    >
      {icon}
      {label ? (
        <Txt style={{ fontWeight: '600', fontSize: 14, color: active ? '#ffffff' : c.textMuted }}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  countPill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingBottom: 120 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    borderRadius: radius.md,
    paddingHorizontal: sp.lg,
    paddingVertical: 12,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md },
  checkOn: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkOff: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  itemLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  struck: { textDecorationLine: 'line-through' },
  removeBtn: { paddingHorizontal: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    paddingHorizontal: 2,
    paddingTop: sp.md,
    paddingBottom: sp.sm,
  },
  clearBtn: { alignSelf: 'center', paddingVertical: sp.lg },
  addBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  addBar: { paddingHorizontal: sp.lg, paddingTop: sp.sm },
  chips: { gap: sp.sm, paddingBottom: sp.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inputRow: { flexDirection: 'row', gap: sp.sm, marginTop: sp.sm },
  input: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
    fontSize: 16,
  },
  addBtn: {
    borderRadius: radius.md,
    paddingHorizontal: sp.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: sp.lg,
    paddingTop: sp.lg,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.md },
  groupLabel: { textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: sp.sm, marginTop: sp.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  storeTile: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 10,
  },
  storeTileMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.sm },
})
