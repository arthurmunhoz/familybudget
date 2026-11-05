// Add/edit a pet — a bottom-sheet modal wrapper around the shared PetEditor
// (which owns the fields, photo upload, and save). Used for the "Add pet" flow
// in PetCare; the pet details screen embeds PetEditor inline instead.
//
// Keyboard: the sheet sits ON TOP of the keyboard (useSheetLift — measured,
// and on Android also clear of the navigation bar), and PetEditor's `dock`
// layout scrolls the fields in a <KeyboardScroll>, which brings the focused
// one into that window, with Save docked under it. Without both, the lower
// half of a long form — Color, Weight, Microchip, Notes — was typed blind
// under the keyboard.
import { Modal, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import type { Pet } from '@/lib/types'
import { sp, useTheme } from '@/theme/theme'
import { PetEditor } from './PetEditor'
import { PetHero, usePetIdentity } from './petIdentity'

/** Share of the available height the sheet may take. */
const SHEET_SHARE = 0.94

export default function PetForm({
  pet,
  onClose,
  onSaved,
}: {
  pet: Pet | null
  onClose: () => void
  onSaved: (name?: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  // The sheet's photo just sits at the top of the scroll — nothing to pin to.
  const identity = usePetIdentity(pet)

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View
          style={[
            styles.sheet,
            // Measured against what the keyboard leaves, not the whole window,
            // so the sheet never grows behind it.
            { backgroundColor: c.sheet, maxHeight: room * SHEET_SHARE, marginBottom: lift },
          ]}
        >
          <View style={styles.sheetHead}>
            <Txt variant="h2">{pet ? t('pets.editPet') : t('pets.addPet')}</Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[styles.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <PetEditor
            pet={pet}
            identity={identity}
            onSaved={onSaved}
            top={<PetHero identity={identity} />}
            dock={{ clearOfBars }}
          />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: sp.lg,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
