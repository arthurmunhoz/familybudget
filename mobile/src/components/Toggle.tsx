// The app's one on/off switch. Every toggle looks the same — they used to come
// in accent, income green and expense red, some with a forced white thumb, and
// on Android the default off state (grey thumb, faint track) all but vanished
// on the light cards. Colours are deliberately NOT props: use this instead of
// react-native's Switch, and a screen can't drift off the look again.
//
//   • Android: an accent thumb (the filter chips' active colour) on a soft
//     accent track when on, on a neutral track when off.
//   • iOS: the platform's white thumb on an accent track when on, the system
//     off track otherwise.
import { Platform, Switch, type SwitchProps } from 'react-native'

import { useTheme } from '@/theme/theme'

export function Toggle({
  tint,
  ...props
}: Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'> & {
  /** The 2026-11 sheets are in their app's colour (Money green…): pass that
   *  app colour here — and ONLY that, so a toggle still never drifts into an
   *  arbitrary colour. Same shape either way. */
  tint?: string
}) {
  const { c, dark } = useTheme()
  const on = tint ?? c.accent
  const soft = tint ? tint + (dark ? '55' : '40') : c.accentSoft
  // The OFF track must be an explicit, solid grey: iOS's default is a faint
  // translucent fill that vanished (white thumb on near-white) once the page
  // went from cream to grey-white (2026-11) — "Remind me" read as no control.
  const offTrack = dark ? '#3A3A42' : '#D4D4DA'
  return (
    <Switch
      {...props}
      trackColor={Platform.OS === 'android' ? { true: soft, false: offTrack } : { true: on, false: offTrack }}
      ios_backgroundColor={offTrack}
      thumbColor={Platform.OS === 'android' ? on : undefined}
    />
  )
}
