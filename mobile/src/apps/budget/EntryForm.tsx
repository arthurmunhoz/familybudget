// Add / edit a budget entry — a bottom-sheet modal, amount-first. The amount is
// the hero input; the category is auto-suggested live from the label (learned
// category_rules + keyword defaults) and shown as a chip row with the
// household's most-used categories; the full grid (plus "create a new custom
// category") sits behind an "All" chip. Date is Today / Yesterday / pick chips,
// "who" chips show "First L.", recurring is a native Switch, and the save
// button announces what it does ("Add expense · $12.50"). Supports an `initial`
// prefill (e.g. a scanned receipt) and learns label→category on save.
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from 'react-native'
import { Plus, X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import {
  CATEGORIES,
  categoryById,
  isBuiltinCategory,
  normalizeLabel,
  suggestCategory,
  type Category,
} from '@/lib/categories'
import { addDaysISO, formatDay, formatMoney, shortName, todayISO } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { CategoryRule, CustomCategory, Entry, EntryType, Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { Chip, DateField } from './shared'

export interface EntryPrefill {
  label?: string
  amount?: number
  category?: string
  subcategory?: string | null
  entry_date?: string | null
}

/** Chips shown when the household has no history yet. */
const FALLBACK_TOP = ['groceries', 'dining', 'transport']

export default function EntryForm({
  monthId,
  periodStart,
  periodEnd,
  profiles,
  myEmail,
  rules,
  subcategorySuggestions,
  customCategories,
  topCategories,
  onCategoryCreated,
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
  /** Household-defined categories (shown alongside the built-ins). */
  customCategories: CustomCategory[]
  /** Household's most-used expense category ids, most-used first. */
  topCategories: string[]
  /** Called after a new custom category is saved, so the parent can refetch. */
  onCategoryCreated: () => void
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
  const yesterday = addDaysISO(today, -1)
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
  const [subOpen, setSubOpen] = useState(Boolean(entry?.subcategory || initial?.subcategory))
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [pickOpen, setPickOpen] = useState(false)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Category picker: chips by default, the full grid behind "All".
  const [gridOpen, setGridOpen] = useState(false)
  const [localCats, setLocalCats] = useState<CustomCategory[]>(customCategories)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState('')
  const [creatingCat, setCreatingCat] = useState(false)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  const parsedAmount = parseFloat(amount.replace(',', '.'))
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0

  const selectedCat = categoryById(category, localCats)
  const catName = (cat: Category) =>
    isBuiltinCategory(cat.id) ? t(`cat.${cat.id}` as TKey) : cat.name
  const allExpenseCats: Category[] = useMemo(
    () => [
      ...CATEGORIES.filter((x) => x.id !== 'salary'),
      ...localCats.map((x) => ({ id: x.id, name: x.name, icon: x.icon })),
    ],
    [localCats],
  )
  const knownIds = useMemo(() => new Set(allExpenseCats.map((x) => x.id)), [allExpenseCats])
  const quickIds = (topCategories.length > 0 ? topCategories : FALLBACK_TOP)
    .filter((id) => id !== category && knownIds.has(id))
    .slice(0, 3)

  const dateIsOther = date !== today && date !== yesterday
  const subSuggestions = subcategorySuggestions[category] ?? []

  function pickCategory(id: string) {
    setCategory(id)
    setCategoryTouched(true)
    setGridOpen(false)
  }

  async function createCategory() {
    const trimmed = newCatName.trim()
    if (!trimmed) return
    setCreatingCat(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('custom_categories')
      .insert({ name: trimmed, icon: newCatIcon.trim() || '🏷️' })
      .select()
      .single()
    setCreatingCat(false)
    if (err || !data) {
      setError(t('entry.categoryCreateFailed'))
      return
    }
    setLocalCats((prev) => [...prev, data as CustomCategory])
    setNewCatOpen(false)
    setNewCatName('')
    setNewCatIcon('')
    pickCategory((data as CustomCategory).id)
    onCategoryCreated()
  }

  async function save() {
    if (!label.trim() || !amountValid) {
      setError(t('entry.validation'))
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      month_id: monthId,
      type,
      label: label.trim(),
      amount: parsedAmount,
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

  const addLabel = t(type === 'expense' ? 'entry.addExpense' : 'entry.addIncome')
  const saveTitle = entry
    ? t('entry.saveChanges')
    : amountValid
      ? `${addLabel} · ${formatMoney(parsedAmount)}`
      : addLabel
  const title = entry
    ? t(type === 'expense' ? 'entry.editExpenseTitle' : 'entry.editIncomeTitle')
    : t(type === 'expense' ? 'entry.newExpenseTitle' : 'entry.newIncomeTitle')

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Tap the dimmed area to dismiss the keyboard. */}
        <Pressable
          onPress={() => Keyboard.dismiss()}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
        >
          {/* Swallow taps so pressing the sheet doesn't dismiss the keyboard. */}
          <Pressable
            onPress={() => {}}
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
            <Txt variant="h2">{title}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.cancel')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            {/* expense / income — compact centered pill */}
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: c.surface,
                  borderRadius: radius.pill,
                  padding: 4,
                  gap: 4,
                }}
              >
                {(['expense', 'income'] as const).map((ty) => {
                  const active = type === ty
                  return (
                    <Pressable
                      key={ty}
                      onPress={() => setType(ty)}
                      style={{
                        borderRadius: radius.pill,
                        paddingVertical: 8,
                        paddingHorizontal: 20,
                        backgroundColor: active ? (ty === 'expense' ? c.expense : c.income) : 'transparent',
                      }}
                    >
                      <Txt
                        style={{
                          fontFamily: fonts.semibold,
                          fontSize: 14,
                          color: active ? '#fff' : c.textMuted,
                        }}
                      >
                        {ty === 'expense' ? t('entry.expense') : t('entry.income')}
                      </Txt>
                    </Pressable>
                  )
                })}
              </View>
            </View>

            {/* amount first — it's what you know when you open the form */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: sp.sm,
              }}
            >
              <Txt
                style={{
                  fontSize: 32,
                  fontFamily: fonts.semibold,
                  color: amount ? c.text : c.textFaint,
                  marginRight: 2,
                }}
              >
                $
              </Txt>
              <TextInput
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={c.textFaint}
                autoFocus={!entry && !initial?.amount}
                accessibilityLabel={t('entry.amount')}
                style={{
                  fontSize: 52,
                  fontFamily: fonts.display,
                  fontVariant: ['tabular-nums'],
                  color: c.text,
                  minWidth: 120,
                  textAlign: 'center',
                  padding: 0,
                }}
              />
            </View>

            <Field
              label={t('entry.label')}
              value={label}
              onChangeText={setLabel}
              placeholder={
                type === 'expense'
                  ? t('entry.labelExpensePlaceholder')
                  : t('entry.labelIncomePlaceholder')
              }
            />

            {type === 'expense' && (
              <View style={{ gap: sp.sm }}>
                <Txt variant="label">
                  {t('entry.category')}{' '}
                  {!categoryTouched ? (
                    <Txt style={{ fontSize: 12, color: c.textFaint }}>{t('entry.autoSuggested')}</Txt>
                  ) : null}
                </Txt>

                {/* selected chip + most-used + All */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.sm }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: c.accent,
                      borderRadius: radius.pill,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                    }}
                  >
                    <Txt style={{ fontSize: 14 }}>{selectedCat.icon}</Txt>
                    <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: '#fff' }}>
                      {catName(selectedCat)}
                    </Txt>
                  </View>
                  {quickIds.map((id) => {
                    const qc = categoryById(id, localCats)
                    return (
                      <Pressable
                        key={id}
                        onPress={() => pickCategory(id)}
                        accessibilityLabel={catName(qc)}
                        style={({ pressed }) => ({
                          backgroundColor: c.surface,
                          borderRadius: radius.pill,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Txt style={{ fontSize: 17 }}>{qc.icon}</Txt>
                      </Pressable>
                    )
                  })}
                  <Pressable
                    onPress={() => setGridOpen((o) => !o)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 3,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.card,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: c.textMuted }}>
                      {t('common.all')} {gridOpen ? '▴' : '▾'}
                    </Txt>
                  </Pressable>
                </View>

                {/* the full grid, plus the "new custom category" tile */}
                {gridOpen && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                    {allExpenseCats.map((cat) => {
                      const active = category === cat.id
                      return (
                        <Pressable
                          key={cat.id}
                          onPress={() => pickCategory(cat.id)}
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
                            {catName(cat)}
                          </Txt>
                        </Pressable>
                      )
                    })}
                    <Pressable
                      onPress={() => setNewCatOpen((o) => !o)}
                      style={{
                        width: '22%',
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: 8,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderStyle: 'dashed',
                        borderColor: c.textFaint,
                      }}
                    >
                      <Plus size={20} color={c.textMuted} />
                      <Txt style={{ fontSize: 10, color: c.textMuted, marginTop: 2 }}>
                        {t('entry.newCategory')}
                      </Txt>
                    </Pressable>
                  </View>
                )}

                {gridOpen && newCatOpen && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <TextInput
                      value={newCatIcon}
                      onChangeText={setNewCatIcon}
                      placeholder="🏷️"
                      placeholderTextColor={c.textFaint}
                      maxLength={4}
                      accessibilityLabel={t('entry.newCategoryIcon')}
                      style={{
                        width: 56,
                        textAlign: 'center',
                        backgroundColor: c.surface,
                        borderRadius: radius.md,
                        paddingVertical: 12,
                        fontSize: 16,
                        color: c.text,
                      }}
                    />
                    <TextInput
                      value={newCatName}
                      onChangeText={setNewCatName}
                      placeholder={t('entry.newCategoryPlaceholder')}
                      placeholderTextColor={c.textFaint}
                      maxLength={40}
                      autoFocus
                      style={{
                        flex: 1,
                        minWidth: 0,
                        backgroundColor: c.surface,
                        borderRadius: radius.md,
                        paddingHorizontal: sp.md,
                        paddingVertical: 12,
                        fontSize: 16,
                        color: c.text,
                      }}
                    />
                    <Pressable
                      onPress={createCategory}
                      disabled={creatingCat || !newCatName.trim()}
                      style={({ pressed }) => ({
                        backgroundColor: c.accent,
                        borderRadius: radius.md,
                        paddingHorizontal: sp.lg,
                        paddingVertical: 12,
                        opacity: creatingCat || !newCatName.trim() ? 0.5 : pressed ? 0.85 : 1,
                      })}
                    >
                      <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14 }}>
                        {t('common.add')}
                      </Txt>
                    </Pressable>
                  </View>
                )}

                {/* subcategory — folded until asked for (or already set) */}
                {!subOpen ? (
                  <Pressable onPress={() => setSubOpen(true)} style={{ alignSelf: 'flex-start' }}>
                    <Txt
                      style={{
                        fontSize: 12,
                        fontFamily: fonts.medium,
                        color: c.textMuted,
                        textDecorationLine: 'underline',
                      }}
                    >
                      {t('entry.addSubcategory')}
                    </Txt>
                  </Pressable>
                ) : (
                  <>
                    <Field
                      label={`${t('entry.subcategory')} ${t('entry.optional')}`}
                      value={subcategory}
                      onChangeText={setSubcategory}
                      placeholder={
                        isBuiltinCategory(category)
                          ? t(`entry.sub.${category}` as TKey)
                          : t('entry.subcategoryPlaceholder')
                      }
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
                  </>
                )}
              </View>
            )}

            {/* date — Today / Yesterday / pick */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('entry.date')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {inPeriod(today) && (
                  <Chip
                    active={date === today}
                    onPress={() => {
                      setDate(today)
                      setPickOpen(false)
                    }}
                  >
                    <Txt style={{ fontSize: 13, fontWeight: '600', color: date === today ? '#fff' : c.textMuted }}>
                      {t('entry.today')}
                    </Txt>
                  </Chip>
                )}
                {inPeriod(yesterday) && (
                  <Chip
                    active={date === yesterday}
                    onPress={() => {
                      setDate(yesterday)
                      setPickOpen(false)
                    }}
                  >
                    <Txt
                      style={{ fontSize: 13, fontWeight: '600', color: date === yesterday ? '#fff' : c.textMuted }}
                    >
                      {t('entry.yesterday')}
                    </Txt>
                  </Chip>
                )}
                <Chip active={dateIsOther} onPress={() => setPickOpen((o) => !o)}>
                  <Txt style={{ fontSize: 13, fontWeight: '600', color: dateIsOther ? '#fff' : c.textMuted }}>
                    {dateIsOther ? formatDay(date) : t('entry.pickDate')}
                  </Txt>
                </Chip>
              </View>
              {pickOpen && <DateField value={date} onChange={setDate} />}
            </View>

            {/* who — "First L." chips */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('entry.who')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                {profiles.map((p) => {
                  const active = personEmail === p.email
                  return (
                    <Chip key={p.email} active={active} onPress={() => setPersonEmail(p.email)}>
                      <Txt
                        style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.textMuted }}
                      >
                        {shortName(p.display_name)}
                      </Txt>
                    </Chip>
                  )
                })}
              </View>
            </View>

            {/* recurring */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.md,
                paddingVertical: 10,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, paddingRight: sp.sm }}>
                <Txt>{t('entry.recurring')}</Txt>
                <Txt variant="faint">{t('entry.recurringHint')}</Txt>
              </View>
              <Switch
                value={recurring}
                onValueChange={setRecurring}
                trackColor={{ true: c.accent, false: c.surface2 }}
                accessibilityLabel={t('entry.recurring')}
              />
            </View>
          </ScrollView>

          {/* footer */}
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl, gap: sp.md }}>
            {error ? <Txt style={{ color: c.expense, fontSize: 13 }}>{error}</Txt> : null}
            <Btn title={saveTitle} onPress={save} loading={saving} />
            {entry ? (
              <Pressable onPress={remove} disabled={saving} style={{ paddingVertical: 10, alignItems: 'center' }}>
                <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('entry.deleteEntry')}</Txt>
              </Pressable>
            ) : null}
          </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}
