// Manage the household's CUSTOM budget categories (the 14 built-ins are app
// defaults and stay read-only). A scrollable list — tap a row to edit its emoji
// + name inline, 🗑 to delete (its entries move to "Other" via the
// delete_custom_category RPC, migration 054), and an "Add category" row for new
// ones. Mirrors the Nudges "Edit presets" pattern. Opened from the entry form.
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
import { Plus, Trash2, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import type { CustomCategory } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

export default function ManageCategoriesSheet({
  categories,
  onChanged,
  onClose,
}: {
  categories: CustomCategory[]
  /** Called after any create/edit/delete so the parent can re-sync. */
  onChanged: () => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [list, setList] = useState<CustomCategory[]>(categories)
  // The row currently being edited: a category id, 'new', or null (none).
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftIcon, setDraftIcon] = useState('')
  const [busy, setBusy] = useState(false)

  function startEdit(cat: CustomCategory) {
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

  async function saveEdit() {
    const name = draftName.trim()
    if (!name || busy) return
    const icon = draftIcon.trim() || '🏷️'
    setBusy(true)
    if (editingId === 'new') {
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
      setList((prev) => [...prev, data as CustomCategory])
    } else {
      const { error } = await supabase.from('custom_categories').update({ name, icon }).eq('id', editingId)
      setBusy(false)
      if (error) {
        Alert.alert(t('manageCats.saveError'))
        return
      }
      setList((prev) => prev.map((x) => (x.id === editingId ? { ...x, name, icon } : x)))
    }
    cancelEdit()
    onChanged()
  }

  function confirmDelete(cat: CustomCategory) {
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
          setList((prev) => prev.filter((x) => x.id !== cat.id))
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

  // A plain function that returns the inline editor row (NOT a component — see
  // the coding standard: a component defined in the render body would remount
  // each keystroke and drop the TextInput focus). Called directly below.
  const renderEditor = (isNew: boolean, key?: string) => (
      <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.sm }}>
        <TextInput
          value={draftIcon}
          onChangeText={setDraftIcon}
          placeholder="🏷️"
          placeholderTextColor={c.textFaint}
          maxLength={4}
          style={iconInput}
        />
        <TextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder={t('manageCats.namePlaceholder')}
          placeholderTextColor={c.textFaint}
          maxLength={40}
          autoFocus
          style={nameInput}
        />
        <Pressable
          onPress={saveEdit}
          disabled={busy || !draftName.trim()}
          style={({ pressed }) => ({
            backgroundColor: c.accent,
            borderRadius: radius.md,
            paddingHorizontal: sp.md,
            paddingVertical: 12,
            opacity: busy || !draftName.trim() ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14 }}>
            {isNew ? t('common.add') : t('common.save')}
          </Txt>
        </Pressable>
        <Pressable onPress={cancelEdit} hitSlop={8} accessibilityLabel={t('common.cancel')}>
          <X size={20} color={c.textMuted} />
        </Pressable>
      </View>
  )

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View
            style={{
              maxHeight: '85%',
              backgroundColor: c.card,
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
              {list.length === 0 && editingId !== 'new' ? (
                <Txt variant="faint" style={{ paddingVertical: sp.md }}>
                  {t('manageCats.empty')}
                </Txt>
              ) : null}

              {list.map((cat) =>
                editingId === cat.id ? (
                  renderEditor(false, cat.id)
                ) : (
                  <View
                    key={cat.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.md,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: c.border,
                    }}
                  >
                    <Pressable
                      onPress={() => startEdit(cat)}
                      style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 12 }}
                    >
                      <Txt style={{ fontSize: 20 }}>{cat.icon}</Txt>
                      <Txt style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                        {cat.name}
                      </Txt>
                    </Pressable>
                    <Pressable onPress={() => confirmDelete(cat)} hitSlop={8} accessibilityLabel={t('common.delete')}>
                      <Trash2 size={18} color={c.textFaint} />
                    </Pressable>
                  </View>
                ),
              )}

              {editingId === 'new' ? (
                renderEditor(true)
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
