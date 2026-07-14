// Money — the module's home. Each budget renders as a card: the budget name +
// a details chevron on top (opens the budget's period history), then a
// divided "overview" section for one period — a labelled balance on the left,
// an in-card period dropdown on the right, received/spent bars, and a
// "＋ New entry" button that deep-links into that period with the form open.
// The dropdown switches which period the section previews. RN app.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Camera, Check, ChevronDown, ChevronRight, Wallet, X } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Field, Loader, Txt } from '@/components/ui'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { usePlus } from '@/lib/plus'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { syncBudgetWidget, type BudgetWidgetItem } from '@/lib/widget'
import { formatMoney, periodEndISO, periodLabel, todayISO } from '@/lib/format'
import type { Budget, Entry, Month, Period } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { Segmented } from './shared'

const PERIODS: Period[] = ['monthly', 'weekly', 'daily']

type EntryLite = Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>

interface MonthStat {
  income: number
  spent: number
  balance: number
  /** Balance once all future-dated entries land; only meaningful if hasUpcoming. */
  expected: number
  hasUpcoming: boolean
}

export default function Budgets() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isPlus } = usePlus()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)

  type HomeData = { budgets: Budget[]; months: Month[]; entries: EntryLite[] }
  // One cached query for the whole home: cards render instantly on return with
  // live balances, then revalidate quietly.
  const {
    data = { budgets: [], months: [], entries: [] },
    loading,
    revalidate: load,
  } = useCachedQuery<HomeData>('budgets:home', async () => {
    const [b, m, e] = await Promise.all([
      supabase.from('budgets').select('*').order('created_at'),
      supabase.from('months').select('*').order('start_date', { ascending: false }),
      supabase.from('entries').select('month_id, type, amount, entry_date'),
    ])
    return {
      budgets: (b.data as Budget[]) ?? [],
      months: (m.data as Month[]) ?? [],
      entries: (e.data as EntryLite[]) ?? [],
    }
  })
  const { budgets, months, entries } = data

  // Per-month stats (for whichever period a card previews) + each budget's own
  // periods (newest-first) and the default one to show (current, else latest).
  const { statsById, byBudget } = useMemo(() => {
    const today = todayISO()
    const byMonth = new Map<string, EntryLite[]>()
    for (const e of entries) {
      const list = byMonth.get(e.month_id)
      if (list) list.push(e)
      else byMonth.set(e.month_id, [e])
    }
    const statsById = new Map<string, MonthStat>()
    const byBudget = new Map<string, { months: Month[]; defaultId: string | null }>()
    for (const b of budgets) {
      const own = months.filter((m) => m.budget_id === b.id) // already newest-first
      let defaultId: string | null = null
      for (const m of own) {
        let income = 0
        let spent = 0
        let comingIn = 0
        let due = 0
        for (const e of byMonth.get(m.id) ?? []) {
          const amount = Number(e.amount)
          if (e.entry_date > today) {
            if (e.type === 'income') comingIn += amount
            else due += amount
          } else if (e.type === 'income') income += amount
          else spent += amount
        }
        const end = periodEndISO(b.period, m.start_date)
        const isCurrent = m.start_date <= today && today <= end
        if (isCurrent && !defaultId) defaultId = m.id
        const balance = income - spent
        statsById.set(m.id, {
          income,
          spent,
          balance,
          expected: balance + comingIn - due,
          hasUpcoming: comingIn > 0 || due > 0,
        })
      }
      byBudget.set(b.id, { months: own, defaultId: defaultId ?? own[0]?.id ?? null })
    }
    return { statsById, byBudget }
  }, [budgets, months, entries])

  // Feed the Home-Screen budget widget: each budget's current-period summary.
  useEffect(() => {
    if (loading) return
    const items: BudgetWidgetItem[] = budgets.map((b) => {
      const defaultId = byBudget.get(b.id)?.defaultId ?? null
      const stat = defaultId ? statsById.get(defaultId) : undefined
      return {
        id: b.id,
        monthId: defaultId,
        name: b.name,
        period: b.period,
        balance: stat?.balance ?? 0,
        income: stat?.income ?? 0,
        spent: stat?.spent ?? 0,
        currency: '$',
      }
    })
    syncBudgetWidget(items)
  }, [loading, budgets, byBudget, statsById])

  // Free households may keep only one budget; Plus is unlimited. The button
  // gates before opening the sheet; the DB trigger is the real backstop.
  const canCreateBudget = isPlus || budgets.length < 1

  function startCreate() {
    if (!canCreateBudget) {
      router.push('/paywall')
      return
    }
    setName('')
    setPeriod('monthly')
    setCreateOpen(true)
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    const { error } = await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    if (error) {
      // Backstop for the server-side free-plan limit (client already gates it).
      if (error.message.includes('free_plan_budget_limit')) router.push('/paywall')
      return
    }
    setName('')
    setPeriod('monthly')
    load()
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('app.budget.name')} icon={<Wallet size={22} color={c.accent} />} />
      </View>

      {loading ? (
        <Loader />
      ) : budgets.length === 0 ? (
        <EmptyState title={t('budget.empty')} subtitle={t('budget.emptyHint')} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 120, gap: sp.md }}
        >
          {budgets.map((b) => {
            const info = byBudget.get(b.id)
            return (
              <BudgetCard
                key={b.id}
                budget={b}
                months={info?.months ?? []}
                defaultId={info?.defaultId ?? null}
                statsById={statsById}
              />
            )
          })}
        </ScrollView>
      )}

      {/* bottom action bar — a minimalist full-width strip: just a hairline
          divider + centered accent label, so creating a budget (a rare action)
          stays quiet but has a big, easy tap target. */}
      <SafeAreaView
        edges={['bottom']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg }}
      >
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={startCreate}
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 18,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            opacity: loading ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 16 }}>
            {t('budget.new')}
          </Txt>
        </Pressable>
      </SafeAreaView>

      {createOpen && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            {/* Tap the dimmed area to dismiss the keyboard. */}
            <Pressable
              onPress={() => Keyboard.dismiss()}
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: sp.lg }}
            >
              {/* Swallow taps so pressing the card doesn't dismiss the keyboard. */}
              <Pressable
                onPress={() => {}}
                style={{ backgroundColor: c.card, borderRadius: 18, padding: sp.lg, gap: sp.md }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Txt variant="h2">{t('budget.newTitle')}</Txt>
                  <Pressable onPress={() => setCreateOpen(false)} hitSlop={10}>
                    <X size={22} color={c.textMuted} />
                  </Pressable>
                </View>

                <Field
                  value={name}
                  onChangeText={setName}
                  placeholder={t('budget.namePlaceholder')}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => name.trim() && create()}
                />

                <View style={{ gap: 6 }}>
                  <Txt variant="label">{t('budget.groupedBy')}</Txt>
                  <Segmented<Period>
                    options={PERIODS.map((p) => ({ id: p, label: t(`budget.${p}` as TKey) }))}
                    value={period}
                    onChange={setPeriod}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                  <Btn title={t('common.cancel')} variant="secondary" onPress={() => setCreateOpen(false)} style={{ flex: 1 }} />
                  <Btn title={t('common.create')} onPress={create} loading={saving} disabled={!name.trim()} style={{ flex: 1 }} />
                </View>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </SafeAreaView>
  )
}

function BudgetCard({
  budget: b,
  months,
  defaultId,
  statsById,
}: {
  budget: Budget
  months: Month[]
  defaultId: string | null
  statsById: Map<string, MonthStat>
}) {
  const { c } = useTheme()
  const { t } = useI18n()

  // Which period this card previews. Defaults to current/latest; resets if the
  // selected one disappears after a revalidate.
  const [selectedId, setSelectedId] = useState<string | null>(defaultId)
  useEffect(() => {
    if (!selectedId || !months.some((m) => m.id === selectedId)) setSelectedId(defaultId)
  }, [defaultId, months, selectedId])

  const selected = months.find((m) => m.id === selectedId) ?? null
  const stats = selected ? statsById.get(selected.id) : undefined
  const { income = 0, spent = 0, balance = 0, expected = 0, hasUpcoming = false } = stats ?? {}
  const barMax = Math.max(income, spent, 1)

  const openHistory = () => router.push(`/budget/${b.id}`)
  const openPeriod = () => selected && router.push(`/budget/${b.id}/${selected.id}`)

  return (
    <Card style={{ gap: sp.md }}>
      {/* title row: budget name + details chevron */}
      <Pressable
        onPress={openHistory}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}
      >
        <Txt style={{ flex: 1, minWidth: 0, fontFamily: fonts.semibold, fontSize: 18 }} numberOfLines={1}>
          {b.name}
        </Txt>
        <ChevronRight size={22} color={c.textFaint} />
      </Pressable>

      {selected ? (
        <View style={{ gap: sp.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md }}>
          {/* overview header: labelled balance (left) + period dropdown (right) */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm }}>
            <Pressable onPress={openPeriod} style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontSize: 12, color: c.textFaint }}>{t('chart.currentBalance')}</Txt>
              <Txt
                style={{
                  fontSize: 22,
                  fontFamily: fonts.semibold,
                  fontVariant: ['tabular-nums'],
                  color: balance >= 0 ? c.income : c.expense,
                }}
              >
                {formatMoney(balance)}
              </Txt>
            </Pressable>
            <PeriodDropdown
              value={selected.id}
              options={months.map((m) => ({ id: m.id, label: periodLabel(b.period, m.start_date) }))}
              onChange={setSelectedId}
            />
          </View>

          {hasUpcoming && (
            <Txt style={{ fontSize: 12, color: c.textMuted }}>
              {t('home.withUpcoming')}{' '}
              <Txt
                style={{
                  fontSize: 12,
                  fontFamily: fonts.semibold,
                  fontVariant: ['tabular-nums'],
                  color: expected >= 0 ? c.income : c.expense,
                }}
              >
                {formatMoney(expected)}
              </Txt>
            </Txt>
          )}

          <View style={{ gap: 6 }}>
            <BarRow label={t('chart.received')} value={income} max={barMax} color={c.income} />
            <BarRow label={t('chart.spent')} value={spent} max={barMax} color={c.expense} />
          </View>

          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('detail.scanAria')}
              onPress={() => selected && router.push(`/budget/${b.id}/${selected.id}?scan=1`)}
              style={({ pressed }) => ({
                width: 46,
                borderRadius: radius.md,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Camera size={20} color={c.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => selected && router.push(`/budget/${b.id}/${selected.id}?add=1`)}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: c.accent,
                borderRadius: radius.md,
                paddingVertical: 11,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14 }}>
                {t('detail.newEntry')}
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={openHistory} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: sp.md }}>
          <Txt variant="muted" style={{ fontSize: 14 }}>
            {t('home.noneYet')}
          </Txt>
        </Pressable>
      )}
    </Card>
  )
}

/** In-card period picker: a pill that opens a dropdown of the budget's periods,
 *  anchored below the pill (measured in-window so it never clips the card). */
function PeriodDropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
}) {
  const { c } = useTheme()
  const ref = useRef<View>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const winW = Dimensions.get('window').width
  const current = options.find((o) => o.id === value)

  const openMenu = () => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setPos({ top: y + h + 6, right: Math.max(8, winW - (x + w)) })
      setOpen(true)
    })
  }

  return (
    <>
      <Pressable
        ref={ref}
        onPress={openMenu}
        hitSlop={6}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          backgroundColor: c.accentSoft,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 6,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: c.accent }}>
          {current?.label ?? ''}
        </Txt>
        <ChevronDown size={12} color={c.accent} strokeWidth={2.5} />
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            style={{
              position: 'absolute',
              top: pos.top,
              right: pos.right,
              minWidth: 180,
              maxHeight: 280,
              backgroundColor: c.card,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <ScrollView>
              {options.map((o) => {
                const active = o.id === value
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => {
                      onChange(o.id)
                      setOpen(false)
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: sp.md,
                      paddingHorizontal: sp.md,
                      paddingVertical: 12,
                      backgroundColor: pressed ? c.surface : 'transparent',
                    })}
                  >
                    <Txt style={{ fontFamily: active ? fonts.semibold : fonts.body, color: active ? c.accent : c.text }}>
                      {o.label}
                    </Txt>
                    {active ? <Check size={16} color={c.accent} /> : null}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

function BarRow({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
      <Txt style={{ width: 64, fontSize: 11, color: c.textMuted }} numberOfLines={1}>
        {label}
      </Txt>
      <View style={{ flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: c.surface }}>
        <View
          style={{
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: color,
            width: `${(value / max) * 100}%`,
          }}
        />
      </View>
      <Txt
        style={{
          width: 64,
          textAlign: 'right',
          fontSize: 11,
          fontVariant: ['tabular-nums'],
          color: c.textMuted,
        }}
      >
        {formatMoney(value)}
      </Txt>
    </View>
  )
}
