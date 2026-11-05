// Shopping List — RN port of the PWA's ShoppingList. Shared, live-synced family
// list: open items first, checked items struck-through below, optimistic
// add/toggle/delete, optional per-store grouping, and Supabase Realtime so an
// edit on another phone shows up here.
//
// 2026-11 rethink (Comando style): a quiet line says how much is left to buy
// (and how much is already in the cart, as a thin amber bar); the stores sit at the TOP as a filter
// — in the shop you pick it and see only its items plus the "anywhere" ones,
// and new items go to it; bought items drop into a collapsible "In the cart"
// section with Clear; rows swipe left to delete (no X on every row) and show
// who added them; the field takes several items at once ("milk, eggs"). RLS scopes everything to the household;
// inserts get household_id / added_by stamped server-side, so the client never
// passes household_id.
//
// OFFLINE: fully supported (RN port of the PWA's outbox, see @/lib/offline).
// Mutations are queued in AsyncStorage and replayed on reconnect; the list stays
// editable and readable with no connection and survives an app restart.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { Pressable } from '@/components/Pressable'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronDown, ChevronLeft, ChevronUp, Pencil, Plus, ShoppingCart, Store, Trash2, X } from 'lucide-react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { memberColor } from '@/lib/calendar'

import { AppHeader, DismissKeyboard, Loader, Txt } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { readCache, useRevalidateOnForeground, writeCache } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import {
  enqueueOp,
  flushShoppingOutbox,
  loadLocal,
  saveLocal,
  LOCAL_ITEMS,
  LOCAL_STORES,
} from '@/lib/offline'
import { supabase } from '@/lib/supabase'
import { STORE_CATALOG, STORE_COLORS, type StoreCatalogEntry } from '@/lib/stores'
import { fetchStoreSuggestions, type SuggestedStore } from '@/lib/storeSuggest'
import type { ShoppingItem, ShoppingStore } from '@/lib/types'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import StoreLogo from './StoreLogo'

// RN has no crypto.randomUUID on all engines — a temp id only needs to be unique
// within this session (it's replaced by the server row on the next refetch).
let tmpCounter = 0
const tempId = () => `tmp-${Date.now()}-${tmpCounter++}`

/** How long the Add button holds its green "added" state. Long enough to read
 *  as a confirmation, short enough to be back to normal before the next item. */
const CONFIRM_MS = 1000

/** The new row's attention pulse: 3 beats of a tint washing in and out. */
const PULSE_IN = 220
const PULSE_OUT = 420
const PULSE_BEATS = 3

/** How long a deleted row takes to slide out. The row stays in `items` for this
 *  long so it has something to animate; the state removal is on a timer, NOT on
 *  the animation's completion callback — a row that unmounts mid-flight (a
 *  refetch, leaving the screen) would never fire it, and the delete would be
 *  visually undone. */
const EXIT_MS = 200

/** Shopping's amber (its home-screen icon), for the progress bar. */
const SHOP_AMBER = '#F5A524'

interface Section {
  id: string
  title: string
  slug: string | null
  color: string | null
  isStore: boolean
  /** The bought (checked) items, in their own collapsible section. */
  isCart?: boolean
  data: ShoppingItem[]
}

export default function ShoppingList() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  // "In the cart" starts folded: while shopping, a ticked item should get out
  // of the way. One tap brings the list back (to untick or check).
  const [cartOpen, setCartOpen] = useState(false)

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

  // Confirming an add. Both of these exist because the list is ALPHABETICAL
  // within each store, so a new item doesn't appear at the end where you're
  // looking — it slides into the middle, often off screen, and adding felt like
  // nothing happened. `justAdded` flashes the button green; `pendingScrollId`
  // is the row to bring into view.
  const [justAdded, setJustAdded] = useState(false)
  // A ref, not state: nothing renders from it, and the effect that consumes it
  // already re-runs on every `sections` change (which an add always causes).
  // Holding it in state would only buy an extra render per add.
  const pendingScrollId = useRef<string | null>(null)
  // Which row is pulsing, tracked by LABEL rather than id — the id is the catch
  // here. A new row carries a temp `tmp-…` id that the refetch a few hundred ms
  // later swaps for the server's uuid, so an id-keyed highlight would drop
  // halfway through the animation (and only when online, which is a horrible
  // thing to debug). The label survives that swap untouched.
  const [pulseLabel, setPulseLabel] = useState<string | null>(null)
  // The pulse's Animated.Value lives HERE, not in the row, for the same id-swap
  // reason: rows are keyed by id, so that swap unmounts and remounts the row
  // mid-pulse. A value owned by the row would restart from nothing each time
  // (and could be left frozen at full tint when the label finally clears);
  // owned by the screen, the animation is simply unaffected by the remount.
  const pulseAnim = useRef(new Animated.Value(0)).current
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null)
  // Rows mid-delete: kept in `items` so they have something to animate out.
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set())
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const listRef = useRef<SectionList<ShoppingItem, Section>>(null)
  // One place to both remember and clean up every animation timer, so leaving
  // the screen mid-animation can't fire a setState into an unmounted tree. Each
  // one drops itself on the way out, so a long shopping session doesn't collect
  // a timer id per tap.
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])
  useEffect(
    () => () => {
      for (const id of timers.current) clearTimeout(id)
      timers.current.clear()
      pulseLoop.current?.stop()
    },
    [],
  )

  /** Pulse the row for `text` and clear the highlight when the beats are done.
   *  Ending on the animation's own callback rather than a timer is what keeps
   *  the tint from being yanked off screen mid-fade. */
  const pulseRow = useCallback(
    (text: string) => {
      pulseLoop.current?.stop()
      pulseAnim.setValue(0)
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: PULSE_IN, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: PULSE_OUT, useNativeDriver: true }),
        ]),
        { iterations: PULSE_BEATS },
      )
      pulseLoop.current = loop
      setPulseLabel(text)
      // Also runs when a second add stops this one early — the guard keeps that
      // from clearing the NEW label the caller has already set.
      loop.start(() => setPulseLabel((cur) => (cur === text ? null : cur)))
    },
    [pulseAnim],
  )

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
  const [customColor, setCustomColor] = useState<string | null>(null)
  // The store sheet's "new custom store" panel (see the third branch in its body).
  const [customOpen, setCustomOpen] = useState(false)

  // The add bar's bottom padding is a CONSTANT, and deliberately so. It used to
  // shrink from the safe-area trim to sp.md while the keyboard was up, driven by
  // keyboardWillShow/Hide listeners — a 5pt change that cost a full re-render of
  // this screen in the middle of the KeyboardAvoidingView's own padding
  // animation. That re-render gave `renderItem` a new identity, so every row in
  // the SectionList re-rendered too, and the whole add bar (store chips included)
  // visibly stuttered on its way up. The keyboard's own frame already covers the
  // home-indicator area, so keeping the trim costs 5pt of gap and nothing else.
  // useBottomGap: half the inset on iOS (what this always was), ALL of it on
  // Android, where the navigation bar hides whatever sits under it.
  const addBarPaddingBottom = useBottomGap(sp.xs)
  // Android doesn't resize the window for the keyboard (edge-to-edge), so the
  // KeyboardAvoidingView below has to lift the bar there too. It measures the
  // keyboard against the bar's frame, which reaches the screen's bottom edge —
  // so the overlap it computes includes the navigation bar the padding above
  // already clears. This offset takes that back out (keeping the sp.xs gap),
  // so the field lands just above the keyboard rather than a bar-height over
  // it. If the window ever does resize, the overlap comes out as 0 and the bar
  // simply sits where layout put it.
  const addBarKeyboardOffset = Platform.OS === 'android' ? -(addBarPaddingBottom - sp.xs) : 0

  // Editing an existing store (rename / recolor / delete) inside the sheet.
  const [editingStore, setEditingStore] = useState<ShoppingStore | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string | null>(null)

  // Location-aware suggestions (AI + IP-geo, cached ~1 week on device). Loaded
  // the first time the store sheet opens; [] falls back to the built-in catalog.
  const [suggestions, setSuggestions] = useState<SuggestedStore[] | null>(null)
  useEffect(() => {
    if (!picking || suggestions !== null) return
    let active = true
    fetchStoreSuggestions().then((s) => {
      if (active) setSuggestions(s)
    })
    return () => {
      active = false
    }
  }, [picking, suggestions])

  // Ids the user just deleted locally. A refetch that was already in flight when
  // they tapped carries a pre-delete snapshot; without this guard its setItems
  // would resurrect the row for a few hundred ms (the "lag" that makes people
  // tap again and delete two). We hide these ids from every server snapshot
  // until the server confirms they're gone, then drop them from the set.
  const pendingRemovals = useRef<Set<string>>(new Set())

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
    if (!itemsRes.error) {
      const data = (itemsRes.data as ShoppingItem[]) ?? []
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

  // Realtime can't cover a reopened app: iOS suspends the process, the socket
  // dies with it, and nothing replays the changes made while it was away — so
  // the list rendered whatever it last saw, however many days ago. This screen
  // holds its own optimistic state rather than a useCachedQuery (which does
  // this internally), so it subscribes to the foreground event directly.
  useRevalidateOnForeground(scheduleLoad)

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
    const parts = label
      .split(/\s*[,;\n]\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (!parts.length || !profile) return
    setLabel('')
    // "milk, eggs, bread" → three items; the last one is the one we scroll to.
    parts.forEach((p) => addOne(p, profile.email))
  }

  function addOne(trimmed: string, me: string) {
    const id = tempId()
    const optimistic: ShoppingItem = {
      id,
      label: trimmed,
      checked: false,
      added_by: me,
      created_at: new Date().toISOString(),
      checked_at: null,
      store_id: activeStoreId,
    }
    setItems((list) => [...list, optimistic])
    void enqueueOp({ k: 'item.add', tempId: id, label: trimmed, store_id: activeStoreId, added_by: me })
    track('shopping.added', { item: trimmed })
    // Confirm it landed three ways: flash the button, scroll the row into view
    // (the effect below, once `sections` has been rebuilt with it), and pulse
    // the row itself — it sorts alphabetically into the middle of the list, so
    // arriving there without a marker still leaves you hunting for it.
    pendingScrollId.current = id
    setJustAdded(true)
    later(() => setJustAdded(false), CONFIRM_MS)
    pulseRow(trimmed)
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
    if (checked) track('shopping.checked', { item: item.label })
    scheduleLoad()
  }

  function remove(item: ShoppingItem) {
    // Guard on the REF, not on exitingIds: two taps in the same frame would both
    // read the same stale state and enqueue the delete twice.
    if (pendingRemovals.current.has(item.id)) return
    pendingRemovals.current.add(item.id)
    // The delete is queued immediately — it's durable and offline-safe from
    // here, whatever the animation does. Only the row's disappearance waits.
    void enqueueOp({ k: 'item.remove', id: item.id })
    track('shopping.removed', { item: item.label })
    setExitingIds((prev) => new Set(prev).add(item.id))
    later(() => {
      setItems((list) => list.filter((i) => i.id !== item.id))
      setExitingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      // Deferred with the removal: a refetch landing mid-animation would drop
      // the row on the spot (pendingRemovals hides it from every server
      // snapshot) and cut the exit short.
      scheduleLoad()
    }, EXIT_MS)
  }

  function clearChecked() {
    const checkedIds = items.filter((i) => i.checked).map((i) => i.id)
    if (!checkedIds.length) return
    checkedIds.forEach((id) => pendingRemovals.current.add(id))
    setItems((list) => list.filter((i) => !i.checked))
    void enqueueOp({ k: 'item.clearChecked' })
    track('shopping.cleared', { count: checkedIds.length })
    scheduleLoad()
  }

  /** Build an offline-friendly store row with a temp id. */
  function newStore(name: string, slug: string | null, color: string | null): ShoppingStore | null {
    if (!profile) return null
    return {
      id: tempId(),
      household_id: profile.household_id,
      name,
      slug,
      color,
      created_at: new Date().toISOString(),
    }
  }

  /** Close the store sheet AND drop whichever sub-panel was open, so reopening
   *  it lands on the list instead of back inside a half-filled form. */
  const closeStoreSheet = useCallback(() => {
    setPicking(false)
    setCustomOpen(false)
    setEditingStore(null)
    setStoreInput('')
    setCustomColor(null)
  }, [])

  /** Back out of the new-store panel to the list, discarding the draft. */
  function closeCustom() {
    setCustomOpen(false)
    setStoreInput('')
    setCustomColor(null)
  }

  /** Shared add path: dedupe by slug/name, optimistic insert, queue, select. */
  function addStore(name: string, slug: string | null, color: string | null) {
    const existing = stores.find(
      (s) =>
        (slug && s.slug === slug) || s.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (existing) {
      selectStore(existing.id)
      closeStoreSheet()
      return
    }
    const store = newStore(name, slug, color)
    if (!store) return
    setStores((prev) => [...prev, store])
    void enqueueOp({ k: 'store.add', tempId: store.id, name, slug, color })
    selectStore(store.id)
    closeStoreSheet()
    scheduleLoad()
  }

  const addCatalogStore = (entry: StoreCatalogEntry) => addStore(entry.name, entry.slug, null)
  const addSuggestedStore = (s: SuggestedStore) => addStore(s.name, null, s.color)

  function addCustomStore() {
    const name = storeInput.trim()
    if (!name) return
    // addStore closes the sheet on success, and closeStoreSheet clears the
    // draft name and colour — no need to reset them here.
    addStore(name, null, customColor)
  }

  function openEditStore(store: ShoppingStore) {
    setEditingStore(store)
    setEditName(store.name)
    setEditColor(store.color)
  }

  function saveStoreEdit() {
    if (!editingStore) return
    const name = editName.trim()
    if (!name) return
    setStores((prev) =>
      prev.map((s) => (s.id === editingStore.id ? { ...s, name, color: editColor } : s)),
    )
    void enqueueOp({ k: 'store.update', id: editingStore.id, name, color: editColor })
    setEditingStore(null)
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
            setEditingStore(null)
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
    const isAnywhere = (i: ShoppingItem) => !i.store_id || !valid.has(i.store_id)
    // A store picked at the top narrows the list to that store + the items
    // that can be bought anywhere.
    const inScope = (i: ShoppingItem) =>
      activeStoreId === null || i.store_id === activeStoreId || isAnywhere(i)
    const byName = (a: ShoppingItem, b: ShoppingItem) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    const open = items.filter((i) => !i.checked && inScope(i))
    const out: Section[] = []
    for (const s of stores) {
      if (activeStoreId && s.id !== activeStoreId) continue
      const data = open.filter((i) => i.store_id === s.id).sort(byName)
      if (data.length)
        out.push({ id: s.id, title: s.name, slug: s.slug, color: s.color, isStore: true, data })
    }
    const anywhere = open.filter(isAnywhere).sort(byName)
    if (anywhere.length)
      out.push({ id: '__any', title: t('shopping.anywhere'), slug: null, color: null, isStore: false, data: anywhere })
    const cart = items.filter((i) => i.checked && inScope(i)).sort(byName)
    if (cart.length)
      out.push({
        id: '__cart',
        title: t('shopping.cartTitle'),
        slug: null,
        color: null,
        isStore: false,
        isCart: true,
        data: cartOpen ? cart : [],
      })
    return out
  }, [items, stores, t, activeStoreId, cartOpen])

  const inScopeOpen = sections.filter((x) => !x.isCart).reduce((n, x) => n + x.data.length, 0)
  const inScopeCart = items.filter(
    (i) => i.checked && (activeStoreId === null || i.store_id === activeStoreId || !stores.some((s) => s.id === i.store_id)),
  ).length
  const storeOpenCount = (id: string) => items.filter((i) => !i.checked && i.store_id === id).length

  // Bring a just-added row into view. Runs off `sections` rather than straight
  // from add(), because at add() time the list hasn't been rebuilt yet and the
  // row has no position to scroll to.
  useEffect(() => {
    const id = pendingScrollId.current
    if (!id) return
    const sectionIndex = sections.findIndex((s) => s.data.some((i) => i.id === id))
    // Not in the list yet — leave the ref set so the next rebuild tries again.
    if (sectionIndex < 0) return
    const pos = sections[sectionIndex].data.findIndex((i) => i.id === id)
    pendingScrollId.current = null
    listRef.current?.scrollToLocation({
      sectionIndex,
      // +1, NOT the item's own index: scrollToLocation flattens sections into
      // one cell list in which each section's header is itemIndex 0, so passing
      // the raw index lands one row short (and 0 scrolls to the header).
      itemIndex: pos + 1,
      viewPosition: 0.5,
      animated: true,
    })
  }, [sections])

  const showHeaders = stores.length > 0
  const activeStore = stores.find((s) => s.id === activeStoreId)
  const catalogToAdd = STORE_CATALOG.filter(
    (e) => !stores.some((s) => s.slug === e.slug),
  ).sort((a, b) => a.name.localeCompare(b.name))
  // AI suggestions not already on the list (matched by name).
  const suggestedToAdd = (suggestions ?? [])
    .filter((sg) => !stores.some((s) => s.name.trim().toLowerCase() === sg.name.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  // A–Z for the picker sheet only. `stores` itself keeps its creation order,
  // which is what the chip row and the list's own store sections are built
  // from — sorting it here would silently reorder the shopping list too.
  const storesAZ = useMemo(
    () => [...stores].sort((a, b) => a.name.localeCompare(b.name)),
    [stores],
  )

  const memberEmails = profiles.map((p) => p.email)
  const renderItem = ({ item }: { item: ShoppingItem }) => {
    const adder = item.added_by !== profile?.email ? profiles.find((p) => p.email === item.added_by) : undefined
    return (
      <SwipeToDelete label={t('common.delete')} onDelete={() => remove(item)}>
        <ItemRowShell
          bg={c.card}
          dim={item.checked}
          // Only an OPEN row pulses: a duplicate label sitting in the cart
          // would otherwise light up alongside the one just added.
          pulseColor={pulseLabel === item.label && !item.checked ? c.accentSoft : null}
          pulseOpacity={pulseAnim}
          exiting={exitingIds.has(item.id)}
        >
          <Pressable
            onPress={() => toggle(item)}
            style={styles.rowMain}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.checked }}
            accessibilityActions={[{ name: 'delete', label: t('common.removeName', { name: item.label }) }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && remove(item)}
          >
            {item.checked ? (
              <View style={[styles.checkOn, { backgroundColor: c.income }]}>
                <Check size={15} strokeWidth={3} color="#ffffff" />
              </View>
            ) : (
              <View style={[styles.checkOff, { borderColor: c.textFaint }]} />
            )}
            <Txt
              numberOfLines={2}
              style={[styles.itemLabel, { color: item.checked ? c.textMuted : c.text }, item.checked && styles.struck]}
            >
              {item.label}
            </Txt>
            {adder ? (
              <View
                accessibilityLabel={t('shopping.addedBy', { name: adder.display_name })}
                style={[styles.adder, { backgroundColor: memberColor(adder.email, memberEmails) + '2A' }]}
              >
                <Txt style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: memberColor(adder.email, memberEmails) }}>
                  {adder.display_name.charAt(0).toUpperCase()}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        </ItemRowShell>
      </SwipeToDelete>
    )
  }

  const renderSectionHeader = ({ section }: { section: Section }) => {
    if (section.isCart) {
      return (
        <View style={[styles.sectionHeader, { marginTop: sp.md }]}>
          <Pressable
            onPress={() => setCartOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: cartOpen }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
          >
            <View style={[styles.cartBadge, { backgroundColor: c.income }]}>
              <Check size={13} strokeWidth={3} color="#fff" />
            </View>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }}>
              {section.title} · {inScopeCart}
            </Txt>
            {cartOpen ? <ChevronUp size={16} color={c.textMuted} /> : <ChevronDown size={16} color={c.textMuted} />}
          </Pressable>
          <Pressable onPress={clearChecked} hitSlop={8} accessibilityRole="button">
            <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 14 }}>{t('shopping.clear')}</Txt>
          </Pressable>
        </View>
      )
    }
    if (!showHeaders) return <View style={{ height: sp.xs }} />
    return (
      <View style={styles.sectionHeader}>
        {section.isStore ? (
          <StoreLogo slug={section.slug} name={section.title} color={section.color} size={22} />
        ) : (
          <ShoppingCart size={18} strokeWidth={2} color={c.textFaint} />
        )}
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: section.isStore ? c.text : c.textMuted }}>
          {section.title}
        </Txt>
        <Txt variant="faint">{section.data.length}</Txt>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      {/* Header + list: a tap on any inert part of either puts the keyboard
          away, which is the only way out now that scrolling doesn't. The add
          bar below is deliberately OUTSIDE it — tapping beside the field you
          are typing in shouldn't close the keyboard. */}
      <DismissKeyboard style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <AppHeader title={t('shopping.title')} />
        </View>

        {/* Progress, quietly: "6 to buy · 2 in the cart" over a thin bar in
            Shopping's amber. (A big gradient panel here was too loud — owner.) */}
        {!loading && items.length > 0 ? (
          <View style={{ paddingHorizontal: sp.lg, gap: 8 }}>
            <Txt style={{ fontSize: 15 }} numberOfLines={1}>
              <Txt style={{ fontSize: 15, fontFamily: fonts.semibold }}>
                {inScopeOpen === 0 ? t('shopping.allDone') : `${inScopeOpen} ${t('shopping.toBuy')}`}
                {activeStore && inScopeOpen ? ` ${t('shopping.atStore', { store: activeStore.name })}` : ''}
              </Txt>
              {inScopeCart > 0 ? (
                <Txt style={{ fontSize: 15, color: c.textMuted }}> · {t('shopping.inCartN', { n: inScopeCart })}</Txt>
              ) : null}
            </Txt>
            {inScopeCart > 0 ? (
              <View style={[styles.progressTrack, { backgroundColor: c.surface }]}>
                <View
                  style={[styles.progressFill, { width: `${(inScopeCart / (inScopeCart + inScopeOpen)) * 100}%` }]}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Stores: a filter for when you're in the shop, and where new items go. */}
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.chips, { paddingHorizontal: sp.lg, paddingTop: sp.md }]}
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
                <Chip onPress={() => selectStore(null)} active={activeStoreId === null} c={c} label={t('common.all')} />
                {stores.map((s) => {
                  const n = storeOpenCount(s.id)
                  return (
                    <Chip
                      key={s.id}
                      onPress={() => selectStore(s.id)}
                      active={activeStoreId === s.id}
                      c={c}
                      icon={<StoreLogo slug={s.slug} name={s.name} color={s.color} size={20} />}
                      label={n ? `${s.name}  ${n}` : s.name}
                    />
                  )
                })}
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
            ref={listRef}
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            // REQUIRED by the scroll-to-added-item above: without getItemLayout,
            // scrollToIndex throws an invariant for any row past the last one
            // measured, and this handler is what turns that into a graceful
            // approximate scroll instead of a red screen.
            onScrollToIndexFailed={(info) => {
              listRef.current
                ?.getScrollResponder()
                ?.scrollTo({ y: info.averageItemLength * info.index, animated: true })
            }}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
            // flex:1 so the list fills the space ABOVE the add bar (which is now
            // in normal flow) — the old `paddingBottom: 220 + inset` was a guess
            // at the overlay's height and hid rows whenever the bar was taller.
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: sp.lg,
              paddingBottom: sp.md,
            }}
            ItemSeparatorComponent={() => <View style={{ height: sp.sm }} />}
            SectionSeparatorComponent={() => <View style={{ height: sp.xs }} />}
            // Scrolling the list does NOT dismiss the keyboard — the whole
            // point of scrolling here is to check what's already on the list
            // while you type the next item. The way out is a tap on anything
            // inert (the DismissKeyboard around the header and list), which
            // still works on a list too full to have a gap left in it: the
            // header is always there. The return key deliberately doesn't
            // dismiss either — `blurOnSubmit={false}` below, so you can rattle
            // off several items in a row.
          />
        )}

      </DismissKeyboard>

      {/* Add bar: store chips + text field, pinned above the keyboard. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={addBarKeyboardOffset}
        style={styles.addBarWrap}
      >
        <View
          style={[
            styles.addBar,
            {
              backgroundColor: c.bg,
              // Hug the bottom edge: on iOS HALF the safe-area inset (floored),
              // the same trim NewItemButton uses, so the row's curved outer
              // corners sit near the screen's own corner instead of floating
              // above the full home-indicator gap; on Android the whole
              // navigation bar. Constant — see addBarPaddingBottom.
              paddingBottom: addBarPaddingBottom,
            },
          ]}
        >
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
                  : t('shopping.addMany')
              }
              placeholderTextColor={c.textFaint}
              style={[styles.input, { backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
            />
            <Pressable
              onPress={add}
              disabled={!label.trim()}
              accessibilityLabel={justAdded ? t('shopping.itemAdded') : t('common.add')}
              style={[
                styles.addBtn,
                {
                  backgroundColor: justAdded ? c.income : c.action,
                  // While confirming, stay at full strength: add() has just
                  // cleared the field, so the usual empty-field dimming would
                  // fade the confirmation the instant it appears.
                  opacity: justAdded || label.trim() ? 1 : 0.5,
                },
              ]}
            >
              {/* The label stays in flow and only goes invisible, with the check
                  drawn over it — so the button keeps the width of the word "Add"
                  in whatever language it's in, and swapping to the check can't
                  resize the text field beside it. */}
              <Txt
                style={{ color: c.onAction, fontWeight: '700', fontSize: 16, opacity: justAdded ? 0 : 1 }}
              >
                {t('common.add')}
              </Txt>
              {justAdded ? (
                <View style={[StyleSheet.absoluteFill, styles.addBtnCheck]}>
                  {/* White on the income green, matching the row checkboxes —
                      c.onAction is for the ACCENT fill, which this isn't. */}
                  <Check size={20} strokeWidth={3} color="#ffffff" />
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Store picker sheet */}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => closeStoreSheet()}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
        <Pressable style={styles.backdrop} onPress={() => closeStoreSheet()}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: insets.bottom + sp.md }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sheetHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Store size={20} strokeWidth={2} color={c.text} />
                <Txt variant="h2">
                  {customOpen ? t('shopping.newStore') : t('shopping.stores')}
                </Txt>
              </View>
              <Pressable onPress={() => closeStoreSheet()} hitSlop={10} accessibilityLabel={t('common.close')}>
                <X size={20} strokeWidth={2} color={c.textMuted} />
              </Pressable>
            </View>

            {customOpen ? (
              /* ── New custom store: the same focused panel shape as editing
                    one, so both ways of getting a store take you to the same
                    place instead of one being a row at the bottom of a list. ── */
              <View style={{ gap: sp.md, paddingBottom: sp.md }}>
                <Pressable
                  onPress={closeCustom}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }}
                >
                  <ChevronLeft size={18} color={c.textMuted} />
                  <Txt variant="muted">{t('shopping.stores')}</Txt>
                </Pressable>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  {/* Live preview, same as editing: the monogram picks up the
                      name and colour as they're typed. */}
                  <StoreLogo slug={null} name={storeInput || '?'} color={customColor} size={40} />
                  <TextInput
                    value={storeInput}
                    onChangeText={setStoreInput}
                    onSubmitEditing={addCustomStore}
                    returnKeyType="done"
                    autoFocus
                    placeholder={t('shopping.storeName')}
                    placeholderTextColor={c.textFaint}
                    style={[styles.panelInput, { flex: 1, backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
                  />
                </View>

                <Txt variant="label">{t('shopping.color')}</Txt>
                <ColorDots value={customColor} onChange={setCustomColor} c={c} />

                <Pressable
                  onPress={addCustomStore}
                  disabled={!storeInput.trim()}
                  style={[
                    styles.panelBtnDocked,
                    { backgroundColor: c.action, opacity: storeInput.trim() ? 1 : 0.5 },
                  ]}
                >
                  <Txt style={{ color: c.onAction, fontWeight: '700', fontSize: 16 }}>
                    {t('common.add')}
                  </Txt>
                </Pressable>
              </View>
            ) : editingStore ? (
              /* ── Edit a store: rename, recolor, delete ── */
              <View style={{ gap: sp.md, paddingBottom: sp.md }}>
                <Pressable
                  onPress={() => setEditingStore(null)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' }}
                >
                  <ChevronLeft size={18} color={c.textMuted} />
                  <Txt variant="muted">{t('shopping.stores')}</Txt>
                </Pressable>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <StoreLogo
                    slug={editingStore.slug}
                    name={editName || editingStore.name}
                    color={editColor}
                    size={40}
                  />
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    placeholder={t('shopping.storeName')}
                    placeholderTextColor={c.textFaint}
                    style={[styles.panelInput, { flex: 1, backgroundColor: c.surface, color: c.text, borderColor: c.border }]}
                  />
                </View>

                <Txt variant="label">{t('shopping.color')}</Txt>
                <ColorDots value={editColor} onChange={setEditColor} c={c} />

                <Pressable
                  onPress={saveStoreEdit}
                  disabled={!editName.trim()}
                  style={[
                    styles.panelBtn,
                    { backgroundColor: c.action, opacity: editName.trim() ? 1 : 0.5 },
                  ]}
                >
                  <Txt style={{ color: c.onAction, fontWeight: '700', fontSize: 16 }}>
                    {t('common.save')}
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => removeStore(editingStore)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}
                >
                  <Trash2 size={16} color={c.expense} />
                  <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('shopping.deleteStore')}</Txt>
                </Pressable>
              </View>
            ) : (
              <>
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
                        {storesAZ.map((s) => (
                          <View key={s.id} style={[styles.storeTile, { backgroundColor: c.surface }]}>
                            <Pressable
                              onPress={() => {
                                selectStore(s.id)
                                closeStoreSheet()
                              }}
                              style={styles.storeTileMain}
                            >
                              <StoreLogo slug={s.slug} name={s.name} color={s.color} size={28} />
                              <Txt numberOfLines={1} style={{ flex: 1, fontWeight: '500' }}>
                                {s.name}
                              </Txt>
                            </Pressable>
                            <Pressable
                              onPress={() => openEditStore(s)}
                              hitSlop={8}
                              accessibilityLabel={`${t('shopping.editStore')}: ${s.name}`}
                            >
                              <Pencil size={15} strokeWidth={2} color={c.textFaint} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  {/* AI, location-aware suggestions (loading → dots; empty → hidden) */}
                  {suggestions === null || suggestedToAdd.length > 0 ? (
                    <>
                      <Txt variant="label" style={[styles.groupLabel, { color: c.textFaint }]}>
                        {t('shopping.suggested').toUpperCase()}
                      </Txt>
                      {suggestions === null ? (
                        <Txt variant="faint" style={{ paddingVertical: sp.sm }}>
                          …
                        </Txt>
                      ) : (
                        <View style={styles.grid}>
                          {suggestedToAdd.map((sg) => (
                            <Pressable
                              key={sg.name}
                              onPress={() => addSuggestedStore(sg)}
                              style={[styles.storeTile, { backgroundColor: c.surface }]}
                            >
                              <StoreLogo slug={null} name={sg.name} color={sg.color} size={28} />
                              <Txt numberOfLines={1} style={{ flex: 1, fontWeight: '500' }}>
                                {sg.name}
                              </Txt>
                            </Pressable>
                          ))}
                        </View>
                      )}
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

                {/* Custom store: a button, not a live name field. Sitting open
                    at the foot of the sheet it read as one more row of the
                    catalogue above it rather than a separate action, and it
                    put a keyboard over the list you were still browsing. */}
                <Pressable
                  onPress={() => setCustomOpen(true)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    marginTop: sp.sm,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: c.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Plus size={16} strokeWidth={2.5} color={c.accent} />
                  <Txt style={{ color: c.accent, fontWeight: '700' }}>{t('shopping.customStore')}</Txt>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

/** Swipe a row left to reveal Delete (one tap removes it — the list is cheap
 *  to rebuild and the row slides out, so no confirm). Module scope. */
function SwipeToDelete({ label, onDelete, children }: { label: string; onDelete: () => void; children: React.ReactNode }) {
  const { c } = useTheme()
  const ref = useRef<Swipeable>(null)
  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            ref.current?.close()
            onDelete()
          }}
          accessibilityLabel={label}
          style={[styles.swipeDelete, { backgroundColor: c.expense }]}
        >
          <Trash2 size={20} color="#fff" />
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  )
}

/** The item row's outer box and its two animations: the add pulse (a tint
 *  washing in and out behind the content) and the delete exit (slides right and
 *  fades, the direction the ✕ implies).
 *
 *  The pulse is deliberately NOT the shared `Pulse` from locationUi: that one
 *  fades its child's opacity to 0.3, which on a list row reads as the row being
 *  disabled or removed — the opposite of "look here". The tint leaves the
 *  content at full strength and animates a colour behind it. It's absolutely
 *  positioned so it can't affect layout, drawn before the content so it sits
 *  behind it, and animates opacity only so it can run on the native driver
 *  (backgroundColor can't).
 *
 *  Module scope, never inside ShoppingList's body: a component defined in a
 *  render body gets a new identity every render, so React would remount it and
 *  restart whatever was playing. */
function ItemRowShell({
  bg,
  dim,
  pulseColor,
  pulseOpacity,
  exiting,
  children,
}: {
  bg: string
  dim: boolean
  pulseColor: string | null
  pulseOpacity: Animated.Value
  exiting: boolean
  children: React.ReactNode
}) {
  // 0 = at rest, 1 = fully gone.
  const exit = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!exiting) return
    Animated.timing(exit, {
      toValue: 1,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start()
  }, [exiting, exit])

  // Checked rows are already dimmed, so the exit fades from THAT down to 0
  // rather than snapping back to full opacity to start.
  const base = dim ? 0.6 : 1
  return (
    <Animated.View
      style={[
        styles.row,
        {
          backgroundColor: bg,
          opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [base, 0] }),
          transform: [
            { translateX: exit.interpolate({ inputRange: [0, 1], outputRange: [0, 48] }) },
          ],
        },
      ]}
    >
      {pulseColor ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: pulseColor, borderRadius: radius.md, opacity: pulseOpacity },
          ]}
        />
      ) : null}
      {children}
    </Animated.View>
  )
}

// Color swatch row for store tiles. First dot = "auto" (null → catalog color
// or neutral monogram); the rest are the preset palette. Selection = ring.
function ColorDots({
  value,
  onChange,
  c,
  compact,
}: {
  value: string | null
  onChange: (color: string | null) => void
  c: ReturnType<typeof useTheme>['c']
  compact?: boolean
}) {
  const size = compact ? 24 : 30
  const dot = (col: string | null) => {
    const selected = value === col
    return (
      <Pressable
        key={col ?? 'auto'}
        onPress={() => onChange(col)}
        accessibilityRole="button"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: col ?? c.surface2,
          borderWidth: selected ? 3 : col ? 0 : StyleSheet.hairlineWidth,
          borderColor: selected ? c.text : c.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!col ? (
          <Txt style={{ fontSize: compact ? 10 : 12, color: c.textMuted, fontWeight: '600' }}>A</Txt>
        ) : null}
      </Pressable>
    )
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? 6 : sp.sm, marginTop: compact ? sp.sm : 0 }}>
      {dot(null)}
      {STORE_COLORS.map((col) => dot(col))}
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
          backgroundColor: active ? c.action : c.surface,
          borderColor: c.border,
        },
      ]}
    >
      {icon}
      {label ? (
        <Txt style={{ fontWeight: '600', fontSize: 14, color: active ? c.onAction : c.textMuted }}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  countPill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  // No paddingBottom offset: the add bar is in normal flow now, so this centres
  // in the space that's actually left rather than compensating for an overlay.
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    borderRadius: 18,
    paddingHorizontal: sp.md,
    paddingVertical: 13,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.md },
  checkOn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  checkOff: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  itemLabel: { flex: 1, fontSize: 16.5, fontFamily: fonts.medium },
  adder: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  swipeDelete: { width: 76, marginLeft: sp.sm, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cartBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: SHOP_AMBER },
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
  // NORMAL flow, not an absolute overlay: the bottom of the screen is reserved
  // for the stores + add field, so the list ends AT the bar instead of sliding
  // under it. (It used to be `position: 'absolute'` over the list, relying on
  // the bar's own background to hide what passed beneath — but that background
  // is `c.bg`, which the glass skin makes TRANSPARENT, so the list showed right
  // through it.) KeyboardAvoidingView still lifts it above the keyboard: its
  // padding grows, and the flex:1 list shrinks to match.
  addBarWrap: {},
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
  // The row sits at the foot of the screen, so its OUTER bottom corners follow
  // the iPhone's own curve (sheetRadius; square on Android). Only the outer
  // ones — the two facing each other across the gap stay at radius.md, since
  // they don't meet a screen edge and curving them would read as two lozenges.
  input: {
    flex: 1,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: sheetRadius,
    borderBottomRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
    fontSize: 16,
  },
  addBtn: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: sheetRadius,
    paddingHorizontal: sp.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The same field and button INSIDE the store sheet's panels. `input`/`addBtn`
  // above each carry a screen-curve radius (sheetRadius, ~40) on the one corner
  // that meets the display's own rounded corner down in the add bar. Nothing in
  // a sheet meets a screen edge, so reusing them there just produced one
  // oversized corner per control — the field bulging at the bottom-left, the
  // button at the bottom-right.
  panelInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.lg,
    paddingVertical: 14,
    fontSize: 16,
  },
  panelBtn: {
    borderRadius: radius.md,
    paddingHorizontal: sp.xl,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A panel button that IS the last thing in the sheet, so its bottom edge sits
  // against the screen's own curve — both bottom corners follow it, the same
  // shape Btn's `curveBottom` and NewItemButton use. iPhone only: sheetRadius
  // falls back to the plain large radius on Android, whose screens are square.
  // Only for a button that's genuinely last — the edit panel's Save has a
  // Delete beneath it and stays evenly rounded.
  panelBtnDocked: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: sheetRadius,
    borderBottomRightRadius: sheetRadius,
    paddingHorizontal: sp.xl,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnCheck: { alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: sp.lg,
    paddingTop: sp.lg,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.md },
  groupLabel: { textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: sp.sm, marginTop: sp.sm },
  // One store per row, not a two-column wrap: names are the thing you scan
  // here, and in two columns they truncate and read in a Z rather than
  // straight down an alphabetical list.
  grid: { gap: sp.sm },
  storeTile: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 10,
  },
  storeTileMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.sm },
})
