// A budget's periods ("months" historically — each row is one period: a month,
// week, or day per the budget's grouping). Lists periods newest-first with a
// to-date balance, opens one on tap, and creates a new period via a sheet that
// suggests the current/next period and copies recurring entries forward. The
// header menu renames or deletes the budget. RN port of budget/Months.tsx.
import { useCallback, useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react-native'

import {
  AppHeader,
  Btn,
  Card,
  EmptyState,
  Loader,
  NewItemButton,
  Txt,
} from '@/components/ui'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useToday } from '@/hooks/useToday'
import { track } from '@/lib/analytics'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import {
  addDaysISO,
  currentPeriodStart,
  daysBetweenISO,
  formatMoney,
  nextPeriodStart,
  periodLabel,
  periodLengthDays,
  prevPeriodStart,
} from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Budget, Entry, Month, Period } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { TrendCard, type TrendPoint } from './TrendCard'
import { budgetLook, type Gradient } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { GradientBox } from '@/components/home/GradientBox'
import { FormSection, NoteRow, RowIcon } from '@/components/form'
import { BudgetIconPicker } from './BudgetIconPicker'
import { budgetIcon } from './budgetIcons'
import { FormSheet } from './FormSheet'
import { BudgetAccessSheet } from './BudgetAccessSheet'
import { DatePickerModal } from './shared'

// Period-specific i18n key suffix (month/week/day).
const CAP: Record<Period, string> = { monthly: 'Month', weekly: 'Week', daily: 'Day' }

type EntryBalance = Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>

export default function Months({ budgetId }: { budgetId: string }) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.xl)
  const { t, lang } = useI18n()
  const { profile } = useAuth()
  const { isPlus } = usePlus()

  const [creating, setCreating] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [pickStart, setPickStart] = useState('')

  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('💰')
  const [saving, setSaving] = useState(false)
  // "Who can view" sheet + visibility-change guard.
  const [accessOpen, setAccessOpen] = useState(false)
  const [visBusy, setVisBusy] = useState(false)

  const {
    data: { budget, months, entries } = { budget: null, months: [], entries: [] },
    loading,
    revalidate: load,
  } = useCachedQuery<{ budget: Budget | null; months: Month[]; entries: EntryBalance[] }>(
    `months:${budgetId}`,
    async () => {
      const [b, m, e] = await Promise.all([
        supabase.from('budgets').select('*').eq('id', budgetId).single(),
        supabase.from('months').select('*').eq('budget_id', budgetId).order('start_date', { ascending: false }),
        supabase.from('entries').select('month_id, type, amount, entry_date'),
      ])
      return {
        budget: (b.data as Budget) ?? null,
        months: (m.data as Month[]) ?? [],
        entries: (e.data as EntryBalance[]) ?? [],
      }
    },
  )

  // Refetch on focus: MonthDetail is pushed on top of this screen and adds,
  // edits and deletes entries, which is exactly what the per-period balances
  // here are computed from. useCachedQuery only fetches on mount and this
  // screen never unmounts underneath it, so coming back showed pre-edit totals.
  // Same pattern as Budgets.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const period = budget?.period ?? 'monthly'
  const pk = CAP[period]
  const today = useToday()

  // A private budget can be SEEN by the people it's shared with, but renaming
  // and deleting it stay with the owner (migration 058's budgets_update/delete).
  // Without this the menu would still offer both and the taps would silently do
  // nothing — RLS just matches zero rows.
  const canManage = !budget || budget.visibility !== 'private' || budget.owner_email === profile?.email
  // Only a budget's owner may change its visibility. Owners come from creation
  // (058) or the household-owner backfill (064); a still-ownerless budget (a
  // household that never had an owner) lets whoever makes it private claim it.
  const isOwner = !budget || !budget.owner_email || budget.owner_email === profile?.email

  // To-date totals per period; future-dated entries don't count yet. `today`
  // comes from useToday so that cut-off moves with the calendar instead of
  // freezing on the day the screen happened to first render.
  const stats = useMemo(() => {
    const map = new Map<string, { income: number; spent: number; balance: number }>()
    for (const e of entries) {
      if (e.entry_date > today) continue
      const cur = map.get(e.month_id) ?? { income: 0, spent: 0, balance: 0 }
      const amt = Number(e.amount)
      if (e.type === 'income') cur.income += amt
      else cur.spent += amt
      cur.balance = cur.income - cur.spent
      map.set(e.month_id, cur)
    }
    return map
  }, [entries, today])

  // Suggested default: the current calendar period if missing, else the one
  // right after the latest existing period.
  const nextStart = useMemo(() => {
    const current = currentPeriodStart(period)
    if (!months.some((m) => m.start_date === current)) return current
    return nextPeriodStart(period, months[0].start_date)
  }, [months, period])

  // Normalize the picked date to the period's start (1st / Sunday / the day).
  const pickedStart = useMemo(() => {
    if (!pickStart) return null
    if (period === 'monthly') return `${pickStart.slice(0, 7)}-01`
    if (period === 'weekly') return addDaysISO(pickStart, -new Date(...isoParts(pickStart)).getDay())
    return pickStart
  }, [pickStart, period])

  const alreadyExists = Boolean(pickedStart && months.some((m) => m.start_date === pickedStart))
  const willCopyRecurring = Boolean(
    pickedStart && months.length > 0 && pickedStart > months[0].start_date,
  )

  function openCreate() {
    setPickStart(nextStart)
    setCreateOpen(true)
  }

  async function createMonth(startDate: string, copyRecurring: boolean) {
    setCreating(true)
    try {
      const { data: created, error } = await supabase
        .from('months')
        .insert({ budget_id: budgetId, start_date: startDate })
        .select()
        .single()
      if (error || !created) {
        Alert.alert(error?.code === '23505' ? t('months.existsAlert') : t('months.createFailed'))
        return
      }
      // Copy recurring entries from the most recent period, keeping each entry's
      // day offset within the period (clamped to its length).
      const source = copyRecurring ? months[0] : null
      if (source) {
        const { data: recurring } = await supabase
          .from('entries')
          .select('*')
          .eq('month_id', source.id)
          .eq('recurring', true)
        if (recurring && recurring.length > 0) {
          const len = periodLengthDays(period, created.start_date)
          const copies = (recurring as Entry[]).map((e) => {
            const offset = Math.max(0, daysBetweenISO(source.start_date, e.entry_date))
            return {
              month_id: created.id,
              type: e.type,
              label: e.label,
              amount: e.amount,
              category: e.category,
              subcategory: e.subcategory,
              person_email: e.person_email,
              recurring: true,
              entry_date: addDaysISO(created.start_date, Math.min(offset, len - 1)),
            }
          })
          await supabase.from('entries').insert(copies)
        }
      }
      router.push(`/budget/${budgetId}/${created.id}`)
    } finally {
      setCreating(false)
    }
  }

  async function renameBudget() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    const { error } = await supabase.from('budgets').update({ name: trimmed, icon }).eq('id', budgetId)
    setSaving(false)
    setRenameOpen(false)
    if (error) {
      Alert.alert(t('months.renameFailed'))
      return
    }
    load()
  }

  function deleteBudget() {
    if (!budget) return
    Alert.alert(t('months.deleteConfirm', { name: budget.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('budgets').delete().eq('id', budget.id)
          if (error) {
            Alert.alert(t('months.deleteFailed'))
            return
          }
          router.back()
        },
      },
    ])
  }

  // Flip a budget between household-wide and private. Going private claims
  // ownership (owner_email = me) so RLS lets me manage it; the DB trigger
  // (budgets_plus_guard) also requires Plus, which we check first for a clear
  // message. Going household re-opens it to everyone in the household.
  async function setVisibility(next: 'private' | 'household') {
    if (!budget || !profile || visBusy) return
    setVisBusy(true)
    const patch =
      next === 'private'
        ? { visibility: 'private' as const, owner_email: profile.email }
        : { visibility: 'household' as const }
    const { error } = await supabase.from('budgets').update(patch).eq('id', budget.id)
    setVisBusy(false)
    if (error) {
      Alert.alert(t('budget.visibilityFailed'))
      return
    }
    track('budget.visibility_changed', { to: next, name: budget.name })
    load()
  }

  function makePrivate() {
    if (!budget) return
    if (!isPlus) {
      Alert.alert(t('budget.plusRequired'), t('budget.plusRequiredMsg'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('budget.seePlus'), onPress: () => router.push('/paywall') },
      ])
      return
    }
    Alert.alert(t('budget.makePrivateConfirm', { name: budget.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('budget.makePrivate'), onPress: () => void setVisibility('private') },
    ])
  }

  function makeHousehold() {
    if (!budget) return
    Alert.alert(t('budget.makeSharedConfirm', { name: budget.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('budget.makeShared'), onPress: () => void setVisibility('household') },
    ])
  }

  // Delete one period (month row) and, via ON DELETE CASCADE, its entries.
  function deletePeriod(m: Month) {
    const label = periodLabel(period, m.start_date)
    Alert.alert(t('months.deletePeriodConfirm', { label }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('months').delete().eq('id', m.id)
          if (error) {
            Alert.alert(t('months.periodDeleteFailed'))
            return
          }
          track('period.deleted', { label })
          load()
        },
      },
    ])
  }

  const hint = !pickedStart
    ? ''
    : alreadyExists
      ? t('months.alreadyExists', { label: periodLabel(period, pickedStart) })
      : willCopyRecurring
        ? t('months.willCopy', {
            label: periodLabel(period, pickedStart),
            source: periodLabel(period, months[0].start_date),
          })
        : months.length > 0
          ? t('months.addedBehind', { label: periodLabel(period, pickedStart) })
          : t('months.firstPeriod', { label: periodLabel(period, pickedStart) })

  const currentStart = currentPeriodStart(period)
  const locale = lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es' : 'en-US'
  // The chart: the latest six periods, oldest first.
  const trend: TrendPoint[] = months
    .slice(0, 6)
    .reverse()
    .map((m) => {
      const [y, mo0, d] = isoParts(m.start_date)
      const dt = new Date(y, mo0, d)
      const st = stats.get(m.id)
      return {
        id: m.id,
        short: (period === 'monthly'
          ? dt.toLocaleDateString(locale, { month: 'short' })
          : dt.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
        ).replace('.', ''),
        income: st?.income ?? 0,
        spent: st?.spent ?? 0,
        current: m.start_date === currentStart,
      }
    })

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={budget?.name ?? '…'}
          right={
            canManage ? (
              <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityLabel={t('months.options')}>
                <MoreHorizontal size={22} color={c.textMuted} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {loading ? (
        <Loader />
      ) : months.length === 0 ? (
        <EmptyState title={t('months.empty')} subtitle={t(`months.emptyHint${pk}` as TKey)} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
        >
          {months.length > 1 ? (
            <TrendCard points={trend} onOpen={(id) => router.push(`/budget/${budgetId}/${id}`)} />
          ) : null}
          <Txt variant="label" style={{ marginTop: sp.sm, textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>
            {t('months.periods')}
          </Txt>
          {months.map((m) => (
            <PeriodCard
              key={m.id}
              label={periodLabel(period, m.start_date)}
              current={m.start_date === currentStart}
              income={stats.get(m.id)?.income ?? 0}
              spent={stats.get(m.id)?.spent ?? 0}
              balance={stats.get(m.id)?.balance ?? 0}
              deletable={canManage}
              onOpen={() => router.push(`/budget/${budgetId}/${m.id}`)}
              onDelete={() => deletePeriod(m)}
            />
          ))}
        </ScrollView>
      )}

      {/* Bottom action in NORMAL flow — the branch above is flex:1, so this
          stays pinned to the bottom and the list ends AT it, never under it. */}
      <NewItemButton
        label={t(`months.new${pk}` as TKey)}
        onPress={openCreate}
        loading={creating}
        disabled={loading}
        // the budget's own gradient — one colour per budget on every Money screen
        colors={budgetLook(budgetId).colors}
      />

      {/* budget options menu — 2026-11: a sheet with the budget's gradient
          tile + name as its head, and icon rows (delete in red, last). */}
      {menuOpen && canManage && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setMenuOpen(false)}>
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: c.sheet,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                paddingHorizontal: sp.lg,
                paddingTop: sp.lg,
                paddingBottom: bottomGap,
                gap: sp.lg,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <GradientBox colors={budgetLook(budgetId).colors} radius={18} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                  <Wallet size={26} color="#fff" />
                </GradientBox>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: c.textMuted }}>
                    {t(budget?.visibility === 'private' ? 'budget.private' : 'app.budget.name')}
                  </Txt>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text, marginTop: 2 }} numberOfLines={1}>
                    {budget?.name ?? ''}
                  </Txt>
                </View>
                <Pressable
                  onPress={() => setMenuOpen(false)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}
                >
                  <X size={16} color={c.textMuted} />
                </Pressable>
              </View>
              <View style={{ backgroundColor: c.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' }}>
                <MenuRow
                  Icon={Pencil}
                  tint={budgetLook(budgetId).colors[1]}
                  label={t('months.rename')}
                  onPress={() => {
                    setMenuOpen(false)
                    setName(budget?.name ?? '')
                    setIcon(budgetIcon(budget))
                    setRenameOpen(true)
                  }}
                />
                {budget?.visibility === 'private' ? (
                  <>
                    <MenuRow
                      Icon={Users}
                      tint={budgetLook(budgetId).colors[1]}
                      label={t('budget.whoCanViewTitle')}
                      onPress={() => {
                        setMenuOpen(false)
                        setAccessOpen(true)
                      }}
                    />
                    <MenuRow
                      Icon={LockOpen}
                      tint={budgetLook(budgetId).colors[1]}
                      label={t('budget.makeShared')}
                      onPress={() => {
                        setMenuOpen(false)
                        makeHousehold()
                      }}
                    />
                  </>
                ) : isOwner ? (
                  <MenuRow
                    Icon={Lock}
                    tint={budgetLook(budgetId).colors[1]}
                    label={t('budget.makePrivate')}
                    onPress={() => {
                      setMenuOpen(false)
                      makePrivate()
                    }}
                  />
                ) : null}
                <MenuRow
                  Icon={Trash2}
                  tint={c.expense}
                  label={t('months.delete')}
                  destructive
                  last
                  onPress={() => {
                    setMenuOpen(false)
                    deleteBudget()
                  }}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* rename sheet */}
      {renameOpen && (
        <RenameBudgetSheet
          colors={budgetLook(budgetId).colors}
          name={name}
          onName={setName}
          icon={icon}
          onIcon={setIcon}
          saving={saving}
          onSave={renameBudget}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {/* create-period sheet */}
      {createOpen && (
        <NewPeriodSheet
          colors={budgetLook(budgetId).colors}
          kicker={budget?.name ?? ''}
          title={t(`months.new${pk}Title` as TKey)}
          which={t(`months.which${pk}` as TKey)}
          period={period}
          pickStart={pickStart}
          pickedStart={pickedStart}
          onPickStart={setPickStart}
          hint={hint}
          alreadyExists={alreadyExists}
          creating={creating}
          onCreate={() => {
            if (!pickedStart) return
            setCreateOpen(false)
            createMonth(pickedStart, willCopyRecurring)
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {accessOpen && budget ? (
        <BudgetAccessSheet budget={budget} onClose={() => setAccessOpen(false)} />
      ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  )
}


/** Rename the budget (2026-11 form redesign): one row, Save docked. */
function RenameBudgetSheet({
  colors,
  name,
  onName,
  icon,
  onIcon,
  saving,
  onSave,
  onClose,
}: {
  colors: Gradient
  name: string
  onName: (v: string) => void
  icon: string
  onIcon: (v: string) => void
  saving: boolean
  onSave: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <FormSheet
      icon={Pencil}
      colors={colors}
      title={t('months.renameTitle')}
      onClose={onClose}
      footer={<TintButton tint={colors[1]} colors={colors} title={t('common.save')} onPress={onSave} disabled={!name.trim() || saving} />}
    >
      <FormSection>
        <NoteRow
          label={t('budget.nameLabel' as TKey)}
          value={name}
          onChangeText={onName}
          multiline={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => name.trim() && onSave()}
        />
      </FormSection>
      <View style={{ marginTop: sp.lg }}>
        <BudgetIconPicker value={icon} onChange={onIcon} tint={colors[1]} />
      </View>
    </FormSheet>
  )
}

/** Create a period (2026-11 form redesign). The selector is one card row:
 *  ‹ [📅 Jul 2026] › — the arrows step one period and always work (no modal);
 *  the centre label opens the date picker to jump further. Stepping is based
 *  on the normalized pickedStart so prev/next land on clean period
 *  boundaries. Create is docked. */
function NewPeriodSheet({
  colors,
  kicker,
  title,
  which,
  period,
  pickStart,
  pickedStart,
  onPickStart,
  hint,
  alreadyExists,
  creating,
  onCreate,
  onClose,
}: {
  colors: Gradient
  kicker: string
  title: string
  which: string
  period: Period
  /** The raw picked date (what the calendar shows). */
  pickStart: string
  /** pickStart normalized to its period's first day. */
  pickedStart: string | null
  onPickStart: (iso: string) => void
  hint: string | null
  alreadyExists: boolean
  creating: boolean
  onCreate: () => void
  onClose: () => void
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const [pickerOpen, setPickerOpen] = useState(false)
  const base = pickedStart ?? currentPeriodStart(period)
  const tint = colors[1]
  const soft = tint + (dark ? '2E' : '1A')
  const stepBtn = {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: soft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }
  return (
    <FormSheet
      icon={CalendarPlus}
      colors={colors}
      kicker={kicker}
      title={title}
      onClose={onClose}
      footer={
        <TintButton
          tint={tint}
          colors={colors}
          title={t('common.create')}
          disabled={!pickedStart || alreadyExists || creating}
          onPress={onCreate}
        />
      }
      overlay={
        <DatePickerModal
          tint={tint}
          title={title}
          visible={pickerOpen}
          value={pickStart}
          onChange={onPickStart}
          onClose={() => setPickerOpen(false)}
        />
      }
    >
      <FormSection footer={which}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.sm, paddingVertical: sp.sm }}>
          <Pressable
            onPress={() => onPickStart(prevPeriodStart(period, base))}
            accessibilityRole="button"
            accessibilityLabel={t('months.prevPeriod')}
            hitSlop={6}
            style={({ pressed }) => [stepBtn, pressed && { opacity: 0.6 }]}
          >
            <ChevronLeft size={19} color={tint} strokeWidth={2.4} />
          </Pressable>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: sp.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <CalendarDays size={18} color={tint} />
            <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: c.text }} numberOfLines={1}>
              {pickedStart ? periodLabel(period, pickedStart) : ''}
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => onPickStart(nextPeriodStart(period, base))}
            accessibilityRole="button"
            accessibilityLabel={t('months.nextPeriod')}
            hitSlop={6}
            style={({ pressed }) => [stepBtn, pressed && { opacity: 0.6 }]}
          >
            <ChevronRight size={19} color={tint} strokeWidth={2.4} />
          </Pressable>
        </View>
      </FormSection>
      {hint ? (
        <Txt
          style={{
            fontSize: 13,
            lineHeight: 18,
            marginHorizontal: sp.md,
            marginTop: -sp.sm,
            color: alreadyExists ? c.expense : c.textMuted,
          }}
        >
          {hint}
        </Txt>
      ) : null}
    </FormSheet>
  )
}

/** One period (2026-11 Money rethink): its name (+ "Current"), received and
 *  spent in green/red underneath, and the balance large on the right — every
 *  number once, nothing repeated. Swipe left to reveal Delete (which then
 *  confirms); a read-only viewer (deletable=false) gets no swipe. */
function PeriodCard({
  label,
  current,
  income,
  spent,
  balance,
  onOpen,
  onDelete,
  deletable,
}: {
  label: string
  current: boolean
  income: number
  spent: number
  balance: number
  onOpen: () => void
  onDelete: () => void
  deletable: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const swipeRef = useRef<Swipeable>(null)

  const card = (
    <Card onPress={onOpen} style={{ paddingVertical: sp.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }} numberOfLines={1}>
              {label}
            </Txt>
            {current ? (
              <View style={{ backgroundColor: c.action, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Txt style={{ color: c.onAction, fontSize: 11, fontFamily: fonts.semibold }}>{t('months.current')}</Txt>
              </View>
            ) : null}
          </View>
          <Txt style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>
            <Txt style={{ fontSize: 13, color: c.income }}>↑ {formatMoney(income)}</Txt>
            <Txt style={{ fontSize: 13, color: c.textFaint }}>{'   '}</Txt>
            <Txt style={{ fontSize: 13, color: c.expense }}>↓ {formatMoney(spent)}</Txt>
          </Txt>
        </View>
        <Txt
          style={{
            fontSize: 19,
            fontFamily: fonts.display,
            fontVariant: ['tabular-nums'],
            color: balance >= 0 ? c.income : c.expense,
          }}
        >
          {formatMoney(balance)}
        </Txt>
        <ChevronRight size={20} color={c.textFaint} />
      </View>
    </Card>
  )

  if (!deletable) return card

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => {
            swipeRef.current?.close()
            onDelete()
          }}
          accessibilityLabel={t('months.deletePeriod')}
          style={{
            width: 92,
            marginLeft: sp.sm,
            borderRadius: radius.md,
            backgroundColor: c.expense,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Trash2 size={20} color="#fff" />
          <Txt style={{ color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 2 }}>
            {t('common.delete')}
          </Txt>
        </Pressable>
      )}
    >
      {card}
    </Swipeable>
  )
}

function MenuRow({
  Icon,
  tint,
  label,
  onPress,
  destructive,
  last,
}: {
  Icon: LucideIcon
  tint: string
  label: string
  onPress: () => void
  destructive?: boolean
  last?: boolean
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        minHeight: 54,
        paddingHorizontal: sp.md,
        backgroundColor: pressed ? c.surface : 'transparent',
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      })}
    >
      <RowIcon Icon={Icon} tint={tint} />
      <Txt style={{ flex: 1, fontSize: 16, fontFamily: fonts.semibold, color: destructive ? c.expense : c.text }}>{label}</Txt>
      {destructive ? null : <ChevronRight size={16} color={c.textFaint} />}
    </Pressable>
  )
}

/** ISO "YYYY-MM-DD" → [year, monthIndex, day] tuple for `new Date(...)`. */
function isoParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m - 1, d]
}
