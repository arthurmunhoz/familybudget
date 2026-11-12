// "Shrinks and lands" (NEXT-RELEASE item 5): a ghost card drawn over the
// screen that flies from a form's rect to the rect of the list row it just
// created, then glows once in the owner's colours and fades, revealing the
// real row underneath (which the host keeps invisible until `onLanded`).
//
// The host owns the measuring; this only animates. Rects are in the HOST
// OVERLAY's coordinates (measureInWindow minus the overlay's own origin).
//   - mount with `from` (the form's rect) and `to = null`: the ghost sits
//     exactly where the form was, so the Modal can vanish under it with no
//     animation of its own;
//   - pass `to` once the row is laid out (scroll it into view first): it flies;
//   - pass `to = 'gone'` when there's no row to land on (filtered out, a
//     timeout): it just fades.
// Reduce Motion: no flight — the ghost appears ON the row and only glows and
// fades (the host also lets the form fade out instead of cutting it).
import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'

export type GhostRect = { x: number; y: number; width: number; height: number }

/** Calm "emphasized decelerate" — quick to leave, long soft arrival. No spring. */
const FLY = { duration: 520, easing: Easing.bezier(0.2, 0, 0, 1) }
// The glow and the fade are what Reduce Motion users get INSTEAD of the flight,
// so they opt out of Reanimated's default (ReduceMotion.System), which would
// jump them straight to their end values and show nothing at all.
const NEVER = ReduceMotion.Never
const GLOW_IN = { duration: 180, easing: Easing.out(Easing.quad), reduceMotion: NEVER }
const FADE = { duration: 520, easing: Easing.inOut(Easing.quad), reduceMotion: NEVER }
/** iOS's Modal 'fade' runs ~300 ms; the glow starts once it's gone. */
const REDUCED_LEAD = 320

export function LandingGhost({
  from,
  to,
  fromColor,
  toColor,
  borderColor,
  fromRadius,
  toRadius,
  glow,
  head,
  children,
  onLanded,
  onDone,
}: {
  from: GhostRect
  to: GhostRect | null | 'gone'
  /** Background at the start (the form sheet's) and at landing (the row's). */
  fromColor: string
  toColor: string
  borderColor: string
  fromRadius: number
  toRadius: number
  /** The owner's gradient — the landing glow. */
  glow: Gradient
  /** Shown while the ghost is still form-sized (e.g. the amount), fades early. */
  head?: ReactNode
  /** The row's own content, laid out at the target size; fades in on arrival. */
  children: ReactNode
  /** The ghost now covers the row exactly — show the real one underneath. */
  onLanded: () => void
  onDone: () => void
}) {
  const reduce = useReducedMotion()
  const x = useSharedValue(from.x)
  const y = useSharedValue(from.y)
  const w = useSharedValue(from.width)
  const h = useSharedValue(from.height)
  const p = useSharedValue(0) // 0 = form, 1 = row
  const lit = useSharedValue(0)
  // Under Reduce Motion nothing is drawn until the row is known.
  const alpha = useSharedValue(reduce ? 0 : 1)

  useEffect(() => {
    if (to === null) return
    if (to === 'gone') {
      alpha.set(withTiming(0, { duration: 260, reduceMotion: NEVER }, (fin) => fin && scheduleOnRN(onDone)))
      return
    }
    // Runs on the JS thread (called directly, or scheduled from the flight's end).
    // `lead`: under Reduce Motion the form is still fading out over the list,
    // so the glow waits for it instead of playing underneath.
    const settle = (lead = 0) => {
      onLanded()
      lit.set(withDelay(lead, withSequence(NEVER, withTiming(1, GLOW_IN), withDelay(260, withTiming(0, FADE), NEVER)), NEVER))
      alpha.set(withDelay(lead + 420, withTiming(0, FADE, (fin) => fin && scheduleOnRN(onDone)), NEVER))
    }
    if (reduce) {
      x.set(to.x)
      y.set(to.y)
      w.set(to.width)
      h.set(to.height)
      p.set(1)
      alpha.set(1)
      settle(REDUCED_LEAD)
      return
    }
    x.set(withTiming(to.x, FLY))
    y.set(withTiming(to.y, FLY))
    w.set(withTiming(to.width, FLY))
    h.set(withTiming(to.height, FLY))
    p.set(withTiming(1, FLY, (fin) => fin && scheduleOnRN(settle, 0)))
    // Shared values are stable refs; the callbacks are read once per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduce])

  const box = useAnimatedStyle(() => ({
    left: x.get(),
    top: y.get(),
    width: w.get(),
    height: h.get(),
    opacity: alpha.get(),
    borderRadius: interpolate(p.get(), [0, 1], [fromRadius, toRadius]),
    backgroundColor: interpolateColor(p.get(), [0, 0.85, 1], [fromColor, fromColor, toColor]),
    borderWidth: interpolate(p.get(), [0, 1], [0, StyleSheet.hairlineWidth]),
  }))
  const headStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0, 0.35], [1, 0], 'clamp') }))
  const bodyStyle = useAnimatedStyle(() => ({ opacity: interpolate(p.get(), [0.4, 0.85], [0, 1], 'clamp') }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: lit.get() * 0.32 }))
  const ringStyle = useAnimatedStyle(() => ({ opacity: lit.get() }))

  const target = to && to !== 'gone' ? to : null
  return (
    <Animated.View pointerEvents="none" style={[styles.box, { borderColor }, box]}>
      {head ? <Animated.View style={[styles.center, headStyle]}>{head}</Animated.View> : null}
      {/* The row's content at its final size, centred in the shrinking box, so
          by the time it's visible the box has closed around it. */}
      <Animated.View style={[styles.center, bodyStyle]}>
        <View style={target ? { width: target.width, height: target.height } : undefined}>{children}</View>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
        <GradientBox colors={glow} radius={0} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: toRadius, borderWidth: 1.5, borderColor: glow[0] }, ringStyle]}
      />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  box: { position: 'absolute', overflow: 'hidden' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})
