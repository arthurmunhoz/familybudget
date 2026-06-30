// One budget period's detail. Shows the summary (balance + category breakdown),
// a person filter, sort controls (by date / by amount), a future-entries toggle,
// and the entry list (grouped by day when sorting by date). The bottom bar adds
// an entry or scans a receipt photo. RN port of budget/MonthDetail.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Camera, Check, ChevronDown } from 'lucide-react-native'

import { AppHeader, Btn, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { categoryById } from '@/lib/categories'
import { formatDay, formatDayHeading, formatMoney, periodEndISO, periodTitle, todayISO } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { CategoryRule, Entry, Month, Period, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import EntryForm, { type EntryPrefill } from './EntryForm'
import SummaryChart from './SummaryChart'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

type MonthWithBudget = Month & { budgets: { name: string; period: Period } | null }
type SortBy = 'date' | 'amount'

export default function MonthDetail({ monthId }: { monthId: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()

  const [month, setMonth] = useState<MonthWithBudget | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [subcatSuggestions, setSubcatSuggestions] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  const [person, setPerson] = useState<string>('all')
  const [personMenuOpen, setPersonMenuOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('date')
  const [dateAsc, setDateAsc] = useState(false)
  const [showFuture, setShowFuture] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [prefill, setPrefill] = useState<EntryPrefill | undefined>(undefined)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(async () => {
    const [m, e, r, subs] = await Promise.all([
      supabase.from('months').select('*, budgets(name, period)').eq('id', monthId).single(),
      supabase.from('entries').select('*').eq('month_id', monthId),
      supabase.from('category_rules').select('keyword, category'),
      supabase.from('entries').select('category, subcategory').not('subcategory', 'is', null),
    ])
    setMonth((m.data as MonthWithBudget) ?? null)
    setEntries((e.data as Entry[]) ?? [])
    setRules((r.data as CategoryRule[]) ?? [])

    // Household-wide subcategory vocabulary (most-used first) for the entry form.
    const counts = new Map<string, Map<string, number>>()
    for (const row of (subs.data ?? []) as { category: string; subcategory: string }[]) {
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
    setSubcatSuggestions(map)
    setLoading(false)
  }, [monthId])

  useEffect(() => {
    load()
  }, [load])

  const period = month?.budgets?.period ?? 'monthly'

  const filtered = useMemo(
    () => (person === 'all' ? entries : entries.filter((e) => e.person_email === person)),
    [entries, person],
  )

  const today = todayISO()
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
          setEntries((list) => list.filter((x) => x.id !== e.id)) // optimistic
          const { error } = await supabase.from('entries').delete().eq('id', e.id)
          if (error) {
            Alert.alert(t('detail.deleteFailed'))
            load()
          } else {
            load()
          }
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
      if (!res.ok) throw new Error(json.error ?? t('detail.scanFailed'))
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
        contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 140, gap: sp.md }}
      >
        <SummaryChart entries={filtered} />

        {/* sort controls */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: sp.sm }}>
          <SortBtn
            active={sortBy === 'date'}
            label={`${t('detail.byDate')} ${dateAsc ? '↑' : '↓'}`}
            onPress={() => (sortBy === 'date' ? setDateAsc((d) => !d) : setSortBy('date'))}
          />
          <SortBtn active={sortBy === 'amount'} label={t('detail.byAmount')} onPress={() => setSortBy('amount')} />
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

      {/* bottom action bar: scan + add */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ flexDirection: 'row', gap: sp.md, paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Pressable
            onPress={startScan}
            disabled={scanning}
            accessibilityLabel={t('detail.scanAria')}
            style={({ pressed }) => ({
              width: 56,
              borderRadius: radius.md,
              backgroundColor: c.surface,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: scanning ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            {scanning ? <ActivityIndicator color={c.text} /> : <Camera size={24} color={c.text} />}
          </Pressable>
          <Btn title={t('detail.newEntry')} onPress={() => { setEditing(null); setPrefill(undefined); setFormOpen(true) }} style={{ flex: 1 }} />
        </View>
      </SafeAreaView>

      {formOpen && profile && (
        <EntryForm
          monthId={month.id}
          periodStart={month.start_date}
          periodEnd={periodEndISO(period, month.start_date)}
          profiles={profiles}
          myEmail={profile.email}
          rules={rules}
          subcategorySuggestions={subcatSuggestions}
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
        borderRadius: radius.sm,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: active ? c.surface2 : c.surface,
      }}
    >
      <Txt style={{ fontSize: 12, fontWeight: '700', color: active ? c.text : c.textFaint }}>{label}</Txt>
    </Pressable>
  )
}

function EntryRow({
  entry: e,
  showDate,
  showPerson,
  nameOf,
  onPress,
  onLongPress,
}: {
  entry: Entry
  showDate: boolean
  showPerson: boolean
  nameOf: (email: string) => string
  onPress: () => void
  onLongPress: () => void
}) {
  const { c } = useTheme()
  const cat = categoryById(e.category)
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
        gap: sp.sm,
        backgroundColor: pressed ? c.cardActive : c.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: sp.md,
        paddingVertical: 12,
      })}
    >
      <Txt style={{ fontSize: 20 }}>{isIncome ? '💵' : cat.icon}</Txt>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '500', fontSize: 14 }} numberOfLines={1}>
          {e.label}
          {e.recurring ? <Txt style={{ color: c.textFaint }}> ↻</Txt> : null}
        </Txt>
        {secondary ? (
          <Txt style={{ fontSize: 11, color: c.textFaint }} numberOfLines={1}>
            {secondary}
          </Txt>
        ) : null}
      </View>
      <Txt
        style={{
          fontWeight: '700',
          fontSize: 14,
          fontVariant: ['tabular-nums'],
          color: isIncome ? c.income : c.textMuted,
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
