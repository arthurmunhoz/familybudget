// One budget period's detail. Shows the summary (balance + category breakdown),
// a person filter, sort controls (by date / by amount), a future-entries toggle,
// and the entry list (grouped by day when sorting by date). The bottom bar adds
// an entry or scans a receipt photo. RN port of budget/MonthDetail.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
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
import EntryForm, { type EntryPrefill } from './EntryForm'
import SummaryChart from './SummaryChart'
import { budgetLook } from '@/components/home/palette'
import { GradientBox } from '@/components/home/GradientBox'
import { CameraArt } from './CameraArt'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

type MonthWithBudget = Month & { budgets: { name: string; period: Period } | null }
type SortBy = 'date' | 'amount'

export default function MonthDetail({
  monthId,
  autoAdd = false,
  autoScan = false,
}: {
  monthId: string
  /** True when arriving from the home card's "＋ New entry" (?add=1). */
  autoAdd?: boolean
  /** True when arriving from the home card's scan button (?scan=1). */
  autoScan?: boolean
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
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

  // Cached (stale-while-revalidate) so the period renders instantly on return.
  const {
    data: { month, entries, rules, subcatSuggestions, customCats, overrides, topCategories } = {
      month: null,
      entries: [],
      rules: [],
      subcatSuggestions: {},
      customCats: [],
      overrides: [],
      topCategories: [],
    },
    loading,
    revalidate: load,
  } = useCachedQuery<{
    month: MonthWithBudget | null
    entries: Entry[]
    rules: CategoryRule[]
    subcatSuggestions: Record<string, string[]>
    customCats: CustomCategory[]
    overrides: CategoryOverride[]
    topCategories: string[]
  }>(`month:${monthId}`, async () => {
    const [m, e, r, subs, custom, ovr] = await Promise.all([
      supabase.from('months').select('*, budgets(name, period)').eq('id', monthId).single(),
      supabase.from('entries').select('*').eq('month_id', monthId),
      supabase.from('category_rules').select('keyword, category'),
      // Household-wide usage: feeds both the subcategory autocomplete and the
      // entry form's most-used category chips.
      supabase.from('entries').select('type, category, subcategory'),
      supabase.from('custom_categories').select('*').order('created_at'),
      supabase.from('category_overrides').select('base_id, name, icon'),
    ])

    const counts = new Map<string, Map<string, number>>()
    const catCounts = new Map<string, number>()
    for (const row of (subs.data ?? []) as {
      type: string
      category: string
      subcategory: string | null
    }[]) {
      if (row.type === 'expense' && row.category !== 'salary') {
        catCounts.set(row.category, (catCounts.get(row.category) ?? 0) + 1)
      }
      const key = row.subcategory?.trim()
      if (!key) continue
      if (!counts.has(row.category)) counts.set(row.category, new Map())
      const bucket = counts.get(row.category)!
      const existing = [...bucket.keys()].find((k) => k.toLowerCase() === key.toLowerCase())
      const useKey = existing ?? key
      bucket.set(useKey, (bucket.get(useKey) ?? 0) + 1)
    }
    const map: Record<string, string[]> = {}
    for (const [cat, bucket] of counts) {
      map[cat] = [...bucket.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
    }

    return {
      month: (m.data as MonthWithBudget) ?? null,
      entries: (e.data as Entry[]) ?? [],
      rules: (r.data as CategoryRule[]) ?? [],
      subcatSuggestions: map,
      customCats: (custom.data as CustomCategory[]) ?? [],
      overrides: (ovr.data as CategoryOverride[]) ?? [],
      topCategories: [...catCounts.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x),
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

  // Arriving via the home card's scan button starts the receipt scan once (per
  // mount) as soon as the period has loaded.
  const autoScanDone = useRef(false)
  useEffect(() => {
    if (!autoScan || autoScanDone.current || loading || !month) return
    autoScanDone.current = true
    startScan()
  }, [autoScan, loading, month])

  const period = month?.budgets?.period ?? 'monthly'

  const filtered = useMemo(
    () => (person === 'all' ? entries : entries.filter((e) => e.person_email === person)),
    [entries, person],
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
        body: JSON.stringify({ image: out.base64, media_type: 'image/jpeg' }),
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
                <Txt style={{ fontWeight: '500', color: person === opt.key ? c.accent : c.text }}>{opt.label}</Txt>
                {person === opt.key ? <Check size={16} color={c.accent} /> : null}
              </Pressable>
            ),
          )}
        </View>
      )}

      <ScrollView
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
              active={sortBy === 'date'}
              label={`${t('detail.byDate')} ${dateAsc ? '↑' : '↓'}`}
              onPress={() => (sortBy === 'date' ? setDateAsc((d) => !d) : setSortBy('date'))}
            />
            <SortBtn active={sortBy === 'amount'} label={t('detail.byAmount')} onPress={() => setSortBy('amount')} />
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
                    setFormOpen(true)
                  }}
                  onLongPress={() => removeEntry(e)}
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
                  setFormOpen(true)
                }}
                onLongPress={() => removeEntry(e)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom actions (2026-11 Money rethink): the AI receipt scan as a
          secondary pill, and New entry filled in the budget's own gradient —
          the one loud thing on the screen. In NORMAL FLOW (not an overlay) so
          the list ends at it instead of scrolling underneath. Bottom padding
          is half the home-indicator inset (floored), matching NewItemButton. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: sp.lg,
          paddingTop: sp.sm,
          paddingBottom: Math.max(Math.round(insets.bottom / 2), sp.xs),
        }}
      >
        {/* Scan receipt: a realistic greyscale camera fills the button,
            very transparent, with the label over it — the eye-catcher for the
            AI scan (owner idea). */}
        <Pressable
          onPress={startScan}
          disabled={scanning}
          accessibilityLabel={t('detail.scanAria')}
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
            opacity: scanning ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <CameraArt opacity={dark ? 0.55 : 0.24} />
          {scanning ? <ActivityIndicator color={c.text} /> : null}
          <Txt style={{ fontFamily: fonts.display, fontSize: 15.5, color: c.text }}>{t('detail.scanReceipt')}</Txt>
          {/* The AI mark sits on the button's corner, so the label stays centred. */}
          <Sparkles size={15} color={c.accent} style={{ position: 'absolute', top: 8, right: 10 }} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setEditing(null)
            setPrefill(undefined)
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

      {formOpen && profile && (
        <EntryForm
          monthId={month.id}
          periodStart={month.start_date}
          periodEnd={periodEndISO(period, month.start_date)}
          profiles={profiles}
          myEmail={profile.email}
          rules={rules}
          subcategorySuggestions={subcatSuggestions}
          customCategories={customCats}
          categoryOverrides={overrides}
          topCategories={topCategories}
          onCategoryCreated={load}
          entry={editing}
          initial={prefill}
          onClose={() => {
            setFormOpen(false)
            setPrefill(undefined)
          }}
          onSaved={() => {
            setFormOpen(false)
            setPrefill(undefined)
            load()
          }}
        />
      )}
    </SafeAreaView>
  )
}

function SortBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 9,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: active ? c.action : 'transparent',
      }}
    >
      <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: active ? c.onAction : c.textMuted }}>{label}</Txt>
    </Pressable>
  )
}

function EntryRow({
  entry: e,
  customCats,
  overrides,
  showDate,
  showPerson,
  nameOf,
  onPress,
  onLongPress,
}: {
  entry: Entry
  customCats: CustomCategory[]
  overrides: CategoryOverride[]
  showDate: boolean
  showPerson: boolean
  nameOf: (email: string) => string
  onPress: () => void
  onLongPress: () => void
}) {
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
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: pressed ? c.cardActive : c.card,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        paddingHorizontal: sp.md,
        paddingVertical: 10,
        gap: sp.md,
      })}
    >
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
    </Pressable>
  )
}

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
