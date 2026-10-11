// A native date/time picker that never lives inside the form.
//
// iOS gets a bottom sheet over a dimmed backdrop with a Done button; Android
// mounts `display="default"`, which IS the platform's own pop-up dialog. Before
// this, the calendar's time fields and the profile birthday dropped an inline
// iOS spinner straight into the form, shoving Save and everything under it
// down the page (reported 2026-10-11). Same shape as Money's DatePickerModal
// and Pet Care's date sheet, which already did this for plain dates.
//
// Selection applies live (each spin calls `onChange`), matching those two; Done
// and a tap on the backdrop only dismiss. The sheet is a <Modal> rendered where
// the field is, so inside an already-open sheet it NESTS rather than sitting
// beside it — a sibling Modal silently fails to present on iOS.
import { Modal, Platform, Pressable } from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'

import { Btn } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

export function PickerSheet({
  visible,
  mode,
  value,
  onChange,
  onClose,
  iosDisplay = mode === 'time' ? 'spinner' : 'inline',
  minimumDate,
  maximumDate,
}: {
  visible: boolean
  mode: 'date' | 'time'
  value: Date
  onChange: (date: Date) => void
  onClose: () => void
  /** iOS face: the calendar grid (`inline`) or wheels (`spinner`). Wheels suit
   *  times and dates far from today, like a birthday. */
  iosDisplay?: 'inline' | 'spinner'
  minimumDate?: Date
  maximumDate?: Date
}) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xl)

  if (Platform.OS !== 'ios') {
    return visible ? (
      <DateTimePicker
        mode={mode}
        display="default"
        value={value}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onChange={(event, date) => {
          onClose()
          if (event.type !== 'dismissed' && date) onChange(date)
        }}
      />
    ) : null
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        {/* Inner press-catcher so a tap on the sheet doesn't dismiss it. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            paddingHorizontal: sp.lg,
            paddingTop: sp.md,
            paddingBottom: bottomGap,
            gap: sp.md,
            alignItems: 'stretch',
          }}
        >
          <DateTimePicker
            mode={mode}
            display={iosDisplay}
            value={value}
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            onChange={(_event, date) => {
              if (date) onChange(date)
            }}
            themeVariant={dark ? 'dark' : 'light'}
            // The wheels size to their content; centring them in the sheet
            // keeps them from hugging the left edge on a wide phone.
            style={iosDisplay === 'spinner' ? { alignSelf: 'center' } : undefined}
          />
          <Btn title={t('common.done')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}
