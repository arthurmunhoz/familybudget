// A budget's periods ("months" historically — each row is one period: a month,
// week, or day per the budget's grouping). Lists periods newest-first with a
// to-date balance, opens one on tap, and creates a new period via a sheet that
// suggests the current/next period and copies recurring entries forward. The
// header menu renames or deletes the budget. RN port of budget/Months.tsx.
import { useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronRight, MoreHorizontal, X } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Field, Loader, Txt } from '@/components/ui'
import { useCachedQuery } from '@/hooks/useCachedQuery'
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
  todayISO,
} from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Budget, Entry, Month, Period } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { BudgetAccessSheet } from './BudgetAccessSheet'
import { DateField } from './shared'

// Period-specific i18n key suffix (month/week/day).
const CAP: Record<Period, string> = { monthly: 'Month', weekly: 'Week', daily: 'Day' }

type EntryBalance = Pick<Entry, 'month_id' | 'type' | 'amount' | 'entry_date'>

export default function Months({ budgetId }: { budgetId: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { isPlus } = usePlus()

  const [creating, setCreating] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [pickStart, setPickStart] = useState('')

  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  // Per-period options sheet, "who can view" sheet, visibility-change guard.
  const [periodMenuFor, setPeriodMenuFor] = useState<Month | null>(null)
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

  const period = budget?.period ?? 'monthly'
  const pk = CAP[period]

  // A private budget can be SEEN by the people it's shared with, but renaming
  // and deleting it stay with the owner (migration 058's budgets_update/delete).
  // Without this the menu would still offer both and the taps would silently do
  // nothing — RLS just matches zero rows.
  const canManage = !budget || budget.visibility !== 'private' || budget.owner_email === profile?.email
  // Only a budget's owner may change its visibility. Owners come from creation
  // (058) or the household-owner backfill (064); a still-ownerless budget (a
  // household that never had an owner) lets whoever makes it private claim it.
  const isOwner = !budget || !budget.owner_email || budget.owner_email === profile?.email

  // To-date balance per period; future-dated entries don't count yet.
  const balances = useMemo(() => {
    const today = todayISO()
    const map = new Map<string, number>()
    for (const e of entries) {
      if (e.entry_date > today) continue
      const delta = e.type === 'income' ? Number(e.amount) : -Number(e.amount)
      map.set(e.month_id, (map.get(e.month_id) ?? 0) + delta)
    }
    return map
  }, [entries])

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
    const { error } = await supabase.from('budgets').update({ name: trimmed }).eq('id', budgetId)
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

  return (
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
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 120, gap: sp.md }}
        >
          {months.map((m) => {
            const balance = balances.get(m.id) ?? 0
            return (
              <Card key={m.id} onPress={() => router.push(`/budget/${budgetId}/${m.id}`)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <Txt style={{ flex: 1, fontWeight: '700', fontSize: 16 }}>
                    {periodLabel(period, m.start_date)}
                  </Txt>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt
                      style={{
                        fontSize: 10,
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: c.textFaint,
                      }}
                    >
                      {t('common.balance')}
                    </Txt>
                    <Txt
                      style={{
                        fontSize: 16,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                        color: balance >= 0 ? c.income : c.expense,
                      }}
                    >
                      {formatMoney(balance)}
                    </Txt>
                  </View>
                  {canManage ? (
                    <Pressable
                      onPress={() => setPeriodMenuFor(m)}
                      hitSlop={8}
                      accessibilityLabel={t('months.periodOptions')}
                    >
                      <MoreHorizontal size={20} color={c.textFaint} />
                    </Pressable>
                  ) : null}
                  <ChevronRight size={20} color={c.textFaint} />
                </View>
              </Card>
            )
          })}
        </ScrollView>
      )}

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn
            title={creating ? t('months.creating') : t(`months.new${pk}` as TKey)}
            disabled={creating || loading}
            onPress={openCreate}
          />
        </View>
      </SafeAreaView>

      {/* budget options menu */}
      {menuOpen && canManage && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setMenuOpen(false)}>
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: c.card,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
                padding: sp.md,
                paddingBottom: sp.xl,
                gap: sp.xs,
              }}
            >
              <MenuRow
                label={t('months.rename')}
                onPress={() => {
                  setMenuOpen(false)
                  setName(budget?.name ?? '')
                  setRenameOpen(true)
                }}
              />
              {budget?.visibility === 'private' ? (
                <>
                  <MenuRow
                    label={t('budget.whoCanViewTitle')}
                    onPress={() => {
                      setMenuOpen(false)
                      setAccessOpen(true)
                    }}
                  />
                  <MenuRow
                    label={t('budget.makeShared')}
                    onPress={() => {
                      setMenuOpen(false)
                      makeHousehold()
                    }}
                  />
                </>
              ) : isOwner ? (
                <MenuRow
                  label={t('budget.makePrivate')}
                  onPress={() => {
                    setMenuOpen(false)
                    makePrivate()
                  }}
                />
              ) : null}
              <MenuRow
                label={t('months.delete')}
                destructive
                onPress={() => {
                  setMenuOpen(false)
                  deleteBudget()
                }}
              />
              <Btn title={t('common.cancel')} variant="secondary" onPress={() => setMenuOpen(false)} style={{ marginTop: sp.sm }} />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* rename modal */}
      {renameOpen && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setRenameOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: sp.lg }}>
            <View style={{ backgroundColor: c.card, borderRadius: 18, padding: sp.lg, gap: sp.md }}>
              <Txt variant="h2">{t('months.renameTitle')}</Txt>
              <Field value={name} onChangeText={setName} autoFocus />
              <View style={{ flexDirection: 'row', gap: sp.md }}>
                <Btn title={t('common.cancel')} variant="secondary" onPress={() => setRenameOpen(false)} style={{ flex: 1 }} />
                <Btn title={t('common.save')} onPress={renameBudget} loading={saving} disabled={!name.trim()} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* create-period modal */}
      {createOpen && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: sp.lg }}>
            <View style={{ backgroundColor: c.card, borderRadius: 18, padding: sp.lg, gap: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt variant="h2">{t(`months.new${pk}Title` as TKey)}</Txt>
                <Pressable onPress={() => setCreateOpen(false)} hitSlop={10}>
                  <X size={22} color={c.textMuted} />
                </Pressable>
              </View>
              <DateField label={t(`months.which${pk}` as TKey)} value={pickStart} onChange={setPickStart} />
              {hint ? (
                <Txt style={{ fontSize: 13, color: alreadyExists ? c.expense : c.textMuted }}>{hint}</Txt>
              ) : null}
              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.sm }}>
                <Btn title={t('common.cancel')} variant="secondary" onPress={() => setCreateOpen(false)} style={{ flex: 1 }} />
                <Btn
                  title={t('common.create')}
                  disabled={!pickedStart || alreadyExists || creating}
                  onPress={() => {
                    if (!pickedStart) return
                    setCreateOpen(false)
                    createMonth(pickedStart, willCopyRecurring)
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
      {/* per-period options */}
      {periodMenuFor && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setPeriodMenuFor(null)}>
          <Pressable
            onPress={() => setPeriodMenuFor(null)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: c.card,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
                padding: sp.md,
                paddingBottom: sp.xl,
                gap: sp.xs,
              }}
            >
              <Txt variant="faint" style={{ paddingHorizontal: sp.md, paddingTop: sp.xs }}>
                {periodLabel(period, periodMenuFor.start_date)}
              </Txt>
              <MenuRow
                label={t('months.deletePeriod')}
                destructive
                onPress={() => {
                  const m = periodMenuFor
                  setPeriodMenuFor(null)
                  deletePeriod(m)
                }}
              />
              <Btn
                title={t('common.cancel')}
                variant="secondary"
                onPress={() => setPeriodMenuFor(null)}
                style={{ marginTop: sp.sm }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {accessOpen && budget ? (
        <BudgetAccessSheet budget={budget} onClose={() => setAccessOpen(false)} />
      ) : null}
    </SafeAreaView>
  )
}

function MenuRow({ label, onPress, destructive }: { label: string; onPress: () => void; destructive?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 14,
        paddingHorizontal: sp.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? c.surface : 'transparent',
      })}
    >
      <Txt style={{ fontWeight: '600', color: destructive ? c.expense : c.text }}>{label}</Txt>
    </Pressable>
  )
}

/** ISO "YYYY-MM-DD" → [year, monthIndex, day] tuple for `new Date(...)`. */
function isoParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m - 1, d]
}
