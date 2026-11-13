// The Utilities tools' shared head, in the photo frame's language (owner,
// 2026-11 — the frame's set-up screen is the reference): a big display title
// with what the tool does in the same faded display type under it, and the
// tool's own art on the right, breathing slowly like the frame's. Also the
// small pieces every tool repeats: the tracked section label and the tile
// that is "selected" the frame's way (soft wash + outline in the tool's tint).
import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { fonts, sp, useTheme } from '@/theme/theme'

import { FrameArt } from './frame/FrameArt'
import { TOOL_LOOK } from './look'
import { ToolArt, type ToolArtKind } from './ToolArt'

/** The tool's art on a soft halo of its colour, breathing (scale + glow).
 *  Reduce Motion: still. */
export function ToolHeroArt({ kind, size = 104 }: { kind: ToolArtKind; size?: number }) {
  const { dark } = useTheme()
  const reduce = useReducedMotion()
  const breathe = useSharedValue(0)
  useEffect(() => {
    if (reduce) return
    const half = { duration: 2600, easing: Easing.inOut(Easing.sin) }
    breathe.set(withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1))
  }, [reduce, breathe])
  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breathe.get() * 0.035 }] }))
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + breathe.get() * 0.45,
    transform: [{ scale: 0.94 + breathe.get() * 0.06 }],
  }))

  if (kind === 'frame') return <FrameArt size={size} />
  const look = TOOL_LOOK[kind]
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, backgroundColor: look.colors[0] + (dark ? '2E' : '24') },
          haloStyle,
        ]}
      />
      <Animated.View style={artStyle}>
        <ToolArt kind={kind} colors={look.colors} dark={dark} size={size * 0.74} />
      </Animated.View>
    </View>
  )
}

/** "Melhor preço / Qual sai mais barato?" + the art — the frame's hero. */
export function ToolHero({ kind, title, subtitle, art = true }: { kind: ToolArtKind; title: string; subtitle?: string; art?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={styles.hero}>
      <View style={{ flex: 1 }}>
        <Txt style={styles.bigTitle}>{title}</Txt>
        {subtitle ? <Txt style={[styles.subTitle, { color: c.textFaint }]}>{subtitle}</Txt> : null}
      </View>
      {art ? <ToolHeroArt kind={kind} /> : null}
    </View>
  )
}

/** Uppercase tracked label over a section (the frame's "FOTOS DE"). */
export function SectionLabel({ children, right, style }: { children: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <View style={[styles.sectionHead, style]}>
      <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{children}</Txt>
      {right}
    </View>
  )
}

/** A pill the frame's way: the count chip ("12 of 30"). */
export function TintPill({ tint, children }: { tint: string; children: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: tint + '1F' }]}>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: tint }}>{children}</Txt>
    </View>
  )
}

/** A choice tile/chip: card when off, soft wash + 1.5 outline in the tint
 *  when on (the frame's source tiles and member chips). */
export function ChoiceChip({
  label,
  on,
  tint,
  onPress,
  disabled,
  left,
  accessibilityLabel,
}: {
  label: string
  on: boolean
  tint: string
  onPress: () => void
  disabled?: boolean
  left?: ReactNode
  accessibilityLabel?: string
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        left ? { paddingLeft: 5 } : null,
        {
          backgroundColor: on ? tint + '1F' : c.card,
          borderColor: on ? tint : c.border,
          borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
          opacity: disabled && !on ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {left}
      <Txt style={{ fontSize: 14, fontFamily: on ? fonts.semibold : fonts.medium, color: on ? tint : c.text }}>{label}</Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg },
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  subTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.md },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
})
