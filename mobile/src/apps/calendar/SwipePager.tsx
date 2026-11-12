// Horizontal swipe = previous / next period (day, week or month) for the
// Calendar. The content follows the finger (damped), and on release past the
// threshold it slides a little way out and fades, the parent switches period,
// and the NEW page slides in from the other side — timing curves only, no
// springs. The slide-in starts from an effect on `pageKey`, i.e. after React
// has committed the new page, so the old content never slides back in.
//
// The pan only activates on a clearly horizontal drag (activeOffsetX) and
// fails as soon as the finger moves vertically, so the hour grid's vertical
// ScrollView inside keeps scrolling normally. Chevrons call `go(dir)` through
// the ref to get the same motion. Reduce Motion → a plain fade.
import { useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'
import { useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

export interface PagerHandle {
  go: (dir: 1 | -1) => void
}

const OUT_MS = 130
const IN_MS = 230
const BACK_MS = 180

export function SwipePager({
  pageKey,
  onShift,
  children,
  style,
  ref,
}: {
  /** Changes whenever the visible period changes. */
  pageKey: string
  /** dir: 1 = next, -1 = previous */
  onShift: (dir: 1 | -1) => void
  children: ReactNode
  style?: StyleProp<ViewStyle>
  ref?: Ref<PagerHandle>
}) {
  const { width } = useWindowDimensions()
  const reduce = useReducedMotion()
  const tx = useSharedValue(0)
  const op = useSharedValue(1)
  // direction of the shift in flight (0 = none) — read when the new page lands
  const pending = useSharedValue(0)
  const travel = Math.min(90, width * 0.18)

  const leave = (dir: 1 | -1) => {
    'worklet'
    pending.set(dir)
    op.set(withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.quad) }))
    tx.set(
      withTiming(reduce ? 0 : -dir * travel, { duration: OUT_MS, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(onShift, dir)
      }),
    )
  }

  useImperativeHandle(ref, () => ({ go: (dir) => leave(dir) }))

  // New page committed → bring it in from the side it came from.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const dir = pending.get()
    pending.set(0)
    const ease = { duration: IN_MS, easing: Easing.out(Easing.cubic) }
    const from = reduce || dir === 0 ? 0 : dir * travel
    tx.set(withSequence(withTiming(from, { duration: 0 }), withTiming(0, ease)))
    op.set(dir === 0 ? withSequence(withTiming(0.35, { duration: 0 }), withTiming(1, ease)) : withTiming(1, ease))
  }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      tx.set(reduce ? 0 : e.translationX * 0.45)
      op.set(1 - Math.min(0.4, (Math.abs(e.translationX) / width) * 0.7))
    })
    .onEnd((e) => {
      const far = Math.abs(e.translationX) > Math.min(80, width * 0.2)
      const flick = Math.abs(e.velocityX) > 600 && Math.sign(e.velocityX) === Math.sign(e.translationX)
      if (far || flick) {
        leave(e.translationX < 0 ? 1 : -1)
      } else {
        const ease = { duration: BACK_MS, easing: Easing.out(Easing.cubic) }
        tx.set(withTiming(0, ease))
        op.set(withTiming(1, ease))
      }
    })

  const anim = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ translateX: tx.get() }] }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1 }, style, anim]}>{children}</Animated.View>
    </GestureDetector>
  )
}
