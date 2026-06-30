// Money — the module's home: a list of budgets. Tapping one opens its periods.
// The bottom bar opens a "new budget" sheet (name + period grouping). RN port of
// the PWA's budget/Budgets.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronRight, Wallet, X } from 'lucide-react-native'

import { AppHeader, Btn, Card, EmptyState, Field, Loader, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { Budget, Period } from '@/lib/types'
import { sp, useTheme } from '@/theme/theme'
import { Segmented } from './shared'

const PERIODS: Period[] = ['monthly', 'weekly', 'daily']

export default function Budgets() {
  const { c } = useTheme()
  const { t } = useI18n()

  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [period, setPeriod] = useState<Period>('monthly')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('budgets').select('*').order('created_at')
    setBudgets((data as Budget[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
            <Card key={b.id} onPress={() => router.push(`/budget/${b.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontWeight: '700', fontSize: 17 }} numberOfLines={1}>
                    {b.name}
                  </Txt>
                  <Txt variant="faint">{t(`budget.${b.period}` as TKey)}</Txt>
                </View>
                <ChevronRight size={20} color={c.textFaint} />
              </View>
            </Card>
          ))}
        </ScrollView>
      )}

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn
            title={t('budget.new')}
            disabled={loading}
            onPress={() => {
              setName('')
              setPeriod('monthly')
              setCreateOpen(true)
            }}
          />
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
