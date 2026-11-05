// Edit sheet — rename a document and change its category / owner. The file
// bytes are immutable (content-addressed path); this only updates the row.
//
// 2026-11 redesign (components/form): title, category and owner are rows of
// one section — category and owner open checked lists instead of chip walls.
import { useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { X } from 'lucide-react-native'

import { Btn, Txt } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { FormSection, SelectRow, TextRow } from '@/components/form'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { FamilyDocument, DocCategory, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, sp, useTheme } from '@/theme/theme'
import { CATEGORIES } from './docUtils'

export default function EditSheet({
  doc,
  profiles,
  onClose,
  onSaved,
  onDelete,
}: {
  doc: FamilyDocument
  profiles: Profile[]
  onClose: () => void
  onSaved: () => void
  /** Deleting moved OFF the list row and in here — it's rare and irreversible,
   *  so it belongs behind a deliberate step rather than one tap from a list. */
  onDelete: () => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { t } = useI18n()

  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState<DocCategory>(doc.category)
  const [owner, setOwner] = useState(doc.owner_email)
  const [saving, setSaving] = useState(false)

  const ownerOptions = [
    ...profiles.map((p) => ({ value: p.email, label: p.display_name })),
    { value: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]
  const categoryOptions = CATEGORIES.map((cat) => ({ value: cat.id, label: t(`docCat.${cat.id}` as TKey) }))

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    const { error } = await supabase
      .from('documents')
      .update({ title: title.trim(), category, owner_email: owner })
      .eq('id', doc.id)
    setSaving(false)
    if (error) {
      Alert.alert(t('docs.editSaveFailed'))
      return
    }
    onSaved()
  }

  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          <View style={styles.sheetHead}>
            <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 22, color: c.text }}>{t('docs.editDoc')}</Txt>
            <Pressable
              onPress={onClose}
              disabled={saving}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface, opacity: saving ? 0.5 : 1 }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FormSection>
              <TextRow label={t('docs.titlePlaceholder')} value={title} onChangeText={setTitle} />
              <SelectRow
                label={t('entry.category')}
                value={category}
                options={categoryOptions}
                onChange={(v) => {
                  if (v) setCategory(v)
                }}
              />
              <SelectRow
                label={t('docs.belongsTo')}
                value={owner}
                options={ownerOptions}
                onChange={(v) => {
                  if (v) setOwner(v)
                }}
              />
            </FormSection>

            {/* Destructive action at the END of the content, not beside Save —
                it stays reachable without competing with the primary button,
                and Save remains the sole docked control. A quiet red label,
                matching Delete account / Disconnect elsewhere in the app. */}
            <Pressable
              onPress={onDelete}
              disabled={saving}
              accessibilityRole="button"
              style={({ pressed }) => [
                { alignSelf: 'center', paddingVertical: sp.sm, paddingHorizontal: sp.lg },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 14 }}>{t('common.delete')}</Txt>
            </Pressable>
          </KeyboardScroll>

          <View
            style={[
              styles.footer,
              { paddingBottom: clearOfBars ? sp.md : bottomGap, borderTopColor: c.border },
            ]}
          >
            <Btn
              title={saving ? t('common.saving') : t('common.saveChanges')}
              onPress={save}
              disabled={!title.trim()}
              loading={saving}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: sp.lg, paddingTop: sp.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
