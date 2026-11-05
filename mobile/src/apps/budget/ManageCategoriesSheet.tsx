// Manage budget categories. Two sections:
//  • Defaults — the built-in presets. Editing one stores a per-household
//    override (migration 056: name/icon, either nullable) instead of touching
//    the shared defaults; "reset" (↺) removes the override. Entries keep
//    referencing the preset id, so nothing migrates.
//  • Yours — the household's custom categories: edit inline, 🗑 delete (its
//    entries move to "Other" via delete_custom_category, migration 054), and an
//    "Add category" row.
// Opened from the entry form's category picker. Mirrors the Nudges "Edit
// presets" list pattern.
//
// 2026-11 redesign: grouped FormSections (rows + hairlines on a card) inside
// the shared FormSheet, instead of bare rows and a dashed add-button.
import { useRef, useState, type ReactNode } from 'react'
import { Alert, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { ChevronRight, Plus, RotateCcw, Trash2, X } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { FormSection } from '@/components/form'
import { useRevealOnFocus } from '@/components/KeyboardScroll'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { CATEGORIES } from '@/lib/categories'
import { supabase } from '@/lib/supabase'
import type { CategoryOverride, CustomCategory } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { FormSheet } from './FormSheet'

// Editable presets — salary is income-only, so it stays out of expense mgmt.
const PRESETS = CATEGORIES.filter((c) => c.id !== 'salary')

const ROW_MIN_H = 50

/** The inline editor that replaces a row while it's being edited: emoji +
 *  name + Save. Module scope so its inputs keep focus across re-renders. */
function EditorRow({
  icon,
  name,
  onIcon,
  onName,
  onSave,
  onCancel,
  saveLabel,
  busy,
}: {
  icon: string
  name: string
  onIcon: (v: string) => void
  onName: (v: string) => void
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  busy: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const reveal = useRevealOnFocus()
  const row = useRef<View>(null)
  const canSave = !busy && Boolean(name.trim())
  return (
    <View
      ref={row}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.sm,
        minHeight: ROW_MIN_H,
        paddingHorizontal: sp.sm,
        paddingVertical: 6,
      }}
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
        placeholder={t('manageCats.namePlaceholder')}
        placeholderTextColor={c.textFaint}
        maxLength={40}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => canSave && onSave()}
        onFocus={() => reveal(row.current)}
        style={{
          flex: 1,
          minWidth: 0,
          height: 38,
          fontSize: 15,
          fontFamily: fonts.body,
          color: c.text,
        }}
      />
      <Pressable
        onPress={onSave}
        disabled={!canSave}
        accessibilityRole="button"
        style={({ pressed }) => ({
          backgroundColor: c.action,
          borderRadius: radius.pill,
          paddingHorizontal: 14,
          paddingVertical: 8,
          opacity: !canSave ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 14 }}>{saveLabel}</Txt>
      </Pressable>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={14} color={c.textMuted} />
      </Pressable>
    </View>
  )
}

/** A category row: emoji + name (tap to edit), an optional trailing action. */
function CategoryRow({
  icon,
  name,
  onPress,
  trailing,
}: {
  icon: string
  name: string
  onPress: () => void
  trailing?: ReactNode
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('common.editName', { name })}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          minHeight: ROW_MIN_H,
          flexDirection: 'row',
          alignItems: 'center',
          gap: sp.md,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Txt style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{icon}</Txt>
        <Txt style={{ flex: 1, minWidth: 0, fontSize: 15, color: c.text }} numberOfLines={1}>
          {name}
        </Txt>
      </Pressable>
      {trailing ?? <ChevronRight size={16} color={c.textFaint} />}
    </View>
  )
}

export default function ManageCategoriesSheet({
  categories,
  overrides,
  onChanged,
  onClose,
}: {
  categories: CustomCategory[]
  overrides: CategoryOverride[]
  /** Called after any create/edit/delete/override so the parent can re-sync. */
  onChanged: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [customList, setCustomList] = useState<CustomCategory[]>(categories)
  const [ovr, setOvr] = useState<CategoryOverride[]>(overrides)
  // Row being edited: a preset id, a custom id, 'new', or null.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftIcon, setDraftIcon] = useState('')
  const [busy, setBusy] = useState(false)

  const overrideOf = (id: string) => ovr.find((o) => o.base_id === id)
  const presetName = (id: string) => overrideOf(id)?.name ?? t(`cat.${id}` as TKey)
  const presetIcon = (id: string, def: string) => overrideOf(id)?.icon ?? def

  function startEditPreset(p: { id: string; icon: string }) {
    setEditingId(p.id)
    setDraftName(presetName(p.id))
    setDraftIcon(presetIcon(p.id, p.icon))
  }
  function startEditCustom(cat: CustomCategory) {
    setEditingId(cat.id)
    setDraftName(cat.name)
    setDraftIcon(cat.icon)
  }
  function startNew() {
    setEditingId('new')
    setDraftName('')
    setDraftIcon('')
  }
  function cancelEdit() {
    setEditingId(null)
    setDraftName('')
    setDraftIcon('')
  }

  // Save a preset override: store only the fields that differ from the default
  // (so changing just the icon keeps the localized name). If nothing differs,
  // remove any existing override.
  async function savePreset(p: { id: string; icon: string }) {
    if (busy) return
    const name = draftName.trim()
    const icon = draftIcon.trim()
    const defName = t(`cat.${p.id}` as TKey)
    const nameToStore = name && name !== defName ? name : null
    const iconToStore = icon && icon !== p.icon ? icon : null
    const exists = !!overrideOf(p.id)
    const clear = nameToStore === null && iconToStore === null
    setBusy(true)
    const res = clear
      ? exists
        ? await supabase.from('category_overrides').delete().eq('base_id', p.id)
        : null
      : exists
        ? await supabase
            .from('category_overrides')
            .update({ name: nameToStore, icon: iconToStore })
            .eq('base_id', p.id)
        : await supabase
            .from('category_overrides')
            .insert({ base_id: p.id, name: nameToStore, icon: iconToStore })
    setBusy(false)
    if (res?.error) {
      Alert.alert(t('manageCats.saveError'))
      return
    }
    setOvr((prev) => {
      const rest = prev.filter((o) => o.base_id !== p.id)
      return nameToStore === null && iconToStore === null
        ? rest
        : [...rest, { base_id: p.id, name: nameToStore, icon: iconToStore }]
    })
    cancelEdit()
    onChanged()
  }

  async function resetPreset(id: string) {
    setBusy(true)
    const { error } = await supabase.from('category_overrides').delete().eq('base_id', id)
    setBusy(false)
    if (error) {
      Alert.alert(t('manageCats.saveError'))
      return
    }
    setOvr((prev) => prev.filter((o) => o.base_id !== id))
    if (editingId === id) cancelEdit()
    onChanged()
  }

  async function saveCustom(id: string) {
    const name = draftName.trim()
    if (!name || busy) return
    const icon = draftIcon.trim() || '🏷️'
    setBusy(true)
    if (id === 'new') {
      const { data, error } = await supabase
        .from('custom_categories')
        .insert({ name, icon })
        .select()
        .single()
      setBusy(false)
      if (error || !data) {
        Alert.alert(t('manageCats.saveError'))
        return
      }
      setCustomList((prev) => [...prev, data as CustomCategory])
    } else {
      const { error } = await supabase.from('custom_categories').update({ name, icon }).eq('id', id)
      setBusy(false)
      if (error) {
        Alert.alert(t('manageCats.saveError'))
        return
      }
      setCustomList((prev) => prev.map((x) => (x.id === id ? { ...x, name, icon } : x)))
    }
    cancelEdit()
    onChanged()
  }

  function confirmDeleteCustom(cat: CustomCategory) {
    Alert.alert(t('manageCats.deleteTitle', { name: cat.name }), t('manageCats.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('delete_custom_category', { p_id: cat.id })
          if (error) {
            Alert.alert(t('manageCats.deleteError'))
            return
          }
          setCustomList((prev) => prev.filter((x) => x.id !== cat.id))
          if (editingId === cat.id) cancelEdit()
          onChanged()
        },
      },
    ])
  }

  // Plain function, called directly (not a component): spreads the shared
  // draft state into an EditorRow.
  const editor = (onSave: () => void, saveLabel: string, key?: string) => (
    <EditorRow
      key={key}
      icon={draftIcon}
      name={draftName}
      onIcon={setDraftIcon}
      onName={setDraftName}
      onSave={onSave}
      onCancel={cancelEdit}
      saveLabel={saveLabel}
      busy={busy}
    />
  )

  const iconBtn = {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }

  return (
    <FormSheet
      title={t('manageCats.title')}
      onClose={onClose}
      footer={<Btn title={t('common.done')} onPress={onClose} />}
    >
      {/* Defaults (built-in presets) */}
      <FormSection title={t('manageCats.defaults')}>
        {PRESETS.map((p) =>
          editingId === p.id ? (
            editor(() => savePreset(p), t('common.save'), p.id)
          ) : (
            <CategoryRow
              key={p.id}
              icon={presetIcon(p.id, p.icon)}
              name={presetName(p.id)}
              onPress={() => startEditPreset(p)}
              trailing={
                overrideOf(p.id) ? (
                  <Pressable
                    onPress={() => resetPreset(p.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('manageCats.reset')}
                    style={[iconBtn, { backgroundColor: c.accentSoft }]}
                  >
                    <RotateCcw size={14} color={c.accent} />
                  </Pressable>
                ) : undefined
              }
            />
          ),
        )}
      </FormSection>

      {/* Yours (custom categories) + the add row at its foot */}
      <FormSection title={t('manageCats.yours')} footer={t('manageCats.deleteHint')}>
        {customList.length === 0 && editingId !== 'new' ? (
          <View style={{ minHeight: ROW_MIN_H, justifyContent: 'center', paddingHorizontal: sp.md }}>
            <Txt variant="faint" style={{ fontSize: 14 }}>
              {t('manageCats.empty')}
            </Txt>
          </View>
        ) : null}
        {customList.map((cat) =>
          editingId === cat.id ? (
            editor(() => saveCustom(cat.id), t('common.save'), cat.id)
          ) : (
            <CategoryRow
              key={cat.id}
              icon={cat.icon}
              name={cat.name}
              onPress={() => startEditCustom(cat)}
              trailing={
                <Pressable
                  onPress={() => confirmDeleteCustom(cat)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                  style={iconBtn}
                >
                  <Trash2 size={17} color={c.textFaint} />
                </Pressable>
              }
            />
          ),
        )}
        {editingId === 'new' ? (
          editor(() => saveCustom('new'), t('common.add'))
        ) : (
          <Pressable
            onPress={startNew}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp.md,
              minHeight: ROW_MIN_H,
              paddingHorizontal: sp.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View style={[styles.addDot, { backgroundColor: c.accentSoft }]}>
              <Plus size={15} color={c.accent} strokeWidth={2.5} />
            </View>
            <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 15 }}>{t('manageCats.add')}</Txt>
          </Pressable>
        )}
      </FormSection>
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  addDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
