// Every Utilities tool's colour (2026-11, after the photo frame set the
// language the owner wanted everywhere): ONE gradient per tool, used for its
// hub icon, its hero art, the docked primary button, the progress bar, the
// selected tile (soft wash + outline in `tint`) and the result hero. The
// frame keeps its own `FRAME_LOOK`; it's mirrored here so the hub reads all
// six from one table. Gradients are identity — the same in both themes.
import { createContext, useContext } from 'react'
import { StyleSheet, type ViewStyle } from 'react-native'

import type { Gradient } from '@/components/home/palette'
import { fonts } from '@/theme/theme'
import { FRAME_LOOK } from './frame/look'
import type { ToolArtKind } from './ToolArt'

export interface ToolLook {
  colors: Gradient
  /** Text/icon/outline colour on the page (readable on paper and on Dusk). */
  tint: string
}

export const TOOL_LOOK: Record<ToolArtKind, ToolLook> = {
  even: { colors: ['#5B86F5', '#3F57D6'], tint: '#4A6BE6' },
  items: { colors: ['#A77CF2', '#6E3FD3'], tint: '#8355E0' },
  deal: { colors: ['#2CC2B4', '#11807F'], tint: '#14958F' },
  discount: { colors: ['#F2687B', '#C8355F'], tint: '#D9466B' },
  tag: { colors: ['#FFB547', '#D9741C'], tint: '#DB7A1F' },
  frame: FRAME_LOOK,
}

/** The look of the tool on screen — the wizard steps' controls read it so
 *  they don't each need a prop. */
export const ToolLookContext = createContext<{ kind: ToolArtKind; look: ToolLook }>({
  kind: 'even',
  look: TOOL_LOOK.even,
})

export const useToolLook = () => useContext(ToolLookContext)

/** The frame's card: translucent card fill, hairline, 20pt corners. */
export function toolCard(c: { card: string; border: string }): ViewStyle {
  return { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 }
}

export const toolStyles = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  subTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, marginTop: 2 },
})

