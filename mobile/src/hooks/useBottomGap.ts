// Bottom padding for anything docked to the bottom edge of the screen — a
// sheet's last row, a pinned CTA, a floating bar.
//
// The two platforms' bottom insets mean DIFFERENT things, which is why one
// hardcoded number can't serve both and why "it looks fine on my phone" is not
// evidence:
//
//   • Android's navigation bar is an OCCLUDER. Whatever is under it is
//     invisible and untappable, so it has to be cleared completely. Its size is
//     a per-user setting, not a per-device constant: 3-button navigation is
//     ~48dp, the gesture pill ~16–24dp, and a hidden/immersive bar is 0. Under
//     edge-to-edge (mandatory from Expo SDK 54 / Android 15) the app draws
//     behind it either way, so a fixed gap covers some users' CTAs and not
//     others'. This is exactly the bug that keeps coming back.
//   • iOS's home indicator is a thin OVERLAY. The HIG lets content sit near it,
//     and clearing the whole 34pt inset floats a docked button visibly off the
//     screen's curve — so we take half, which is what the app has always done.
//
// `min` is the visual padding the element wants when there's no system bar at
// all; the result is never less than that. Passing the constant the code used
// before therefore leaves iOS pixel-identical and only ever ADDS room on
// Android, where a taller bar needs it.
//
//   const bottom = useBottomGap(sp.xl)   // was: paddingBottom: sp.xl
//
// react-native-safe-area-context reads this from the live WindowInsets, so it
// re-renders when the user switches navigation mode or rotates — there is
// nothing to detect or configure per user.
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { sp } from '@/theme/theme'

export function useBottomGap(min: number = sp.xs): number {
  const insets = useSafeAreaInsets()
  const clearance =
    Platform.OS === 'android' ? insets.bottom : Math.round(insets.bottom / 2)
  return Math.max(clearance, min)
}
