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
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import { CalendarDays, Clock, X } from 'lucide-react-native'
import DateTimePicker from '@react-native-community/datetimepicker'

import { Btn, Txt } from '@/components/ui'
import { TintButton } from '@/components/TintButton'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'

export function PickerSheet({
  visible,
  mode,
  value,
  onChange,
  onClose,
  iosDisplay = mode === 'time' ? 'spinner' : 'inline',
  minimumDate,
  maximumDate,
  title,
  tint,
}: {
  /** The colour of the app that opened it (the picked day, Done, the icon).
   *  Defaults to the theme accent. */
  tint?: string
  /** The sheet's heading — usually the row's label ("Starts", "Birthday"). */
  title?: string
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
  const color = tint ?? c.accent
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.xs)

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
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        {/* 2026-11 restyle: title + round ✕ like every sheet, the picker on its
            own card, Done docked with the screen's bottom curve. */}
        <View style={{ backgroundColor: c.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, paddingBottom: bottomGap, gap: sp.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.lg }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
              {mode === 'time' ? <Clock size={18} color={color} /> : <CalendarDays size={18} color={color} />}
            </View>
            <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: c.text }} numberOfLines={1}>
              {title ?? (mode === 'time' ? t('form.pickTime') : t('form.pickDate'))}
            </Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          <View
            style={{
              marginHorizontal: sp.lg,
              borderRadius: 22,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: c.card,
              paddingVertical: iosDisplay === 'spinner' ? sp.xs : sp.sm,
              paddingHorizontal: sp.sm,
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
              accentColor={color}
              // The wheels size to their content; centring them in the sheet
              // keeps them from hugging the left edge on a wide phone.
              style={{ alignSelf: 'center' }}
            />
          </View>
          <View style={{ paddingHorizontal: sp.lg }}>
            {tint ? (
              <TintButton tint={tint} title={t('common.done')} onPress={onClose} />
            ) : (
              <Btn title={t('common.done')} onPress={onClose} curveBottom />
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}
