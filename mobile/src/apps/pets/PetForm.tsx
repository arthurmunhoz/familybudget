// Add/edit a pet — a bottom-sheet modal wrapper around the shared PetEditor
// (which owns the fields, photo upload, and save). Used for the "Add pet" flow
// in PetCare; the pet details screen embeds PetEditor inline instead.
//
// Keyboard: the sheet shrinks to sit ON TOP of the keyboard, and the scroller
// is a <KeyboardScroll>, which brings the focused field into that window.
// Without both, the lower half of a long form — Color, Weight, Microchip,
// Notes — was typed blind under the keyboard.
//
// The lift is MEASURED, not assumed, because the two platforms differ: RN gives
// an Android modal's dialog `SOFT_INPUT_ADJUST_RESIZE`, so its window shrinks
// on its own, while an iOS modal's doesn't move at all. Lifting by the keyboard
// height on both would leave Android's sheet floating a keyboard's worth too
// high. So: compare the root's height now against its height with no keyboard,
// and only make up the difference (see `lift`).
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'

import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight'
import type { Pet } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { PetEditor } from './PetEditor'
import { PetHero, usePetIdentity } from './petIdentity'

/** Share of the available height the sheet may take. */
const SHEET_SHARE = 0.92

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
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const kb = useKeyboardHeight()
  // The sheet's photo just sits at the top of the scroll — nothing to pin to.
  const identity = usePetIdentity(pet)

  // How much room the modal actually has, and how much of it the platform has
  // already taken away for the keyboard.
  const [rootH, setRootH] = useState(0)
  const restH = useRef(0)
  useEffect(() => {
    if (kb === 0 && rootH > 0) restH.current = rootH
  }, [kb, rootH])
  const available = rootH || win.height
  const absorbed = restH.current ? Math.max(0, restH.current - available) : 0
  const lift = Math.max(0, kb - absorbed)

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onLayout={(e) => setRootH(e.nativeEvent.layout.height)}
      >
        <View
          style={{
            // Measured against what the keyboard leaves, not the whole window,
            // so the sheet never grows behind it.
            maxHeight: (available - lift) * SHEET_SHARE,
            marginBottom: lift,
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
            <Txt variant="h2">{pet ? t('pets.editPet') : t('pets.addPet')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          <KeyboardScroll
            // flexShrink so the scroller yields to the sheet's max height
            // instead of overflowing it once the keyboard has taken half the
            // screen; flexGrow 0 so a short form is still a short sheet.
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{
              paddingHorizontal: sp.lg,
              // Clear of Android's navigation bar (and the iPhone's home
              // indicator), which otherwise sits on top of the Add-pet button.
              // Not needed while the keyboard is up — the sheet is above it.
              paddingBottom: kb > 0 ? sp.lg : insets.bottom + sp.lg,
            }}
          >
            <View style={{ marginBottom: sp.sm }}>
              <PetHero identity={identity} />
            </View>
            <PetEditor pet={pet} identity={identity} onSaved={onSaved} />
          </KeyboardScroll>
        </View>
      </View>
    </Modal>
  )
}
