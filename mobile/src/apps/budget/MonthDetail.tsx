// One budget period's detail. Shows the summary (balance + category breakdown),
// a person filter, sort controls (by date / by amount), a future-entries toggle,
// and the entry list (grouped by day when sorting by date). The bottom bar adds
// an entry or scans a receipt photo. RN port of budget/MonthDetail.tsx.
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Check, ChevronDown, Sparkles } from 'lucide-react-native'

import { AppHeader, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import { categoryById } from '@/lib/categories'
import { formatDay, formatDayHeading, formatMoney, periodEndISO, periodTitle } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type {
  CategoryOverride,
  CategoryRule,
  CustomCategory,
  Entry,
  Month,
  Period,
  Profile,
} from '@/lib/types'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import EntryForm, { type EntryLanding, type EntryPrefill } from './EntryForm'
import { LandingGhost, type GhostRect } from '@/components/LandingGhost'
import SummaryChart from './SummaryChart'
import { useBottomGap } from '@/hooks/useBottomGap'
import { budgetLook } from '@/components/home/palette'
import { GradientBox } from '@/components/home/GradientBox'
import { CameraArt } from './CameraArt'
import { ScanBeam, ScanLabel } from './ScanBeam'
import ReceiptListsSheet from './ReceiptListsSheet'
import { Toast, type ToastData } from '@/components/Toast'
import { checkItemIds, fetchOpenList, uncheckItems } from '@/lib/assistant'
import { matchGroups, scanListPayload, type MatchGroup } from '@/lib/receiptMatches'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

type MonthWithBudget = Month & { budgets: { name: string; period: Period } | null }
type SortBy = 'date' | 'amount'
/** A new entry flying from the closed form into its row (LandingGhost). */
type Landing = { entry: Entry; from: GhostRect; to: GhostRect | null | 'gone'; landed: boolean }

const offset = (r: GhostRect, o: { x: number; y: number }): GhostRect => ({
  x: r.x - o.x,
  y: r.y - o.y,
  width: r.width,
  height: r.height,
})

export default function MonthDetail({
  monthId,
  autoAdd = false,
  autoScan = false,
  openEntryId,
}: {
  monthId: string
  /** True when arriving from the home card's "＋ New entry" (?add=1). */
  autoAdd?: boolean
  /** True when arriving from the home card's scan button (?scan=1). */
  autoScan?: boolean
  /** Open this entry's form once loaded (?entry=<id>). */
  openEntryId?: string
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xs)
  const { profile, profiles } = useAuth()

  const [person, setPerson] = useState<string>('all')
  const [personMenuOpen, setPersonMenuOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [dateAsc, setDateAsc] = useState(false)
  const [showFuture, setShowFuture] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [prefill, setPrefill] = useState<EntryPrefill | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  // Receipt ↔ lists: the open list items the scan matched ride with the
  // prefill and are offered ONLY once that entry is saved (cancel drops them).
  const [scanMatch, setScanMatch] = useState<string[] | null>(null)
  const [listOffer, setListOffer] = useState<MatchGroup[] | null>(null)
  const [listShown, setListShown] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)

  // "Shrinks and lands" (see LandingGhost). The saved row is shown at once from
  // the insert's own result, until the refetch replaces `entries` (identity
  // check — no effect needed), so the ghost has a row to land on immediately.
  const [landing, setLanding] = useState<Landing | null>(null)
  const [pending, setPending] = useState<{ entry: Entry; base: Entry[] } | null>(null)
  const hostRef = useRef<View>(null)
  const hostOrigin = useRef({ x: 0, y: 0 })
  const scrollRef = useRef<ScrollView>(null)
  const scrollBoxRef = useRef<View>(null)
  const scrollY = useRef(0)
  const contentH = useRef(0)
  const landingRowRef = useRef<View>(null)

  // Cached (stale-while-revalidate) so the period renders instantly on return.
  const {
    data: { month, entries, rules, customCats, overrides } = {
      month: null,
      entries: [],
      rules: [],
      customCats: [],
      overrides: [],
    },
    loading,
    revalidate: load,
  } = useCachedQuery<{
    month: MonthWithBudget | null
    entries: Entry[]
    rules: CategoryRule[]
    customCats: CustomCategory[]
    overrides: CategoryOverride[]
  }>(`month:${monthId}`, async () => {
    const [m, e, r, custom, ovr] = await Promise.all([
      supabase.from('months').select('*, budgets(name, period)').eq('id', monthId).single(),
      supabase.from('entries').select('*').eq('month_id', monthId),
      supabase.from('category_rules').select('keyword, category'),
      supabase.from('custom_categories').select('*').order('created_at'),
      supabase.from('category_overrides').select('base_id, name, icon'),
    ])

    return {
      month: (m.data as MonthWithBudget) ?? null,
      entries: (e.data as Entry[]) ?? [],
      rules: (r.data as CategoryRule[]) ?? [],
      customCats: (custom.data as CustomCategory[]) ?? [],
      overrides: (ovr.data as CategoryOverride[]) ?? [],
    }
  })

  // Arriving via the home card's "＋ New entry" opens the form once the period
  // has loaded (once per mount, so closing it doesn't reopen).
  const autoAddDone = useRef(false)
  useEffect(() => {
    if (!autoAdd || autoAddDone.current || loading || !month) return
    autoAddDone.current = true
    setEditing(null)
    setPrefill(undefined)
    setFormOpen(true)
  }, [autoAdd, loading, month])

  // Arriving from a tapped entry elsewhere (a member's Today): that entry's
  // form is open on arrival — derived, not set in an effect — until closed.
  const [autoEntryClosed, setAutoEntryClosed] = useState(false)
  const autoEntry = openEntryId && !autoEntryClosed && !formOpen ? (entries.find((e) => e.id === openEntryId) ?? null) : null

  // Arriving via the home card's scan button starts the receipt scan once (per
  // mount) as soon as the period has loaded.
  const autoScanDone = useRef(false)
  useEffect(() => {
    if (!autoScan || autoScanDone.current || loading || !month) return
    autoScanDone.current = true
    startScan()
  }, [autoScan, loading, month])

  const period = month?.budgets?.period ?? 'monthly'

  const allEntries = useMemo(
    () =>
      // The saved row shows at once: added if new, swapped in if edited.
      pending && pending.base === entries
        ? entries.some((e) => e.id === pending.entry.id)
          ? entries.map((e) => (e.id === pending.entry.id ? pending.entry : e))
          : [...entries, pending.entry]
        : entries,
    [entries, pending],
  )
  const filtered = useMemo(
    () => (person === 'all' ? allEntries : allEntries.filter((e) => e.person_email === person)),
    [allEntries, person],
  )

  // Splits entries into already-spent and still-to-come — see useToday for why
  // this can't be a plain render-time date.
  const today = useToday()
  const futureCount = useMemo(
    () => filtered.filter((e) => e.entry_date > today).length,
    [filtered, today],
  )
  const hideFuture = !showFuture && futureCount > 0

  const sorted = useMemo(() => {
    const list = hideFuture ? filtered.filter((e) => e.entry_date <= today) : filtered
    return [...list].sort((a, b) => {
      if (sortBy === 'amount') return Number(b.amount) - Number(a.amount)
      const cmp = a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at)
      return dateAsc ? cmp : -cmp
    })
  }, [filtered, hideFuture, today, sortBy, dateAsc])

  // Once the new row is rendered: bring it on screen (instantly — the ghost
  // still covers most of the page), measure it, and let the ghost fly there.
  // Not in the list (person filter, future entries hidden) → the ghost fades.
  const landingId = landing && landing.to === null ? landing.entry.id : null
  const landingVisible = landingId != null && sorted.some((e) => e.id === landingId)
  useEffect(() => {
    if (!landingId) return
    const land = (to: GhostRect | 'gone') =>
      setLanding((l) => (l && l.entry.id === landingId && l.to === null ? { ...l, to } : l))
    let cancelled = false
    if (!landingVisible) {
      requestAnimationFrame(() => !cancelled && land('gone'))
      return () => {
        cancelled = true
      }
    }
    const giveUp = setTimeout(() => land('gone'), 1200)
    const measure = () => {
      const row = landingRowRef.current
      const sv = scrollRef.current
      const box = scrollBoxRef.current
      if (cancelled || !row || !sv || !box) return
      row.measureInWindow((rx, ry, rw, rh) => {
        box.measureInWindow((_sx, sy, _sw, sh) => {
          if (cancelled) return
          clearTimeout(giveUp)
          if (!rw || !rh) return land('gone')
          // Off screen: centre it. The target is COMPUTED from the scroll delta
          // (clamped to the content) rather than re-measured — a scrollTo lands
          // a frame or more later, and a measure taken too early reads the old
          // spot. Checked on the simulator: computed y == the row's real y.
          const margin = 12
          let delta = 0
          if (ry < sy + margin || ry + rh > sy + sh - margin) {
            const max = Math.max(0, contentH.current - sh)
            const y = Math.min(max, Math.max(0, scrollY.current + (ry - sy) - (sh - rh) / 2))
            delta = y - scrollY.current
            sv.scrollTo({ y, animated: false })
          }
          land(offset({ x: rx, y: ry - delta, width: rw, height: rh }, hostOrigin.current))
        })
      })
    }
    requestAnimationFrame(measure)
    return () => {
      cancelled = true
      clearTimeout(giveUp)
    }
  }, [landingId, landingVisible])

  function onEntrySaved(l?: EntryLanding) {
    const matched = !editing ? scanMatch : null
    setScanMatch(null)
    setFormOpen(false)
    setAutoEntryClosed(true)
    setPrefill(undefined)
    if (matched?.length) {
      // Re-read the lists: an item bought on another phone while the form
      // was up must not be offered again.
      fetchOpenList()
        .then(({ open, stores }) => {
          const groups = matchGroups(matched, open, stores)
          if (groups.length) setListOffer(groups)
        })
        .catch(() => {})
    }
    if (l) {
      setPending({ entry: l.entry, base: entries })
      setLanding({ entry: l.entry, from: offset(l.rect, hostOrigin.current), to: null, landed: false })
    }
    load()
  }

  // The lists sheet waits for the landing ghost to finish (and a beat for the
  // form's Modal to be fully gone — two Modals overlapping fail on iOS).
  useEffect(() => {
    if (!listOffer || landing || listShown) return
    const timer = setTimeout(() => setListShown(true), 320)
    return () => clearTimeout(timer)
  }, [listOffer, landing, listShown])

  function closeListOffer() {
    setListShown(false)
    setListOffer(null)
  }

  async function removeFromLists(ids: string[]) {
    setListBusy(true)
    try {
      await checkItemIds(ids)
      closeListOffer()
      setToast({
        emoji: '🛒',
        text: ids.length === 1 ? t('receiptLists.doneOne') : t('receiptLists.done', { count: ids.length }),
        action: {
          label: t('receiptLists.undo'),
          onPress: () => {
            uncheckItems(ids)
              .then(() => setToast({ text: t('receiptLists.undone') }))
              .catch(() => Alert.alert(t('receiptLists.failed')))
          },
        },
      })
    } catch {
      Alert.alert(t('receiptLists.failed'))
    } finally {
      setListBusy(false)
    }
  }

  const nameOf = useCallback(
    (email: string) => profiles.find((p) => p.email === email)?.display_name ?? email,
    [profiles],
  )

  function removeEntry(e: Entry) {
    Alert.alert(t('entry.deleteConfirm', { label: e.label }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('entries').delete().eq('id', e.id)
          if (error) Alert.alert(t('detail.deleteFailed'))
          load()
        },
      },
    ])
  }

  // Receipt scan: pick a photo (camera or library), resize + base64, POST to the
  // Vercel scan-receipt endpoint, then prefill a new entry with the result.
  async function scanReceipt(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('detail.scanFailed'))
      return
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (result.canceled || !result.assets[0]) return

    setScanning(true)
    setScanMatch(null)
    // The household's open list items go with the photo, so the same model
    // call can say which ones this purchase bought. Never blocks the scan.
    const listItems = fetchOpenList()
      .then(({ open, stores }) => scanListPayload(open, stores, t('shopping.anywhere')))
      .catch(() => [])
    try {
      const ctx = ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1200 })
      const ref = await ctx.renderAsync()
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true })
      if (!out.base64) throw new Error('no base64')

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(`${API_BASE}/api/scan-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          image: out.base64,
          media_type: 'image/jpeg',
          ...(await listItems.then((li) => (li.length ? { listItems: li } : {}))),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        // Free households hit a monthly scan cap — offer Plus instead of erroring.
        if (json.reason === 'monthly_cap') {
          Alert.alert(t('bill.scanLimitReached'), json.error ?? '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.getPlus'), onPress: () => router.push('/paywall') },
          ])
          return
        }
        throw new Error(json.error ?? t('detail.scanFailed'))
      }
      setEditing(null)
      setPrefill({
        label: json.label,
        amount: json.amount,
        category: json.category,
        subcategory: json.subcategory,
        entry_date: json.date,
      })
      setScanMatch(
        Array.isArray(json.matchedItems) ? json.matchedItems.filter((x: unknown) => typeof x === 'string') : null,
      )
      setFormOpen(true)
    } catch (err) {
      Alert.alert(err instanceof Error ? err.message : t('detail.scanFailed'))
    } finally {
      setScanning(false)
    }
  }

  function startScan() {
    Alert.alert(t('detail.scanTipTitle'), t('detail.scanTipBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('detail.scanTipOpen'), onPress: () => scanReceipt(true) },
      { text: t('common.add'), onPress: () => scanReceipt(false) },
    ])
  }

  if (loading || !month) return <Loader />
  const look = budgetLook(month.budget_id).colors

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={periodTitle(period, month.start_date)}
          onBack={() => (router.canGoBack() ? router.back() : router.replace(`/budget/${month.budget_id}`))}
          right={
            <Pressable
              onPress={() => setPersonMenuOpen((o) => !o)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: c.surface,
                borderRadius: radius.pill,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Txt style={{ fontSize: 13, fontWeight: '600' }}>
                {person === 'all' ? t('common.everyone') : nameOf(person)}
              </Txt>
              <ChevronDown size={14} color={c.textFaint} />
            </Pressable>
          }
        />
      </View>

      {/* person filter dropdown */}
      {personMenuOpen && (
        <View
          style={{
            position: 'absolute',
            right: sp.lg,
            top: 60,
            zIndex: 50,
            backgroundColor: c.card,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: c.border,
            overflow: 'hidden',
            minWidth: 160,
          }}
        >
          {[{ key: 'all', label: t('common.everyone') }, ...profiles.map((p: Profile) => ({ key: p.email, label: p.display_name }))].map(
            (opt) => (
              <Pressable
                key={opt.key}
                onPress={() => {
                  setPerson(opt.key)
                  setPersonMenuOpen(false)
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: sp.md,
                  paddingVertical: 12,
                  backgroundColor: pressed ? c.surface : 'transparent',
                })}
              >
                <Txt style={{ fontWeight: '500', color: person === opt.key ? look[1] : c.text }}>{opt.label}</Txt>
                {person === opt.key ? <Check size={16} color={look[1]} /> : null}
              </Pressable>
            ),
          )}
        </View>
      )}

      {/* Wrapped only so the landing can measure the visible list window. */}
      <View ref={scrollBoxRef} style={{ flex: 1 }} collapsable={false}>
      <ScrollView
        ref={scrollRef}
        onScroll={(ev) => {
          scrollY.current = ev.nativeEvent.contentOffset.y
        }}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => {
          contentH.current = h
        }}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
      >
        <SummaryChart
          entries={filtered}
          customCats={customCats}
          overrides={overrides}
          look={look}
        />

        {/* entries: a heading with the sort as a small segmented control */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
          <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 20 }}>{t('detail.entries')}</Txt>
          <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 12, padding: 3 }}>
            <SortBtn
              tint={look[1]}
              active={sortBy === 'date'}
              label={`${t('detail.byDate')} ${dateAsc ? '↑' : '↓'}`}
              onPress={() => (sortBy === 'date' ? setDateAsc((d) => !d) : setSortBy('date'))}
            />
            <SortBtn tint={look[1]} active={sortBy === 'amount'} label={t('detail.byAmount')} onPress={() => setSortBy('amount')} />
          </View>
        </View>

        {/* future toggle */}
        {futureCount > 0 && (
          <Pressable onPress={() => setShowFuture((s) => !s)} style={{ alignSelf: 'center' }}>
            <Txt style={{ fontSize: 12, color: c.textFaint, textDecorationLine: 'underline' }}>
              {showFuture ? t('detail.hideFuture') : t('detail.showFuture', { count: futureCount })}
            </Txt>
          </Pressable>
        )}

        {/* entries */}
        {sorted.length === 0 ? (
          <Txt style={{ textAlign: 'center', color: c.textFaint, marginTop: sp.lg }}>{t('detail.noEntries')}</Txt>
        ) : sortBy === 'date' ? (
          groupByDay(sorted).map((g) => (
            <View key={g.date} style={{ gap: sp.sm }}>
              <Txt
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: c.textFaint,
                }}
              >
                {formatDayHeading(g.date)}
              </Txt>
              {g.items.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  customCats={customCats}
                  overrides={overrides}
                  showDate={false}
                  showPerson={person === 'all'}
                  nameOf={nameOf}
                  onPress={() => {
                    setEditing(e)
                    setPrefill(undefined)
                    setScanMatch(null)
                    setFormOpen(true)
                  }}
                  onLongPress={() => removeEntry(e)}
                  rowRef={landing?.entry.id === e.id ? landingRowRef : undefined}
                  hidden={landing?.entry.id === e.id && !landing.landed}
                />
              ))}
            </View>
          ))
        ) : (
          <View style={{ gap: sp.sm }}>
            {sorted.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                customCats={customCats}
                overrides={overrides}
                showDate
                showPerson={person === 'all'}
                nameOf={nameOf}
                onPress={() => {
                  setEditing(e)
                  setPrefill(undefined)
                  setScanMatch(null)
                  setFormOpen(true)
                }}
                onLongPress={() => removeEntry(e)}
                rowRef={landing?.entry.id === e.id ? landingRowRef : undefined}
                hidden={landing?.entry.id === e.id && !landing.landed}
              />
            ))}
          </View>
        )}
      </ScrollView>
      </View>

      {/* Bottom actions (2026-11 Money rethink): the AI receipt scan as a
          secondary pill, and New entry filled in the budget's own gradient —
          the one loud thing on the screen. In NORMAL FLOW (not an overlay) so
          the list ends at it instead of scrolling underneath. Bottom padding
          is useBottomGap, matching NewItemButton: half the inset on iOS, the
          WHOLE inset on Android, where the nav bar overlays edge-to-edge (half
          left Scan / New entry partly under it on an S9+). */}
      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: sp.lg,
          paddingTop: sp.sm,
          paddingBottom: bottomGap,
        }}
      >
        {/* Scan receipt: a realistic greyscale camera fills the button,
            very transparent, with the label over it — the eye-catcher for the
            AI scan (owner idea). */}
        <Pressable
          onPress={startScan}
          disabled={scanning}
          accessibilityLabel={scanning ? t('detail.scanning1') : t('detail.scanAria')}
          accessibilityState={{ busy: scanning }}
          style={({ pressed }) => ({
            flex: 0.9,
            height: 56,
            borderRadius: 18,
            borderBottomLeftRadius: sheetRadius,
            backgroundColor: c.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            overflow: 'hidden',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            opacity: pressed && !scanning ? 0.7 : 1,
          })}
        >
          <CameraArt opacity={dark ? 0.55 : 0.24} />
          {scanning ? (
            <>
              <ScanBeam color={look[1]} />
              <ScanLabel color={c.text} style={{ fontFamily: fonts.display, fontSize: 15.5 }} />
            </>
          ) : (
            <Txt style={{ fontFamily: fonts.display, fontSize: 15.5, color: c.text }}>{t('detail.scanReceipt')}</Txt>
          )}
          {/* The AI mark sits on the button's corner, so the label stays centred. */}
          <Sparkles size={15} color={look[1]} style={{ position: 'absolute', top: 8, right: 10 }} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setEditing(null)
            setPrefill(undefined)
            setScanMatch(null)
            setFormOpen(true)
          }}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
        >
          <GradientBox
            colors={look}
            radius={18}
            style={{ height: 56, borderBottomRightRadius: sheetRadius, alignItems: 'center', justifyContent: 'center' }}
          >
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 16 }}>{t('detail.newEntry')}</Txt>
          </GradientBox>
        </Pressable>
      </View>

      {(formOpen || autoEntry) && profile && (
        <EntryForm
          colors={look}
          kicker={periodTitle(period, month.start_date)}
          monthId={month.id}
          periodStart={month.start_date}
          periodEnd={periodEndISO(period, month.start_date)}
          profiles={profiles}
          myEmail={profile.email}
          rules={rules}
          customCategories={customCats}
          categoryOverrides={overrides}
          onCategoryCreated={load}
          entry={autoEntry ?? editing}
          initial={prefill}
          onClose={() => {
            setFormOpen(false)
            setAutoEntryClosed(true)
            setPrefill(undefined)
            setScanMatch(null)
          }}
          onSaved={onEntrySaved}
        />
      )}

      {/* The landing ghost's stage: covers the screen, never takes a touch. */}
      <View
        ref={hostRef}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={() =>
          hostRef.current?.measureInWindow((x, y) => {
            hostOrigin.current = { x, y }
          })
        }
      >
        {landing ? (
          <LandingGhost
            key={landing.entry.id}
            from={landing.from}
            to={landing.to}
            fromColor={c.sheet}
            toColor={c.card}
            borderColor={c.border}
            fromRadius={28}
            toRadius={18}
            glow={look}
            head={<GhostAmount entry={landing.entry} />}
            onLanded={() => setLanding((l) => (l ? { ...l, landed: true } : l))}
            onDone={() => setLanding(null)}
          >
            {/* The ghost box draws the border itself. */}
            <View style={[rowStyles.row, { flex: 1, borderWidth: 0 }]}>
              <EntryRowBody
                entry={landing.entry}
                customCats={customCats}
                overrides={overrides}
                showDate={sortBy !== 'date'}
                showPerson={person === 'all'}
                nameOf={nameOf}
              />
            </View>
          </LandingGhost>
        ) : null}
      </View>

      {listOffer && listShown ? (
        <ReceiptListsSheet groups={listOffer} busy={listBusy} onConfirm={removeFromLists} onClose={closeListOffer} />
      ) : null}
      <Toast data={toast} />
    </SafeAreaView>
  )
}

function SortBtn({ active, label, onPress, tint }: { active: boolean; label: string; onPress: () => void; tint: string }) {
  const { c, dark } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 9,
        paddingHorizontal: 12,
        paddingVertical: 6,
        // A choice, not an action: the budget colour as a soft wash (2026-11).
        backgroundColor: active ? tint + (dark ? '2E' : '1A') : 'transparent',
      }}
    >
      <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: active ? tint : c.textMuted }}>{label}</Txt>
    </Pressable>
  )
}

type RowBodyProps = {
  entry: Entry
  customCats: CustomCategory[]
  overrides: CategoryOverride[]
  showDate: boolean
  showPerson: boolean
  nameOf: (email: string) => string
}

function EntryRow({
  onPress,
  onLongPress,
  rowRef,
  hidden = false,
  ...body
}: RowBodyProps & {
  onPress: () => void
  onLongPress: () => void
  /** Only the row a landing ghost is flying to — it gets measured. */
  rowRef?: Ref<View>
  /** Invisible while the ghost is on its way (it reveals the row on landing). */
  hidden?: boolean
}) {
  const { c } = useTheme()
  return (
    <Pressable
      ref={rowRef}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        rowStyles.row,
        { backgroundColor: pressed ? c.cardActive : c.card, borderColor: c.border, opacity: hidden ? 0 : 1 },
      ]}
    >
      <EntryRowBody {...body} />
    </Pressable>
  )
}

/** The row's content — shared by the list row and the landing ghost, so the
 *  ghost lands looking exactly like what it reveals. */
function EntryRowBody({ entry: e, customCats, overrides, showDate, showPerson, nameOf }: RowBodyProps) {
  const { c } = useTheme()
  const cat = categoryById(e.category, customCats, overrides)
  const isIncome = e.type === 'income'
  const secondary = [
    e.subcategory,
    showDate ? formatDay(e.entry_date) : null,
    showPerson ? nameOf(e.person_email) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 13,
          backgroundColor: isIncome ? c.income + '1F' : c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt style={{ fontSize: 19 }}>{isIncome ? '💵' : cat.icon}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.medium, fontSize: 15 }} numberOfLines={1}>
          {e.label}
          {e.recurring ? <Txt style={{ color: c.textFaint }}> ↻</Txt> : null}
        </Txt>
        {secondary ? (
          <Txt style={{ fontSize: 12.5, color: c.textFaint }} numberOfLines={1}>
            {secondary}
          </Txt>
        ) : null}
      </View>
      {/* Green in, red out — the same two colours as every Money total. */}
      <Txt
        style={{
          fontFamily: fonts.semibold,
          fontSize: 15,
          fontVariant: ['tabular-nums'],
          color: isIncome ? c.income : c.expense,
        }}
      >
        {isIncome ? '+' : '−'}
        {formatMoney(Number(e.amount))}
      </Txt>
    </>
  )
}

/** What the ghost shows while it's still form-sized: the amount, as the
 *  form's hero had it, fading as it shrinks. */
function GhostAmount({ entry }: { entry: Entry }) {
  const { c } = useTheme()
  const isIncome = entry.type === 'income'
  return (
    <Txt
      style={{
        fontSize: 48,
        fontFamily: fonts.display,
        fontVariant: ['tabular-nums'],
        color: isIncome ? c.income : c.expense,
      }}
    >
      {isIncome ? '+' : '−'}
      {formatMoney(Number(entry.amount))}
    </Txt>
  )
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: sp.md,
    paddingVertical: 10,
    gap: sp.md,
  },
})

/** Group an already-sorted list into day sections, preserving order. */
function groupByDay(entries: Entry[]): { date: string; items: Entry[] }[] {
  const groups: { date: string; items: Entry[] }[] = []
  for (const e of entries) {
    const last = groups[groups.length - 1]
    if (last && last.date === e.entry_date) last.items.push(e)
    else groups.push({ date: e.entry_date, items: [e] })
  }
  return groups
}
