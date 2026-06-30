// Add / edit a budget entry — a bottom-sheet modal. RN port of the PWA's
// EntryForm: income/expense toggle, label, amount (decimal-pad), category grid
// (expense only), optional subcategory with quick-pick chips, date picker, "who"
// picker, and a recurring toggle. Supports a `initial` prefill (e.g. a scanned
// receipt). On save it also learns the label→category mapping into category_rules
// so future entries auto-categorize, mirroring the web app.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { CATEGORIES, normalizeLabel, suggestCategory } from '@/lib/categories'
import { todayISO } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { CategoryRule, Entry, EntryType, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { Chip, DateField, Segmented } from './shared'

export interface EntryPrefill {
  label?: string
  amount?: number
  category?: string
  subcategory?: string | null
  entry_date?: string | null
}

export default function EntryForm({
  monthId,
  periodStart,
  periodEnd,
  profiles,
  myEmail,
  rules,
  subcategorySuggestions,
  entry,
  initial,
  onClose,
  onSaved,
}: {
  monthId: string
  /** Inclusive ISO date bounds of the budget period this entry belongs to. */
  periodStart: string
  periodEnd: string
  profiles: Profile[]
  myEmail: string
  rules: CategoryRule[]
  /** category id → subcategories already used by the household, most-used first. */
  subcategorySuggestions: Record<string, string[]>
  /** null = creating a new entry. */
  entry: Entry | null
  /** Prefilled values for a new entry (e.g. from a scanned receipt). */
  initial?: EntryPrefill
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()

  const today = todayISO()
  const inPeriod = (iso: string) => iso >= periodStart && iso <= periodEnd
  const defaultDate = inPeriod(today) ? today : periodStart
  const initialDate =
    initial?.entry_date && inPeriod(initial.entry_date) ? initial.entry_date : undefined

  const [type, setType] = useState<EntryType>(entry?.type ?? 'expense')
  const [label, setLabel] = useState(entry?.label ?? initial?.label ?? '')
  const [amount, setAmount] = useState(
    entry ? String(entry.amount) : initial?.amount ? String(initial.amount) : '',
  )
  const [category, setCategory] = useState(entry?.category ?? initial?.category ?? 'other')
  const [categoryTouched, setCategoryTouched] = useState(
    Boolean(entry) || Boolean(initial?.category),
  )
  const [subcategory, setSubcategory] = useState(entry?.subcategory ?? initial?.subcategory ?? '')
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  const subSuggestions = subcategorySuggestions[category] ?? []
  const expenseCategories = useMemo(() => CATEGORIES.filter((x) => x.id !== 'salary'), [])

  async function save() {
    const value = parseFloat(amount)
    if (!label.trim() || !value || value <= 0) {
      setError(t('entry.validation'))
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      month_id: monthId,
      type,
      label: label.trim(),
      amount: value,
      category: type === 'income' ? 'salary' : category,
      subcategory: type === 'expense' && subcategory.trim() ? subcategory.trim() : null,
      entry_date: date,
      person_email: personEmail,
      recurring,
    }
    const result = entry
      ? await supabase.from('entries').update(payload).eq('id', entry.id)
      : await supabase.from('entries').insert(payload)
    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return
    }
    // Learn this label → category choice for future auto-categorization.
    const householdId = profiles[0]?.household_id
    if (type === 'expense' && householdId) {
      await supabase
        .from('category_rules')
        .upsert(
          { household_id: householdId, keyword: normalizeLabel(label), category },
          { onConflict: 'household_id,keyword' },
        )
    }
    onSaved()
  }

  function remove() {
    if (!entry) return
    Alert.alert(t('entry.deleteConfirm', { label: entry.label }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setSaving(true)
          await supabase.from('entries').delete().eq('id', entry.id)
          onSaved()
        },
      },
    ])
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '92%',
            backgroundColor: c.card,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          {/* header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
              paddingBottom: sp.sm,
            }}
          >
            <Txt variant="h2">{entry ? t('entry.editTitle') : t('entry.newTitle')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            {/* expense / income */}
            <Segmented<EntryType>
              options={[
                { id: 'expense', label: t('entry.expense') },
                { id: 'income', label: t('entry.income') },
              ]}
              value={type}
              onChange={setType}
              activeColor={type === 'expense' ? c.expense : c.income}
            />

            <Field
              label={t('entry.label')}
              value={label}
              onChangeText={setLabel}
              placeholder={
                type === 'expense'
                  ? t('entry.labelExpensePlaceholder')
                  : t('entry.labelIncomePlaceholder')
              }
              autoFocus={!entry}
            />

            <Field
              label={t('entry.amount')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />

            {type === 'expense' && (
              <View style={{ gap: sp.sm }}>
                <Txt variant="label">{t('entry.category')}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {expenseCategories.map((cat) => {
                    const active = category === cat.id
                    return (
                      <Pressable
                        key={cat.id}
                        onPress={() => {
                          setCategory(cat.id)
                          setCategoryTouched(true)
                        }}
                        style={{
                          width: '22%',
                          alignItems: 'center',
                          paddingVertical: 8,
                          borderRadius: radius.md,
                          backgroundColor: active ? c.accentSoft : c.surface,
                          borderWidth: 2,
                          borderColor: active ? c.accent : 'transparent',
                        }}
                      >
                        <Txt style={{ fontSize: 20 }}>{cat.icon}</Txt>
                        <Txt style={{ fontSize: 10, color: c.textMuted, marginTop: 2 }} numberOfLines={1}>
                          {t(`cat.${cat.id}` as TKey)}
                        </Txt>
                      </Pressable>
                    )
                  })}
                </View>

                <Field
                  label={`${t('entry.subcategory')} ${t('entry.optional')}`}
                  value={subcategory}
                  onChangeText={setSubcategory}
                  placeholder={t(`entry.sub.${category}` as TKey)}
                />
                {subSuggestions.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {subSuggestions.map((s) => {
                      const active = subcategory.trim().toLowerCase() === s.toLowerCase()
                      return (
                        <Chip key={s} active={active} onPress={() => setSubcategory(active ? '' : s)}>
                          <Txt
                            style={{
                              fontSize: 12,
                              fontWeight: '600',
                              color: active ? '#fff' : c.textMuted,
                            }}
                          >
                            {s}
                          </Txt>
                        </Chip>
                      )
                    })}
                  </View>
                )}
              </View>
            )}

            {/* date + who */}
            <View style={{ flexDirection: 'row', gap: sp.md }}>
              <DateField label={t('entry.date')} value={date} onChange={setDate} />
              <View style={{ flex: 1, gap: 6 }}>
                <Txt variant="label">{t('entry.who')}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                  {profiles.map((p) => {
                    const active = personEmail === p.email
                    return (
                      <Chip key={p.email} active={active} onPress={() => setPersonEmail(p.email)}>
                        <Txt
                          style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.textMuted }}
                        >
                          {p.display_name}
                        </Txt>
                      </Chip>
                    )
                  })}
                </View>
              </View>
            </View>

            {/* recurring */}
            <Pressable
              onPress={() => setRecurring((r) => !r)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.md,
                paddingVertical: 12,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, paddingRight: sp.sm }}>
                <Txt>{t('entry.recurring')}</Txt>
                <Txt variant="faint">{t('entry.recurringHint')}</Txt>
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: recurring ? c.accent : 'transparent',
                  borderWidth: 2,
                  borderColor: recurring ? c.accent : c.textFaint,
                }}
              >
                {recurring ? (
                  <Txt style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>✓</Txt>
                ) : null}
              </View>
            </Pressable>
          </ScrollView>

          {/* footer */}
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl, gap: sp.md }}>
            {error ? <Txt style={{ color: c.expense, fontSize: 13 }}>{error}</Txt> : null}
            <Btn
              title={entry ? t('entry.saveChanges') : t('entry.addEntry')}
              onPress={save}
              loading={saving}
            />
            {entry ? (
              <Pressable onPress={remove} disabled={saving} style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('entry.deleteEntry')}</Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  )
}
