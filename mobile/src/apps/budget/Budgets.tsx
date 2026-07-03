// Money — the module's home. Each budget renders as a live dashboard card:
// current-period balance, received/spent bars, an upcoming-entries projection,
// and a "＋ New entry" button that deep-links into the period with the entry
// form already open. Tapping the card opens the current period; the period
// pill opens the budget's history (Months). RN port of the PWA's redesigned
// budget/Budgets.tsx.
import { useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronDown, Wallet, X } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Field, Loader, Txt } from '@/components/ui'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import {
  daysBetweenISO,
  formatMoney,
  periodEndISO,
  periodLabel,
  todayISO,
} from '@/lib/format'
import type { Budget, Entry, Month, Period } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { Segmented } from './shared'

const PERIODS: Period[] = ['monthly', 'weekly', 'daily']

type EntryLite = Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>

interface BudgetStats {
  /** The period shown on the card: the one containing today, else the latest. */
  month: Month | null
  income: number
  spent: number
  balance: number
  /** Balance once all future-dated entries land; only meaningful if hasUpcoming. */
  expected: number
  hasUpcoming: boolean
  /** Days left in the shown period (null when it isn't the current one). */
  daysLeft: number | null
}

export default function Budgets() {
  const { c } = useTheme()
  const { t } = useI18n()

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

  // Per-budget snapshot of the period shown on its card.
  const stats = useMemo(() => {
    const today = todayISO()
    const byMonth = new Map<string, EntryLite[]>()
    for (const e of entries) {
      const list = byMonth.get(e.month_id)
      if (list) list.push(e)
      else byMonth.set(e.month_id, [e])
    }
    const map = new Map<string, BudgetStats>()
    for (const b of budgets) {
      const own = months.filter((m) => m.budget_id === b.id) // already newest-first
      const current = own.find(
        (m) => m.start_date <= today && today <= periodEndISO(b.period, m.start_date),
      )
      const month = current ?? own[0] ?? null
      if (!month) {
        map.set(b.id, {
          month: null, income: 0, spent: 0, balance: 0,
          expected: 0, hasUpcoming: false, daysLeft: null,
        })
        continue
      }
      let income = 0
      let spent = 0
      let comingIn = 0
      let due = 0
      for (const e of byMonth.get(month.id) ?? []) {
        const amount = Number(e.amount)
        if (e.entry_date > today) {
          if (e.type === 'income') comingIn += amount
          else due += amount
        } else if (e.type === 'income') income += amount
        else spent += amount
      }
      const balance = income - spent
      map.set(b.id, {
        month,
        income,
        spent,
        balance,
        expected: balance + comingIn - due,
        hasUpcoming: comingIn > 0 || due > 0,
        daysLeft: current
          ? daysBetweenISO(today, periodEndISO(b.period, current.start_date))
          : null,
      })
    }
    return map
  }, [budgets, months, entries])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    await supabase.from('budgets').insert({ name: trimmed, period })
    setSaving(false)
    setCreateOpen(false)
    setName('')
    setPeriod('monthly')
    load()
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('app.budget.name')} right={<Wallet size={22} color={c.accent} />} />
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
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} stats={stats.get(b.id)} />
          ))}
        </ScrollView>
      )}

      {/* bottom action bar — ghost style: creating a budget is a rare action */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => {
              setName('')
              setPeriod('monthly')
              setCreateOpen(true)
            }}
            style={({ pressed }) => ({
              backgroundColor: c.card,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.accent,
              paddingVertical: 13,
              alignItems: 'center',
              opacity: loading ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 16 }}>
              {t('budget.new')}
            </Txt>
          </Pressable>
        </View>
      </SafeAreaView>

      {createOpen && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: sp.lg }}>
            <View style={{ backgroundColor: c.card, borderRadius: 18, padding: sp.lg, gap: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt variant="h2">{t('budget.newTitle')}</Txt>
                <Pressable onPress={() => setCreateOpen(false)} hitSlop={10}>
                  <X size={22} color={c.textMuted} />
                </Pressable>
              </View>

              <Field value={name} onChangeText={setName} placeholder={t('budget.namePlaceholder')} autoFocus />

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
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

function BudgetCard({ budget: b, stats }: { budget: Budget; stats: BudgetStats | undefined }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const m = stats?.month ?? null
  const { income = 0, spent = 0, balance = 0, expected = 0, hasUpcoming = false } = stats ?? {}
  const daysLeft = stats?.daysLeft ?? null
  const barMax = Math.max(income, spent, 1)

  const openPeriod = () => m && router.push(`/budget/${b.id}/${m.id}`)
  const openHistory = () => router.push(`/budget/${b.id}`)

  return (
    <Card style={{ gap: sp.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <Pressable onPress={m ? openPeriod : openHistory} style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 17 }} numberOfLines={1}>
            {b.name}
          </Txt>
        </Pressable>
        <Pressable
          onPress={openHistory}
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
            {m ? periodLabel(b.period, m.start_date) : t(`budget.${b.period}` as TKey)}
          </Txt>
          <ChevronDown size={12} color={c.accent} strokeWidth={2.5} />
        </Pressable>
      </View>

      {m ? (
        <>
          <Pressable onPress={openPeriod} style={{ gap: 2 }}>
            <Txt
              style={{
                fontSize: 30,
                fontFamily: fonts.display,
                fontVariant: ['tabular-nums'],
                letterSpacing: -0.3,
                color: balance >= 0 ? c.income : c.expense,
              }}
            >
              {formatMoney(balance)}
            </Txt>
            <Txt style={{ fontSize: 12, color: c.textFaint }}>
              {t('home.balanceToday')}
              {daysLeft !== null && daysLeft >= 1 ? ` · ${t('home.daysLeft', { count: daysLeft })}` : ''}
            </Txt>
            {hasUpcoming && (
              <Txt style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
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
            <View style={{ gap: 6, marginTop: sp.sm }}>
              <BarRow label={t('chart.received')} value={income} max={barMax} color={c.income} />
              <BarRow label={t('chart.spent')} value={spent} max={barMax} color={c.expense} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => m && router.push(`/budget/${b.id}/${m.id}?add=1`)}
            style={({ pressed }) => ({
              backgroundColor: c.accent,
              borderRadius: radius.md,
              paddingVertical: 11,
              alignItems: 'center',
              marginTop: sp.xs,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14 }}>
              {t('detail.newEntry')}
            </Txt>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={openHistory}>
          <Txt variant="muted" style={{ fontSize: 14 }}>
            {t('home.noneYet')}
          </Txt>
        </Pressable>
      )}
    </Card>
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
