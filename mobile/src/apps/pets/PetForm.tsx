// Add/edit a pet — a bottom-sheet modal wrapper around the shared PetEditor
// (which owns the fields, photo upload, and save). Used for the "Add pet" flow
// in PetCare; the pet details screen embeds PetEditor inline instead.
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { Pet } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { PetEditor } from './PetEditor'

export default function PetForm({
  pet,
  onClose,
  onSaved,
}: {
  pet: Pet | null
  onClose: () => void
  onSaved: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '92%',
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
            <Txt variant="h2">{pet ? t('pets.editPet') : t('pets.addPet')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xl }}
            keyboardShouldPersistTaps="handled"
          >
            <PetEditor pet={pet} onSaved={onSaved} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
