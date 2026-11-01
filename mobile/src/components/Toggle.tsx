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

export function Toggle(props: Omit<SwitchProps, 'trackColor' | 'thumbColor' | 'ios_backgroundColor'>) {
  const { c } = useTheme()
  return (
    <Switch
      {...props}
      trackColor={Platform.OS === 'android' ? { true: c.accentSoft, false: c.border } : { true: c.accent }}
      thumbColor={Platform.OS === 'android' ? c.accent : undefined}
    />
  )
}
