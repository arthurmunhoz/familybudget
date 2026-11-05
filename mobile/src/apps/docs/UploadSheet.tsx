// Upload sheet — appears after a file is picked. Collects a title, category, and
// owner, then uploads the bytes to the private `documents` bucket at the
// household-prefixed path and inserts a `documents` row. Mirrors the PWA's
// upload form.
//
// 2026-11 redesign (components/form): the seven category chips and the owner
// chips are SelectRows now — one compact section instead of two chip walls.
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
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { DocCategory, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, formatBytes, randomUUID, thumbPathFor } from './docUtils'
import { uploadThumb } from './docPicker'

export interface PickedFile {
  name: string
  uri: string
  size: number
  /** Raw bytes read from the picked file. */
  bytes: Uint8Array
  mime: string
  ext: string
  /** Local image to draw the list thumbnail from: the photo itself, or a
   *  multi-page scan's FIRST page. Absent for a picked PDF (nothing on-device
   *  can render one), which then shows a typed placeholder in the list. */
  thumbUri?: string
}

export default function UploadSheet({
  file,
  profile,
  profiles,
  defaultCategory,
  defaultOwner,
  onClose,
  onSaved,
}: {
  file: PickedFile
  profile: Profile
  profiles: Profile[]
  defaultCategory: DocCategory
  defaultOwner: string
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { t } = useI18n()

  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ''))
  const [category, setCategory] = useState<DocCategory>(defaultCategory)
  const [owner, setOwner] = useState(defaultOwner)
  const [uploading, setUploading] = useState(false)

  const ownerOptions = [
    ...profiles.map((p) => ({ value: p.email, label: p.display_name })),
    { value: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]
  const categoryOptions = CATEGORIES.map((cat) => ({ value: cat.id, label: t(`docCat.${cat.id}` as TKey) }))

  async function upload() {
    if (!title.trim() || uploading) return
    setUploading(true)
    // Storage RLS only allows paths inside the user's own household folder.
    const path = `${profile.household_id}/${category}/${randomUUID()}.${file.ext}`
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(path, file.bytes, { contentType: file.mime, cacheControl: '604800' })
    if (storageError) {
      setUploading(false)
      Alert.alert(t('docs.uploadFailed'))
      return
    }
    // Before the row, so the list that reloads on save already finds it.
    if (file.thumbUri) await uploadThumb(file.thumbUri, path)
    const { error: dbError } = await supabase.from('documents').insert({
      title: title.trim(),
      category,
      file_path: path,
      mime_type: file.mime,
      size_bytes: file.size,
      owner_email: owner || profile.email,
      added_by: profile.email,
    })
    setUploading(false)
    if (dbError) {
      // Roll back the orphaned object if the row couldn't be written.
      await supabase.storage.from('documents').remove([path, thumbPathFor(path)])
      Alert.alert(t('docs.saveFailed'))
      return
    }
    track('doc.uploaded', { title: title.trim(), category })
    onSaved()
  }

  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: c.text }}>{t('docs.addDoc')}</Txt>
              <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
                {file.name} · {formatBytes(file.size)}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              disabled={uploading}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface, opacity: uploading ? 0.5 : 1 }]}
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
              <TextRow
                label={t('docs.titlePlaceholder')}
                value={title}
                onChangeText={setTitle}
                autoFocus
              />
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
          </KeyboardScroll>

          <View
            style={[
              styles.footer,
              { paddingBottom: clearOfBars ? sp.md : bottomGap, borderTopColor: c.border },
            ]}
          >
            <Btn
              title={uploading ? t('docs.uploading') : t('docs.saveDoc')}
              onPress={upload}
              disabled={!title.trim()}
              loading={uploading}
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
