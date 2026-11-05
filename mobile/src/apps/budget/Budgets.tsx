// Money — the module's home. Each budget renders as a bold gradient card
// (2026-11 "Comando" restyle — each budget keeps one gradient, `budgetLook`,
// on every Money screen, so two budgets read as two things): the name + a details chevron on top (opens the
// budget's period history), then one period's overview — the balance large,
// an in-card period dropdown, received/spent as two translucent chips with a
// bar each, and a white "＋ New entry" button that deep-links into that period
// with the form open (the camera next to it opens the receipt scan). The
// dropdown switches which period the card previews. RN app.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Camera, Check, ChevronDown, ChevronRight, Lock } from 'lucide-react-native'

import { AppHeader, Btn, EmptyState, Loader, NewItemButton, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { BUDGET_GRADIENTS, budgetLook } from '@/components/home/palette'
import { StatChip } from './StatChip'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import { track } from '@/lib/analytics'
import { usePlus } from '@/lib/plus'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { syncBudgetWidget, type BudgetWidgetItem } from '@/lib/widget'
import { BudgetAccessSheet } from './BudgetAccessSheet'
import { formatMoney, periodEndISO, periodLabel } from '@/lib/format'
import type { Budget, Entry, Month, Period } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { FormSection, NoteRow, Segmented, ToggleRow } from '@/components/form'
import { FormSheet } from './FormSheet'

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
  const { isPlus, isFree } = usePlus()

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [isPrivate, setIsPrivate] = useState(false)
  const [saving, setSaving] = useState(false)
  // Which private budget's "who can view" sheet is open.
  const [accessFor, setAccessFor] = useState<Budget | null>(null)

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
  // Decides which period is "current" and splits entries into spent-so-far vs
  // still-coming. A date read once at render froze that split on whatever day
  // the app was last used, so a period that had since ended still showed as the
  // current one. See useToday.
  const today = useToday()

  // Refetch whenever this screen comes back into focus. useCachedQuery only
  // fetches on MOUNT, and expo-router keeps the previous screen mounted while a
  // new one is pushed — so returning from Months after deleting/renaming a
  // budget showed the stale cached list forever. Same pattern as TodaySection.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  // Per-month stats (for whichever period a card previews) + each budget's own
  // periods (newest-first) and the default one to show (current, else latest).
  const { statsById, byBudget } = useMemo(() => {
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
  }, [budgets, months, entries, today])

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

  // Free households may keep only one budget; Plus is unlimited. Keyed on
  // isFree, NOT !isPlus: the entitlement resolves asynchronously, so `!isPlus`
  // is briefly true for a PAYING user — which would badge the button and, worse,
  // push them to the paywall on tap. While the plan is still unknown we stay
  // permissive; the DB trigger is the real limit and create() already routes to
  // the paywall on free_plan_budget_limit, so a free user still lands right.
  const overFreeLimit = isFree && budgets.length >= 1
  const canCreateBudget = !overFreeLimit

  function startCreate() {
    if (!canCreateBudget) {
      router.push('/paywall')
      return
    }
    setName('')
    setPeriod('monthly')
    setIsPrivate(false)
    setCreateOpen(true)
  }

  async function create() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    // owner_email + household_id are stamped by column defaults; visibility is
    // only sent when private so a non-Plus insert stays byte-identical to before.
    const { error } = await supabase
      .from('budgets')
      .insert({ name: trimmed, period, ...(isPrivate ? { visibility: 'private' as const } : {}) })
    setSaving(false)
    setCreateOpen(false)
    if (error) {
      // Backstop for the server-side free-plan limit (client already gates it).
      if (error.message.includes('free_plan_budget_limit')) router.push('/paywall')
      return
    }
    track('budget.created', { name: trimmed, period, private: isPrivate })
    setName('')
    setPeriod('monthly')
    load()
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('app.budget.name')} />
      </View>

      {loading ? (
        <Loader />
      ) : budgets.length === 0 ? (
        <EmptyState title={t('budget.empty')} subtitle={t('budget.emptyHint')} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
        >
          {budgets.map((b) => {
            const info = byBudget.get(b.id)
            return (
              <BudgetCard
                key={b.id}
                look={budgetLook(b.id)}
                budget={b}
                months={info?.months ?? []}
                defaultId={info?.defaultId ?? null}
                statsById={statsById}
                onAccess={() => setAccessFor(b)}
              />
            )
          })}
        </ScrollView>
      )}

      {/* bottom action bar — a minimalist full-width strip: just a hairline
          divider + centered accent label, so creating a budget (a rare action)
          stays quiet but has a big, easy tap target. */}
      {/* Bottom action in NORMAL flow — the branch above is flex:1, so this
          stays pinned to the bottom and the list ends AT it, never under it. */}
      {/* Sparkles when a free household has used its one budget — the gate is
          visible before the tap, not a surprise paywall after it. */}
      <NewItemButton
        label={t('budget.new')}
        onPress={startCreate}
        disabled={loading}
        plus={overFreeLimit}
      />

      {createOpen && (
        <NewBudgetSheet
          name={name}
          onName={setName}
          period={period}
          onPeriod={setPeriod}
          isPrivate={isPrivate}
          onPrivate={setIsPrivate}
          showPrivate={isPlus}
          saving={saving}
          onCreate={create}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {accessFor ? (
        <BudgetAccessSheet budget={accessFor} onClose={() => setAccessFor(null)} />
      ) : null}
    </SafeAreaView>
  )
}

/** The "New budget" sheet (2026-11 form redesign): name, grouping as a
 *  segmented switch, and — Plus only — the private toggle; Create is docked.
 *  Only offered to Plus members — the DB rejects private anyway
 *  (budgets_plus_guard, migration 058). */
function NewBudgetSheet({
  name,
  onName,
  period,
  onPeriod,
  isPrivate,
  onPrivate,
  showPrivate,
  saving,
  onCreate,
  onClose,
}: {
  name: string
  onName: (v: string) => void
  period: Period
  onPeriod: (p: Period) => void
  isPrivate: boolean
  onPrivate: (v: boolean) => void
  showPrivate: boolean
  saving: boolean
  onCreate: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <FormSheet
      title={t('budget.newTitle')}
      onClose={onClose}
      footer={<Btn title={t('common.create')} onPress={onCreate} loading={saving} disabled={!name.trim()} />}
    >
      <FormSection>
        {/* Label on top, full-width input: the example placeholder is long. */}
        <NoteRow
          label={t('budget.nameLabel' as TKey)}
          value={name}
          onChangeText={onName}
          placeholder={t('budget.namePlaceholder')}
          multiline={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && onCreate()}
        />
      </FormSection>

      <FormSection title={t('budget.groupedBy')}>
        <View style={{ padding: sp.sm }}>
          <Segmented<Period>
            options={PERIODS.map((p) => ({ value: p, label: t(`budget.${p}` as TKey) }))}
            value={period}
            onChange={onPeriod}
          />
        </View>
      </FormSection>

      {showPrivate ? (
        <FormSection>
          <ToggleRow
            label={t('budget.private')}
            hint={t('budget.privateHint')}
            value={isPrivate}
            onValueChange={onPrivate}
          />
        </FormSection>
      ) : null}
    </FormSheet>
  )
}


function BudgetCard({
  budget: b,
  look,
  months,
  defaultId,
  statsById,
  onAccess,
}: {
  budget: Budget
  look: (typeof BUDGET_GRADIENTS)[number]
  months: Month[]
  defaultId: string | null
  statsById: Map<string, MonthStat>
  onAccess: () => void
}) {
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
    <GradientBox colors={look.colors} radius={28} style={{ padding: 18, gap: 14 }}>
      {/* title row: budget name (+ private chip) + details chevron */}
      <Pressable onPress={openHistory} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <Txt style={{ flex: 1, minWidth: 0, fontFamily: fonts.display, fontSize: 20, color: '#fff' }} numberOfLines={1}>
          {b.name}
        </Txt>
        {/* Private budgets say so, and the chip IS the way in to the access
            list. Household budgets show nothing — they're unchanged. */}
        {b.visibility === 'private' ? (
          <Pressable
            onPress={onAccess}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [s.glassChip, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Lock size={12} color="#fff" />
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 11 }}>{t('budget.whoCanView')}</Txt>
          </Pressable>
        ) : null}
        <ChevronRight size={22} color="rgba(255,255,255,0.85)" />
      </Pressable>

      {selected ? (
        <>
          {/* balance (left, big) + period dropdown (right) */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm }}>
            <Pressable onPress={openPeriod} style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>{t('chart.currentBalance')}</Txt>
              <Txt
                adjustsFontSizeToFit
                numberOfLines={1}
                style={{ fontSize: 38, lineHeight: 44, fontFamily: fonts.display, color: '#fff', fontVariant: ['tabular-nums'], letterSpacing: -0.6 }}
              >
                {formatMoney(balance)}
              </Txt>
            </Pressable>
            <PeriodDropdown
              onColor
              value={selected.id}
              options={months.map((m) => ({ id: m.id, label: periodLabel(b.period, m.start_date) }))}
              onChange={setSelectedId}
            />
          </View>

          {hasUpcoming && (
            <Txt style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginTop: -8 }}>
              {t('home.withUpcoming')}{' '}
              <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'], color: '#fff' }}>
                {formatMoney(expected)}
              </Txt>
            </Txt>
          )}

          {/* received / spent */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatChip label={t('chart.received')} value={income} max={barMax} up />
            <StatChip label={t('chart.spent')} value={spent} max={barMax} />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('detail.scanAria')}
              onPress={() => selected && router.push(`/budget/${b.id}/${selected.id}?scan=1`)}
              style={({ pressed }) => [s.camera, { opacity: pressed ? 0.75 : 1 }]}
            >
              <Camera size={21} color="#fff" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => selected && router.push(`/budget/${b.id}/${selected.id}?add=1`)}
              style={({ pressed }) => [s.newEntry, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Txt style={{ color: look.ink, fontFamily: fonts.semibold, fontSize: 15 }}>{t('detail.newEntry')}</Txt>
            </Pressable>
          </View>
        </>
      ) : (
        <Pressable onPress={openHistory}>
          <Txt style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>{t('home.noneYet')}</Txt>
        </Pressable>
      )}
    </GradientBox>
  )
}

/** In-card period picker: a pill that opens a dropdown of the budget's periods,
 *  anchored below the pill (measured in-window so it never clips the card). */
function PeriodDropdown({
  value,
  options,
  onChange,
  onColor,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  /** Sitting on a gradient card: translucent white pill, white text. */
  onColor?: boolean
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
          backgroundColor: onColor ? 'rgba(255,255,255,0.2)' : c.accentSoft,
          borderRadius: radius.pill,
          paddingHorizontal: 12,
          paddingVertical: 6,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: onColor ? '#fff' : c.accent }}>
          {current?.label ?? ''}
        </Txt>
        <ChevronDown size={12} color={onColor ? '#fff' : c.accent} strokeWidth={2.5} />
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
              backgroundColor: c.sheet,
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

const s = StyleSheet.create({
  glassChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  camera: {
    width: 52,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newEntry: { flex: 1, height: 50, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
})
