// How far a bottom sheet inside a <Modal> must sit above the screen's bottom
// edge: clear of the keyboard when it's up, and on Android clear of the
// navigation bar always. Spread `onRootLayout` onto the modal's full-screen
// root, then give the sheet `marginBottom: lift` and `maxHeight: room * share`.
//
// Why measured rather than KeyboardAvoidingView: inside a <Modal> KAV
// mis-measures (see useKeyboardHeight), and the platforms disagree on who moves
// what:
//
//   • iOS: the modal's window never moves; the keyboard's reported height is
//     measured from the screen's bottom edge, so the whole of it is the lift.
//   • Android (edge-to-edge): the modal's window doesn't resize either, and it
//     draws BEHIND the navigation bar — but the keyboard height RN reports is
//     only the part ABOVE that bar. The keyboard's top edge is therefore a
//     navigation bar higher than the reported height alone says. That gap is
//     what left the city field and the event form's last fields hidden.
//
// Whatever the window DID give up for the keyboard (`absorbed`: the root's
// height now vs. with no keyboard) is subtracted, so a device or mode that
// resizes the modal after all isn't lifted twice.
//
// `navBar` comes from the live window insets: ~48dp for 3-button navigation,
// less for the gesture pill, 0 when hidden — nothing to configure per user.
// iOS's home indicator is an overlay, so there the sheet keeps reaching the
// edge and the caller pads its last row instead (useBottomGap).
import { useState } from 'react'
import { Platform, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useKeyboardHeight } from './useKeyboardHeight'

export function useSheetLift() {
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const kb = useKeyboardHeight()
  const [rootH, setRootH] = useState(0)
  const [restH, setRestH] = useState(0) // root height with no keyboard up

  const available = rootH || win.height
  const absorbed = restH ? Math.max(0, restH - available) : 0
  const navBar = Platform.OS === 'android' ? insets.bottom : 0
  const covered = kb > 0 ? kb + navBar : 0
  const lift = Math.max(navBar, covered - absorbed)

  const onRootLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    setRootH(h)
    if (kb === 0) setRestH(h)
  }

  return {
    /** Keyboard height as RN reports it; 0 when hidden. */
    kb,
    /** The sheet's marginBottom. */
    lift,
    /** Height left above the lift — base the sheet's maxHeight on this. */
    room: available - lift,
    /** True when the sheet's own last row needs no system-bar padding: the
     *  keyboard is under it, or (Android) it's already above the nav bar. */
    clearOfBars: kb > 0 || Platform.OS === 'android',
    onRootLayout,
  }
}
