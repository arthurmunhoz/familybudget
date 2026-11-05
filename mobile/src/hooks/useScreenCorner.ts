// Floating panels at the bottom of an iPhone (the ask sheet, the Home's family
// dock) follow the display's rounded corner with EXACTLY the geometry of the
// bottom "＋ New …" button (NewItemButton in components/ui), which the owner
// pointed to as the one that looks right (2026-11): 16pt from the sides, half
// the home-indicator inset from the bottom, 40pt on the two bottom corners.
// (A first try — 8pt inset, 47pt corners "concentric" with a guessed display
// radius — did not read as following the phone.)
//
// iOS only, and only on Face ID iPhones (a home-indicator inset): home-button
// iPhones have square screens, and Android keeps its edge-to-edge panels.
// Returns null there, and callers keep their existing layout.
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { sp } from '@/theme/theme'

export function useScreenCorner(): { side: number; bottom: number; radius: number } | null {
  const insets = useSafeAreaInsets()
  if (Platform.OS !== 'ios' || insets.bottom === 0) return null
  return { side: sp.lg, bottom: Math.max(Math.round(insets.bottom / 2), sp.xs), radius: 40 }
}
