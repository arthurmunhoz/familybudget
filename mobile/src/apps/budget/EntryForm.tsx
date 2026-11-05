// Add / edit a budget entry — a bottom-sheet modal, amount-first. The amount is
// the hero input; the category is auto-suggested live from the label (learned
// category_rules + keyword defaults).
//
// 2026-11 Money rethink (Comando style), on the "inset grouped list" rows of
// components/form:
//   • A HERO panel tinted by what this is — red for an expense, green for
//     income, the same two colours as every Money total: the ↓ Expense / ↑
//     Income pills, the amount large in that colour with its sign, and the
//     category as a chip right under the amount (tap → the full grid in a
//     sheet, which can also create a household category and links to Manage
//     categories). "Coffee, $5.42, Dining" reads as one sentence up there.
//   • What: Label, the household's most-used categories as a strip, then
//     Subcategory with its used-before suggestions.
//   • Details: Date (Today / Yesterday / 📅), Who (member avatars for ≤4,
//     a picker beyond), Recurring.
// The docked save button announces what it does ("Add expense · $12.50").
// Supports an `initial` prefill (e.g. a scanned receipt) and learns
// label→category on save.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, Plus } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import {
  FormRow,
  FormSection,
  RowValue,
  SelectRow,
  TextRow,
  ToggleRow,
} from '@/components/form'
import { useRevealOnFocus } from '@/components/KeyboardScroll'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import {
  builtinCategories,
  categoryById,
  isBuiltinCategory,
  normalizeLabel,
  suggestCategory,
  type Category,
} from '@/lib/categories'
import { track } from '@/lib/analytics'
import { addDaysISO, formatMoney, shortName, todayISO } from '@/lib/format'
import { memberColor } from '@/lib/calendar'
import { supabase } from '@/lib/supabase'
import type { CategoryOverride, CategoryRule, CustomCategory, Entry, EntryType, Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { DatePickerModal } from './shared'
import { FormSheet } from './FormSheet'
import ManageCategoriesSheet from './ManageCategoriesSheet'

export interface EntryPrefill {
  label?: string
  amount?: number
  category?: string
  subcategory?: string | null
  entry_date?: string | null
}

/** Chips shown when the household has no history yet. */
const FALLBACK_TOP = ['groceries', 'dining', 'transport']

const ROW_MIN_H = 50

/** Strip a hint's wrapping parentheses: "(suggested as you type)" was
 *  written to sit inline after a label; under one, the brackets are noise. */
function bareHint(s: string): string {
  return s.replace(/^\s*\((.*)\)\s*$/, '$1')
}

/** "Nov 3" — short enough to sit in the date segment. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Row pieces (module scope: never define components in a render body) ────

type SegOption<T extends string> = { value: T; label?: string; icon?: ReactNode; a11y?: string }

/** A compact, content-sized segmented control that sits on the RIGHT of a
 *  row (form's Segmented is full-width). Neutral track, the selected segment
 *  a raised card — a choice, not an action, so no accent fill. Every tap
 *  reports, even on the selected segment (the 📅 one reopens the calendar). */
function MiniSegment<T extends string>({
  value,
  options,
  onPress,
}: {
  value: T
  options: SegOption<T>[]
  onPress: (v: T) => void
}) {
  const { c, dark } = useTheme()
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.pill, padding: 3, flexShrink: 1 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onPress(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.a11y ?? o.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: on ? (dark ? 'rgba(255,255,255,0.16)' : '#FFFFFF') : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on && !dark ? 0.08 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          >
            {o.icon}
            {o.label ? (
              <Txt
                style={{ fontSize: 13, fontFamily: on ? fonts.semibold : fonts.medium, color: on ? c.text : c.textMuted }}
                numberOfLines={1}
              >
                {o.label}
              </Txt>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/** ↓ Expense / ↑ Income as two pills; the chosen one filled in its colour. */
function TypeToggle({ value, onChange }: { value: EntryType; onChange: (v: EntryType) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const opts: { v: EntryType; label: string; color: string; Icon: typeof ArrowDown }[] = [
    // The strings carry a "−"/"+" for the old text-only switch; the arrow says it now.
    { v: 'expense', label: t('entry.expense').replace(/^[−+＋-]\s*/, ''), color: c.expense, Icon: ArrowDown },
    { v: 'income', label: t('entry.income').replace(/^[−+＋-]\s*/, ''), color: c.income, Icon: ArrowUp },
  ]
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'center', gap: 6, backgroundColor: c.surface, borderRadius: radius.pill, padding: 4 }}>
      {opts.map(({ v, label, color, Icon }) => {
        const on = value === v
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: on ? color : 'transparent',
            }}
          >
            <Icon size={15} color={on ? '#fff' : c.textMuted} strokeWidth={2.4} />
            <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: on ? '#fff' : c.textMuted }}>{label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The chosen category as a chip under the amount; tap opens the full grid. */
function CategoryChip({ icon, name, hint, onPress }: { icon: string; name: string; hint?: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingLeft: 6,
          paddingRight: 12,
          paddingVertical: 6,
          borderRadius: radius.pill,
          backgroundColor: c.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Txt style={{ fontSize: 16 }}>{icon}</Txt>
        </View>
        <Txt style={{ fontSize: 15, fontFamily: fonts.semibold, color: c.text }} numberOfLines={1}>
          {name}
        </Txt>
        <ChevronDown size={15} color={c.textMuted} />
      </Pressable>
      {hint ? (
        <Txt variant="faint" style={{ fontSize: 12 }}>
          {hint}
        </Txt>
      ) : null}
    </View>
  )
}

/** Who paid / received: member avatars (initial in their calendar colour). */
function WhoChips({
  profiles,
  value,
  onChange,
}: {
  profiles: Profile[]
  value: string
  onChange: (email: string) => void
}) {
  const { c } = useTheme()
  const emails = profiles.map((p) => p.email)
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexShrink: 1 }}>
      {profiles.map((p) => {
        const on = p.email === value
        const tint = memberColor(p.email, emails)
        return (
          <Pressable
            key={p.email}
            onPress={() => onChange(p.email)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={p.display_name}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingLeft: 4,
              paddingRight: 10,
              paddingVertical: 4,
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: on ? tint : 'transparent',
              backgroundColor: on ? tint + '1A' : 'transparent',
            }}
          >
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>
                {(p.display_name || p.email).charAt(0).toUpperCase()}
              </Txt>
            </View>
            <Txt style={{ fontSize: 13, fontFamily: on ? fonts.semibold : fonts.medium, color: on ? c.text : c.textMuted }}>
              {shortName(p.display_name)}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** A short horizontal strip of small neutral pills — the quick categories and
 *  the subcategory suggestions. `active` gets a soft accent tint. */
function PillStrip({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: sp.sm, paddingHorizontal: sp.md, paddingVertical: 10 }}
    >
      {children}
    </ScrollView>
  )
}

function Pill({
  label,
  icon,
  active,
  onPress,
}: {
  label: string
  icon?: string
  active?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: active ? c.action : c.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon ? <Txt style={{ fontSize: 14 }}>{icon}</Txt> : null}
      <Txt
        style={{ fontSize: 13, fontFamily: active ? fonts.semibold : fonts.medium, color: active ? c.onAction : c.textMuted }}
        numberOfLines={1}
      >
        {label}
      </Txt>
    </Pressable>
  )
}

/** Emoji + name + Add, for creating a custom category from the picker. Its own
 *  component so it can reveal itself above the keyboard (KeyboardScroll). */
function NewCategoryRow({
  icon,
  name,
  onIcon,
  onName,
  onAdd,
  busy,
}: {
  icon: string
  name: string
  onIcon: (v: string) => void
  onName: (v: string) => void
  onAdd: () => void
  busy: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  const canAdd = !busy && Boolean(name.trim())
  return (
    <View
      ref={row}
      style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, minHeight: ROW_MIN_H, paddingHorizontal: sp.sm, paddingVertical: 6 }}
    >
      <TextInput
        value={icon}
        onChangeText={onIcon}
        placeholder="🏷️"
        placeholderTextColor={c.textFaint}
        maxLength={4}
        accessibilityLabel={t('entry.newCategoryIcon')}
        onFocus={() => reveal(row.current)}
        style={{
          width: 40,
          height: 38,
          textAlign: 'center',
          backgroundColor: c.surface,
          borderRadius: radius.sm,
          fontSize: 18,
          color: c.text,
        }}
      />
      <TextInput
        value={name}
        onChangeText={onName}
        placeholder={t('entry.newCategoryPlaceholder')}
        placeholderTextColor={c.textFaint}
        maxLength={40}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => canAdd && onAdd()}
        onFocus={() => reveal(row.current)}
        style={{ flex: 1, minWidth: 0, height: 38, fontSize: 15, fontFamily: fonts.body, color: c.text }}
      />
      <Pressable
        onPress={onAdd}
        disabled={!canAdd}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: c.action,
          borderRadius: radius.pill,
          paddingHorizontal: 14,
          paddingVertical: 8,
          opacity: !canAdd ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 14 }}>{t('common.add')}</Txt>
      </Pressable>
    </View>
  )
}

/** The full category picker: a grid of every expense category in a sheet,
 *  a "New" tile that opens an inline create row, and Manage categories.
 *  Rendered INSIDE the entry form's Modal (via FormSheet's overlay) — a
 *  sibling Modal of an open one fails to present on iOS. */
function CategorySheet({
  visible,
  selectedId,
  cats,
  catName,
  customCats,
  overrides,
  onPick,
  onCreated,
  onManageChanged,
  onClose,
}: {
  visible: boolean
  selectedId: string
  cats: Category[]
  catName: (cat: Category) => string
  customCats: CustomCategory[]
  overrides: CategoryOverride[]
  onPick: (id: string) => void
  onCreated: (cat: CustomCategory) => void
  onManageChanged: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  async function createCategory() {
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreating(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('custom_categories')
      .insert({ name: trimmed, icon: newIcon.trim() || '🏷️' })
      .select()
      .single()
    setCreating(false)
    if (err || !data) {
      setError(t('entry.categoryCreateFailed'))
      return
    }
    setNewOpen(false)
    setNewName('')
    setNewIcon('')
    onCreated(data as CustomCategory)
  }

  return (
    <FormSheet
      visible={visible}
      title={t('entry.category')}
      onClose={onClose}
      onBackdropPress={onClose}
      maxShare={0.85}
      overlay={
        manageOpen ? (
          <ManageCategoriesSheet
            categories={customCats}
            overrides={overrides}
            onChanged={onManageChanged}
            onClose={() => setManageOpen(false)}
          />
        ) : null
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
        {cats.map((cat) => {
          const active = selectedId === cat.id
          return (
            <Pressable
              key={cat.id}
              onPress={() => onPick(cat.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={catName(cat)}
              style={({ pressed }) => ({
                width: '22.5%',
                alignItems: 'center',
                paddingVertical: 10,
                paddingHorizontal: 2,
                borderRadius: radius.md,
                backgroundColor: active ? c.action : c.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Txt style={{ fontSize: 22 }}>{cat.icon}</Txt>
              <Txt
                style={{
                  fontSize: 11,
                  marginTop: 3,
                  color: active ? c.accent : c.textMuted,
                  fontFamily: active ? fonts.semibold : fonts.body,
                }}
                numberOfLines={1}
              >
                {catName(cat)}
              </Txt>
            </Pressable>
          )
        })}
        <Pressable
          onPress={() => setNewOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: newOpen }}
          style={({ pressed }) => ({
            width: '22.5%',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 10,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: newOpen ? c.accent : c.textFaint,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Plus size={20} color={newOpen ? c.accent : c.textMuted} />
          <Txt style={{ fontSize: 11, marginTop: 3, color: newOpen ? c.accent : c.textMuted }} numberOfLines={1}>
            {t('entry.newCategory')}
          </Txt>
        </Pressable>
      </View>

      {newOpen ? (
        <View style={{ gap: 6 }}>
          <FormSection>
            <NewCategoryRow
              icon={newIcon}
              name={newName}
              onIcon={setNewIcon}
              onName={setNewName}
              onAdd={createCategory}
              busy={creating}
            />
          </FormSection>
          {error ? <Txt style={{ color: c.expense, fontSize: 13, marginHorizontal: sp.md }}>{error}</Txt> : null}
        </View>
      ) : null}

      {/* edit / delete the household's categories, rename the built-ins */}
      <FormSection>
        <FormRow label={t('manageCats.title')} onPress={() => setManageOpen(true)} chevron />
      </FormSection>
    </FormSheet>
  )
}

export default function EntryForm({
  monthId,
  periodStart,
  periodEnd,
  profiles,
  myEmail,
  rules,
  subcategorySuggestions,
  customCategories,
  categoryOverrides,
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
  /** Household overrides of the built-in presets (name/icon). */
  categoryOverrides: CategoryOverride[]
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
  const [date, setDate] = useState(entry?.entry_date ?? initialDate ?? defaultDate)
  const [pickOpen, setPickOpen] = useState(false)
  const [recurring, setRecurring] = useState(entry?.recurring ?? false)
  const [personEmail, setPersonEmail] = useState(entry?.person_email ?? myEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Category picker: a short strip by default, the full grid in a sheet.
  const [gridOpen, setGridOpen] = useState(false)
  const [localCats, setLocalCats] = useState<CustomCategory[]>(customCategories)
  const [localOverrides, setLocalOverrides] = useState<CategoryOverride[]>(categoryOverrides)

  // Auto-categorize as the label is typed, until the user picks manually.
  useEffect(() => {
    if (categoryTouched || type !== 'expense') return
    setCategory(suggestCategory(label, rules))
  }, [label, categoryTouched, type, rules])

  const parsedAmount = parseFloat(amount.replace(',', '.'))
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0

  const selectedCat = categoryById(category, localCats, localOverrides)
  // Built-in names are localized UNLESS the household overrode the name.
  const catName = (cat: Category) => {
    if (!isBuiltinCategory(cat.id)) return cat.name
    const o = localOverrides.find((x) => x.base_id === cat.id)
    return o?.name ?? t(`cat.${cat.id}` as TKey)
  }
  const allExpenseCats: Category[] = useMemo(
    () => [
      ...builtinCategories(localOverrides).filter((x) => x.id !== 'salary'),
      ...localCats.map((x) => ({ id: x.id, name: x.name, icon: x.icon })),
    ],
    [localCats, localOverrides],
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

  function categoryCreated(cat: CustomCategory) {
    setLocalCats((prev) => [...prev, cat])
    pickCategory(cat.id)
    onCategoryCreated()
  }

  // Re-sync the custom categories after the Manage sheet edits/deletes/adds, and
  // let the parent reload (a delete reassigns entries to "Other").
  async function refreshCats() {
    const [custom, ovr] = await Promise.all([
      supabase.from('custom_categories').select('*').order('created_at'),
      supabase.from('category_overrides').select('base_id, name, icon'),
    ])
    setLocalCats((custom.data as CustomCategory[]) ?? [])
    setLocalOverrides((ovr.data as CategoryOverride[]) ?? [])
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
    track(entry ? 'entry.updated' : 'entry.created', {
      kind: type,
      label: payload.label,
      amount: parsedAmount,
    })
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
          track('entry.deleted', { kind: entry.type, label: entry.label, amount: entry.amount })
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

  // Date: Today / Yesterday (when inside this period) / 📅 any other day.
  type DateKey = 'today' | 'yesterday' | 'other'
  const dateKey: DateKey = date === today ? 'today' : date === yesterday ? 'yesterday' : 'other'
  const dateOptions: SegOption<DateKey>[] = [
    ...(inPeriod(today) ? [{ value: 'today' as const, label: t('entry.today') }] : []),
    ...(inPeriod(yesterday) ? [{ value: 'yesterday' as const, label: t('entry.yesterday') }] : []),
    {
      value: 'other' as const,
      label: dateIsOther ? shortDay(date) : undefined,
      icon: <CalendarDays size={15} color={dateIsOther ? c.text : c.textMuted} />,
      a11y: t('entry.pickDate'),
    },
  ]
  function pickDateKey(k: DateKey) {
    if (k === 'today') {
      setDate(today)
      setPickOpen(false)
    } else if (k === 'yesterday') {
      setDate(yesterday)
      setPickOpen(false)
    } else {
      setPickOpen(true)
    }
  }

  // Who: a segment for a small household, a picker beyond three members.
  const who = profiles.find((p) => p.email === personEmail)
  const whoRow =
    profiles.length > 4 ? (
      <SelectRow
        label={t('entry.who')}
        value={personEmail}
        options={profiles.map((p) => ({ value: p.email, label: shortName(p.display_name) }))}
        onChange={(v) => v && setPersonEmail(v)}
      />
    ) : profiles.length > 1 ? (
      <FormRow label={t('entry.who')}>
        <WhoChips profiles={profiles} value={personEmail} onChange={setPersonEmail} />
      </FormRow>
    ) : (
      <FormRow label={t('entry.who')}>
        <RowValue value={who ? shortName(who.display_name) : null} placeholder="—" />
      </FormRow>
    )

  return (
    <FormSheet
      title={title}
      onClose={onClose}
      footer={
        <>
          {error ? <Txt style={{ color: c.expense, fontSize: 13 }}>{error}</Txt> : null}
          <Btn title={saveTitle} onPress={save} loading={saving} />
          {entry ? (
            <Pressable
              onPress={remove}
              disabled={saving}
              accessibilityRole="button"
              style={{ paddingVertical: 8, alignItems: 'center' }}
            >
              <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 14 }}>{t('entry.deleteEntry')}</Txt>
            </Pressable>
          ) : null}
        </>
      }
      overlay={
        <>
          {/* Nested inside the form's Modal (a sibling Modal fails on iOS). */}
          <DatePickerModal
            visible={pickOpen}
            value={date}
            onChange={setDate}
            onClose={() => setPickOpen(false)}
          />
          <CategorySheet
            visible={gridOpen}
            selectedId={category}
            cats={allExpenseCats}
            catName={catName}
            customCats={localCats}
            overrides={localOverrides}
            onPick={pickCategory}
            onCreated={categoryCreated}
            onManageChanged={refreshCats}
            onClose={() => setGridOpen(false)}
          />
        </>
      }
    >
      {/* hero: what kind, how much, which category — tinted red / green */}
      <View style={[styles.hero, { backgroundColor: (type === 'expense' ? c.expense : c.income) + '12' }]}>
        <TypeToggle value={type} onChange={setType} />
        <View style={styles.amountRow}>
          <Txt
            style={{
              fontSize: 30,
              fontFamily: fonts.displaySemi,
              color: amount ? (type === 'expense' ? c.expense : c.income) : c.textFaint,
              marginRight: 2,
            }}
          >
            {type === 'expense' ? '−$' : '+$'}
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
              fontSize: 56,
              fontFamily: fonts.display,
              fontVariant: ['tabular-nums'],
              color: type === 'expense' ? c.expense : c.income,
              minWidth: 120,
              textAlign: 'center',
              padding: 0,
            }}
          />
        </View>
        {type === 'expense' ? (
          <CategoryChip
            icon={selectedCat.icon}
            name={catName(selectedCat)}
            hint={!categoryTouched ? bareHint(t('entry.autoSuggested')) : undefined}
            onPress={() => setGridOpen(true)}
          />
        ) : null}
      </View>

      <FormSection>
        <TextRow
          label={t('entry.label')}
          value={label}
          onChangeText={setLabel}
          placeholder={
            type === 'expense' ? t('entry.labelExpensePlaceholder') : t('entry.labelIncomePlaceholder')
          }
          autoCapitalize="sentences"
          returnKeyType="done"
        />
      </FormSection>

      {type === 'expense' ? (
        <FormSection>
          {quickIds.length > 0 ? (
            <PillStrip>
              {quickIds.map((id) => {
                const qc = categoryById(id, localCats, localOverrides)
                return <Pill key={id} icon={qc.icon} label={catName(qc)} onPress={() => pickCategory(id)} />
              })}
              <Pressable
                onPress={() => setGridOpen(true)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 2,
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: c.accent }}>{t('common.all')}</Txt>
                <ChevronRight size={14} color={c.accent} />
              </Pressable>
            </PillStrip>
          ) : null}
          <TextRow
            label={t('entry.subcategory')}
            value={subcategory}
            onChangeText={setSubcategory}
            placeholder={
              isBuiltinCategory(category)
                ? t(`entry.sub.${category}` as TKey)
                : t('entry.subcategoryPlaceholder')
            }
          />
          {subSuggestions.length > 0 ? (
            <PillStrip>
              {subSuggestions.map((s) => {
                const active = subcategory.trim().toLowerCase() === s.toLowerCase()
                return <Pill key={s} label={s} active={active} onPress={() => setSubcategory(active ? '' : s)} />
              })}
            </PillStrip>
          ) : null}
        </FormSection>
      ) : null}

      <FormSection>
        <FormRow label={t('entry.date')}>
          <MiniSegment value={dateKey} options={dateOptions} onPress={pickDateKey} />
        </FormRow>
        {whoRow}
        <ToggleRow
          label={t('entry.recurring')}
          hint={bareHint(t('entry.recurringHint'))}
          value={recurring}
          onValueChange={setRecurring}
        />
      </FormSection>
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  hero: { borderRadius: 26, paddingVertical: sp.lg, paddingHorizontal: sp.md, gap: sp.md },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
