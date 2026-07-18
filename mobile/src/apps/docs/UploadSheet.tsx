// Upload sheet — appears after a file is picked. Collects a title, category, and
// owner, then uploads the bytes to the private `documents` bucket at the
// household-prefixed path and inserts a `documents` row. Mirrors the PWA's
// upload form.
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { DocCategory, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, formatBytes, randomUUID } from './docUtils'

export interface PickedFile {
  name: string
  uri: string
  size: number
  /** Raw bytes read from the picked file. */
  bytes: Uint8Array
  mime: string
  ext: string
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
  const { t } = useI18n()

  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, ''))
  const [category, setCategory] = useState<DocCategory>(defaultCategory)
  const [owner, setOwner] = useState(defaultOwner)
  const [uploading, setUploading] = useState(false)

  const ownerOptions = [
    ...profiles.map((p) => ({ key: p.email, label: p.display_name })),
    { key: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]

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
      await supabase.storage.from('documents').remove([path])
      Alert.alert(t('docs.saveFailed'))
      return
    }
    track('doc.uploaded', { title: title.trim(), category })
    onSaved()
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '90%',
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
              paddingBottom: sp.sm,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="h2">{t('docs.addDoc')}</Txt>
              <Txt variant="faint" numberOfLines={1}>
                {file.name} · {formatBytes(file.size)}
              </Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')} disabled={uploading}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              value={title}
              onChangeText={setTitle}
              placeholder={t('docs.titlePlaceholder')}
              autoFocus
            />

            <ChipRow>
              {CATEGORIES.map((cat) => (
                <Chip key={cat.id} active={category === cat.id} onPress={() => setCategory(cat.id)}>
                  {cat.icon} {t(`docCat.${cat.id}` as TKey)}
                </Chip>
              ))}
            </ChipRow>

            <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('docs.belongsTo')}
            </Txt>
            <ChipRow>
              {ownerOptions.map((o) => (
                <Chip key={o.key} active={owner === o.key} onPress={() => setOwner(o.key)}>
                  {o.label}
                </Chip>
              ))}
            </ChipRow>
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl }}>
            <Btn
              title={uploading ? t('docs.uploading') : t('docs.saveDoc')}
              onPress={upload}
              disabled={!title.trim()}
              loading={uploading}
            />
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>{children}</View>
}

function Chip({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: active ? c.accent : c.surface,
      }}
    >
      <Txt style={{ color: active ? c.onAccent : c.textMuted, fontWeight: '600', fontSize: 14 }}>
        {children}
      </Txt>
    </Pressable>
  )
}
