// Manage budget categories. Two sections:
//  • Defaults — the built-in presets. Editing one stores a per-household
//    override (migration 056: name/icon, either nullable) instead of touching
//    the shared defaults; "reset" (↺) removes the override. Entries keep
//    referencing the preset id, so nothing migrates.
//  • Yours — the household's custom categories: edit inline, 🗑 delete (its
//    entries move to "Other" via delete_custom_category, migration 054), and an
//    "Add category" row.
// Opened from the entry form. Mirrors the Nudges "Edit presets" list pattern.
import { useState } from 'react'
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { Plus, RotateCcw, Trash2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { CATEGORIES } from '@/lib/categories'
import { supabase } from '@/lib/supabase'
import type { CategoryOverride, CustomCategory } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { KEYBOARD_DONE_ID } from '@/components/keyboardDoneId'

// Editable presets — salary is income-only, so it stays out of expense mgmt.
const PRESETS = CATEGORIES.filter((c) => c.id !== 'salary')

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

  const iconInput = {
    width: 46,
    height: 44,
    textAlign: 'center' as const,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    fontSize: 20,
    color: c.text,
  }
  const nameInput = {
    flex: 1,
    minWidth: 0,
    height: 44,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    fontSize: 16,
    color: c.text,
  }

  // Plain function (NOT a component — a component defined in the render body
  // would remount each keystroke and drop the input focus). Called directly.
  const editorRow = (onSave: () => void, saveLabel: string, key?: string) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.sm }}>
      <TextInput
        inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={draftIcon}
        onChangeText={setDraftIcon}
        placeholder="🏷️"
        placeholderTextColor={c.textFaint}
        maxLength={4}
        style={iconInput}
      />
      <TextInput
        inputAccessoryViewID={KEYBOARD_DONE_ID}
        value={draftName}
        onChangeText={setDraftName}
        placeholder={t('manageCats.namePlaceholder')}
        placeholderTextColor={c.textFaint}
        maxLength={40}
        autoFocus
        style={nameInput}
      />
      <Pressable
        onPress={onSave}
        disabled={busy || !draftName.trim()}
        style={({ pressed }) => ({
          backgroundColor: c.accent,
          borderRadius: radius.md,
          paddingHorizontal: sp.md,
          paddingVertical: 12,
          opacity: busy || !draftName.trim() ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        <Txt style={{ color: c.onAccent, fontFamily: fonts.semibold, fontSize: 14 }}>{saveLabel}</Txt>
      </Pressable>
      <Pressable onPress={cancelEdit} hitSlop={8} accessibilityLabel={t('common.cancel')}>
        <X size={20} color={c.textMuted} />
      </Pressable>
    </View>
  )

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: sp.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View
            style={{
              maxHeight: '88%',
              backgroundColor: c.sheet,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
            }}
          >
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
              <Txt variant="h2">{t('manageCats.title')}</Txt>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
                <X size={22} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xl }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Defaults (built-in presets) */}
              <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                {t('manageCats.defaults')}
              </Txt>
              {PRESETS.map((p) =>
                editingId === p.id ? (
                  editorRow(() => savePreset(p), t('common.save'), p.id)
                ) : (
                  <View key={p.id} style={rowStyle}>
                    <Pressable
                      onPress={() => startEditPreset(p)}
                      style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 12 }}
                    >
                      <Txt style={{ fontSize: 20 }}>{presetIcon(p.id, p.icon)}</Txt>
                      <Txt style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                        {presetName(p.id)}
                      </Txt>
                    </Pressable>
                    {overrideOf(p.id) ? (
                      <Pressable onPress={() => resetPreset(p.id)} hitSlop={8} accessibilityLabel={t('manageCats.reset')}>
                        <RotateCcw size={16} color={c.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                ),
              )}

              {/* Yours (custom categories) */}
              <Txt
                variant="label"
                style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginTop: sp.lg, marginBottom: 2 }}
              >
                {t('manageCats.yours')}
              </Txt>
              {customList.length === 0 && editingId !== 'new' ? (
                <Txt variant="faint" style={{ paddingVertical: sp.sm }}>
                  {t('manageCats.empty')}
                </Txt>
              ) : null}
              {customList.map((cat) =>
                editingId === cat.id ? (
                  editorRow(() => saveCustom(cat.id), t('common.save'), cat.id)
                ) : (
                  <View key={cat.id} style={rowStyle}>
                    <Pressable
                      onPress={() => startEditCustom(cat)}
                      style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 12 }}
                    >
                      <Txt style={{ fontSize: 20 }}>{cat.icon}</Txt>
                      <Txt style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                        {cat.name}
                      </Txt>
                    </Pressable>
                    <Pressable onPress={() => confirmDeleteCustom(cat)} hitSlop={8} accessibilityLabel={t('common.delete')}>
                      <Trash2 size={18} color={c.textFaint} />
                    </Pressable>
                  </View>
                ),
              )}

              {editingId === 'new' ? (
                editorRow(() => saveCustom('new'), t('common.add'))
              ) : (
                <Pressable
                  onPress={startNew}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: sp.sm,
                    marginTop: sp.md,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: c.textFaint,
                    borderRadius: radius.md,
                  }}
                >
                  <Plus size={18} color={c.textMuted} />
                  <Txt style={{ color: c.textMuted, fontFamily: fonts.semibold }}>{t('manageCats.add')}</Txt>
                </Pressable>
              )}

              <Txt variant="faint" style={{ marginTop: sp.md, fontSize: 12 }}>
                {t('manageCats.deleteHint')}
              </Txt>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
