// React Native's Pressable, with one fix: on Android it is rebuilt whenever
// `disabled` flips, so the native view's enabled state is always right.
//
// The bug (RN 0.85, New Architecture, Android): `disabled` reaches the native
// view as accessibilityState.disabled → view.setEnabled(), and when it FLIPS on
// an existing view that update can be lost. The button then looks enabled (our
// style reads the JS prop) while Android still holds enabled=false, and real
// finger taps on it are mostly dropped — it took many taps to get through.
// Seen 2026-10-11 on a Galaxy S9+ in Onboarding: Continue starts disabled
// (empty name), typing enabled it, and `uiautomator dump` showed the native
// button stuck at enabled=false. Every Android signup was stuck there; iOS
// was unaffected. A view CREATED with the right value is correct, so keying on
// the disabled state makes React mount a fresh one on every flip.
//
// Use this instead of react-native's Pressable for anything with a `disabled`
// that can change (validation, busy flags). Without `disabled` it is a plain
// pass-through. Covered by __tests__/pressable.test.tsx.
import { forwardRef } from 'react'
import { Pressable as RNPressable, type PressableProps, type View } from 'react-native'

export const Pressable = forwardRef<View, PressableProps>(function Pressable(props, ref) {
  return <RNPressable key={props.disabled ? 'disabled' : 'enabled'} ref={ref} {...props} />
})

export type { PressableProps }
