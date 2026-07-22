// Edit sheet — rename a document and change its category / owner. The file
// bytes are immutable (content-addressed path); this only updates the row.
import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { FamilyDocument, DocCategory, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
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
  const { t } = useI18n()

  const [title, setTitle] = useState(doc.title)
  const [category, setCategory] = useState<DocCategory>(doc.category)
  const [owner, setOwner] = useState(doc.owner_email)
  const [saving, setSaving] = useState(false)

  const ownerOptions = [
    ...profiles.map((p) => ({ key: p.email, label: p.display_name })),
    { key: 'shared', label: `🏠 ${t('docs.shared')}` },
  ]

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
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
              // Room under the heading so the document's name isn't crowded
              // against it — that name is the thing being edited.
              paddingBottom: sp.lg,
            }}
          >
            <Txt variant="h2">{t('docs.editDoc')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')} disabled={saving}>
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
              // The document's name is the subject of this sheet — give it more
              // weight than the chips below it.
              style={{ fontSize: 18 }}
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

            {/* Destructive action at the END of the content, not beside Save —
                it stays reachable without competing with the primary button,
                and Save remains the sole footer control so its curve can meet
                the screen's corner. Red label matches Delete account /
                Disconnect elsewhere in the app. */}
            <Pressable
              onPress={onDelete}
              disabled={saving}
              accessibilityRole="button"
              style={({ pressed }) => [
                { alignSelf: 'center', paddingVertical: sp.sm, paddingHorizontal: sp.lg },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('common.delete')}</Txt>
            </Pressable>
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.xl }}>
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
