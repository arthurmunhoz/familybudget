// The bottom-sheet frame every Money form shares (2026-11 form redesign): a
// title with a round × close, a KeyboardScroll body (`gap: sp.lg`, for
// FormSections), and an optional docked footer — the primary Btn — above a
// hairline. Keyboard handling is useSheetLift, the same as EditProfile (the
// reference): KeyboardAvoidingView mis-measures inside a <Modal>.
//
// `overlay` renders nested modals (date picker, category picker…) INSIDE this
// Modal's tree — a Modal rendered as a sibling of an open one silently fails
// to present on iOS.
import type { ReactNode } from 'react'
import { Keyboard, Modal, StyleSheet, View } from 'react-native'
import { X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import { fonts, sp, useTheme } from '@/theme/theme'

export function FormSheet({
  visible = true,
  title,
  onClose,
  onBackdropPress,
  children,
  footer,
  overlay,
  maxShare = 0.94,
}: {
  visible?: boolean
  title: string
  onClose: () => void
  /** Tap on the dimmed area. Default: dismiss the keyboard (a stray tap
   *  shouldn't throw away a half-filled form). */
  onBackdropPress?: () => void
  children: ReactNode
  /** Docked under the scroll, above a hairline — the primary action. */
  footer?: ReactNode
  /** Nested modals, kept inside this Modal's tree. */
  overlay?: ReactNode
  /** Tallest the sheet may get, as a share of the room above the keyboard. */
  maxShare?: number
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const edgePad = clearOfBars ? sp.md : bottomGap

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onBackdropPress ?? (() => Keyboard.dismiss())}
          accessible={false}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.sheet, maxHeight: room * maxShare, marginBottom: lift },
          ]}
        >
          <View style={styles.head}>
            <Txt
              variant="h2"
              style={{ fontFamily: fonts.displaySemi, fontSize: 20, flex: 1, minWidth: 0 }}
              numberOfLines={1}
            >
              {title}
            </Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              gap: sp.lg,
              paddingHorizontal: sp.lg,
              paddingBottom: footer ? sp.lg : edgePad,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </KeyboardScroll>

          {footer ? (
            <View
              style={{
                paddingHorizontal: sp.lg,
                paddingTop: sp.sm,
                paddingBottom: edgePad,
                gap: sp.sm,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }}
            >
              {footer}
            </View>
          ) : null}
          {overlay}
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
})
