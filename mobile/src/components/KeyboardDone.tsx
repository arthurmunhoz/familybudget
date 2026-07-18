// A "Done" bar pinned above the keyboard, so every keyboard in the app can be
// dismissed without hunting for an empty spot to tap.
//
// iOS has no global way to do this — the bar is an InputAccessoryView, attached
// per input via `inputAccessoryViewID={KEYBOARD_DONE_ID}`. The shared `Field`
// primitive sets it automatically; raw <TextInput>s pass it explicitly.
//
// It matters most for keyboards with NO return key to dismiss with: the numeric
// pads (amounts, measurements, prices) and multiline notes, where Return inserts
// a newline instead of closing.
//
// Mounted once, at the app root (see _layout). Android has no equivalent and
// doesn't need one (hardware/system back dismisses), so it renders nothing.
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native'

import { Txt } from './ui'
import { useI18n } from '../hooks/useI18n'
import { sp, useTheme } from '../theme/theme'

import { KEYBOARD_DONE_ID } from './keyboardDoneId'

export { KEYBOARD_DONE_ID }

export function KeyboardDoneBar() {
  const { c } = useTheme()
  const { t } = useI18n()

  if (Platform.OS !== 'ios') return null

  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          // Opaque on purpose: this sits on the keyboard, not on the app's
          // wash, so the glass skin's translucent tokens would look wrong here.
          backgroundColor: c.sheet,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          paddingHorizontal: sp.lg,
          paddingVertical: sp.sm,
        }}
      >
        <Pressable
          onPress={() => Keyboard.dismiss()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingHorizontal: sp.sm, paddingVertical: 4 })}
        >
          <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>{t('common.done')}</Txt>
        </Pressable>
      </View>
    </InputAccessoryView>
  )
}
