// Edit sheet — rename a document, change its category / owner, and REPLACE ITS
// FILE (2026-11, owner: an ID that expired had to be deleted and re-added just
// to swap the photo). A replacement is uploaded to a NEW path (paths are
// content-addressed — bytes at a path never change, which is what lets the
// list cache thumbnails by path forever); on save the row points at it and the
// old file + thumbnail are removed. Title, type and owner are kept.
//
// 2026-11 redesign (components/form): title, category and owner are rows of
// one section — category and owner open checked lists instead of chip walls.
import { useState } from 'react'
import { Alert, Modal, StyleSheet, TextInput, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { FileText, Pencil, ScanLine, Upload, X } from 'lucide-react-native'
import { Image } from 'expo-image'

import { Btn, Txt } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { FormSection, SelectRow } from '@/components/form'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { FamilyDocument, DocCategory, Profile } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, formatBytes, randomUUID, thumbPathFor } from './docUtils'
import { pickFile, scanDocument, uploadThumb } from './docPicker'
import type { PickedFile } from './UploadSheet'
import { track } from '@/lib/analytics'

export default function EditSheet({
  doc,
  profiles,
  householdId,
  thumbUrl,
  onClose,
  onSaved,
  onDelete,
}: {
  doc: FamilyDocument
  profiles: Profile[]
  /** Storage paths must sit in the household's folder (bucket policy). */
  householdId: string
  /** Signed URL of the current file's thumbnail (or the image itself). */
  thumbUrl?: string
  onClose: () => void
  onSaved: () => void
  /** Deleting moved OFF the list row and in here — it's rare and irreversible,
   *  so it belongs behind a deliberate step rather than one tap from a list. */
  onDelete: () => void
}) {
  const { c } = useTheme()
  // Half the home-indicator inset (like NewItemButton) so Save's curved
  // bottom corners sit on the display's curve.
  const bottomGap = useBottomGap(sp.xs)
  const { t } = useI18n()

  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState<DocCategory>(doc.category)
  const [owner, setOwner] = useState(doc.owner_email)
  const [saving, setSaving] = useState(false)
  // Title field sizing: the text's own width, capped by the row.
  const [textW, setTextW] = useState(0)
  const [rowW, setRowW] = useState(0)
  // A replacement file waiting for Save (null = keep the current one).
  const [replacement, setReplacement] = useState<PickedFile | null>(null)
  const [picking, setPicking] = useState(false)

  async function pickReplacement(how: 'scan' | 'file') {
    if (picking || saving) return
    setPicking(true)
    try {
      const f = how === 'scan' ? await scanDocument(t) : await pickFile(t)
      if (f) setReplacement(f)
    } finally {
      setPicking(false)
    }
  }

  const ownerOptions = [
    ...profiles.map((p) => ({ value: p.email, label: p.display_name })),
    { value: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]
  const categoryOptions = CATEGORIES.map((cat) => ({ value: cat.id, label: t(`docCat.${cat.id}` as TKey) }))

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    let fileFields: { file_path: string; mime_type: string; size_bytes: number } | null = null
    if (replacement) {
      const path = `${householdId}/${category}/${randomUUID()}.${replacement.ext}`
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, replacement.bytes, { contentType: replacement.mime, cacheControl: '604800' })
      if (upErr) {
        setSaving(false)
        Alert.alert(t('docs.replaceFailed'))
        return
      }
      if (replacement.thumbUri) await uploadThumb(replacement.thumbUri, path)
      fileFields = { file_path: path, mime_type: replacement.mime, size_bytes: replacement.size }
    }
    const { error } = await supabase
      .from('documents')
      .update({ title: title.trim(), category, owner_email: owner, ...(fileFields ?? {}) })
      .eq('id', doc.id)
    if (error) {
      // Don't leave the new upload orphaned if the row couldn't point at it.
      if (fileFields) await supabase.storage.from('documents').remove([fileFields.file_path, thumbPathFor(fileFields.file_path)])
      setSaving(false)
      Alert.alert(t('docs.editSaveFailed'))
      return
    }
    if (fileFields) {
      // The row now points at the new file; the old one goes.
      await supabase.storage.from('documents').remove([doc.file_path, thumbPathFor(doc.file_path)])
      track('doc.replaced', { title: title.trim(), category })
    }
    setSaving(false)
    onSaved()
  }

  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift }]}>
          {/* The document's own title leads, large and editable in place
              (owner, 2026-11: it used to sit as a small row further down). */}
          <View style={styles.sheetHead}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: c.textMuted }}>
                {t('docs.editDoc')}
              </Txt>
              {/* The field is as wide as its text (measured by an invisible
                  twin — a TextInput doesn't size to its content), so the
                  pencil sits right where the title ends, well clear of ✕. */}
              <View
                onLayout={(e) => setRowW(e.nativeEvent.layout.width)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}
              >
                <Txt
                  numberOfLines={1}
                  onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
                  style={[styles.titleText, { position: 'absolute', opacity: 0 }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {title || t('docs.titlePlaceholder')}
                </Txt>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t('docs.titlePlaceholder')}
                  placeholderTextColor={c.textFaint}
                  multiline
                  blurOnSubmit
                  returnKeyType="done"
                  accessibilityLabel={t('docs.titlePlaceholder')}
                  style={[
                    styles.titleText,
                    { color: c.text, padding: 0, width: rowW ? Math.min(textW + 4, rowW - 24) : undefined },
                  ]}
                />
                <Pencil size={16} color={c.textFaint} />
              </View>
            </View>
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
            {/* the file itself: what's there now, or the replacement waiting
                for Save — and the two ways to get a new one */}
            <View style={[styles.fileCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <FileText size={20} color={c.textFaint} />
                  {replacement?.thumbUri || (!replacement && thumbUrl) ? (
                    <Image
                      source={{ uri: replacement?.thumbUri ?? thumbUrl }}
                      contentFit="cover"
                      contentPosition="top"
                      style={StyleSheet.absoluteFill}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: replacement ? c.income : c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {replacement ? t('docs.newFile') : t('docs.currentFile')}
                  </Txt>
                  <Txt style={{ fontSize: 15, marginTop: 2 }} numberOfLines={1}>
                    {replacement ? replacement.name : doc.file_path.split('.').pop()?.toUpperCase()} ·{' '}
                    {formatBytes(replacement ? replacement.size : doc.size_bytes)}
                  </Txt>
                  {replacement ? (
                    <Pressable onPress={() => setReplacement(null)} hitSlop={6}>
                      <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13, marginTop: 4 }}>
                        {t('docs.undoReplace')}
                      </Txt>
                    </Pressable>
                  ) : (
                    <Txt variant="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {t('docs.replaceHint')}
                    </Txt>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.md }}>
                <Pressable
                  onPress={() => pickReplacement('scan')}
                  disabled={picking || saving}
                  style={[styles.fileBtn, { backgroundColor: c.sheet, borderColor: c.border }]}
                >
                  <ScanLine size={17} color={c.text} />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{t('docs.scan')}</Txt>
                </Pressable>
                <Pressable
                  onPress={() => pickReplacement('file')}
                  disabled={picking || saving}
                  style={[styles.fileBtn, { backgroundColor: c.sheet, borderColor: c.border }]}
                >
                  <Upload size={17} color={c.text} />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{t('docs.chooseFileShort')}</Txt>
                </Pressable>
              </View>
            </View>

            <FormSection>
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
              curveBottom
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  titleText: { fontFamily: fonts.display, fontSize: 26, lineHeight: 31 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  fileCard: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: sp.md },
  preview: {
    width: 54,
    height: 70,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  footer: { paddingHorizontal: sp.lg, paddingTop: sp.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
