// A small padlock drawn from views so its shackle moves like a real one:
//   open  → the shackle rises out of the body, then swings out around its
//           LEFT leg (which stays in the body) — a 3D rotateY, so the right
//           leg sweeps over to the left side;
//   close → it swings back in until both legs line up over their holes, then
//           drops in and clamps with a small bounce.
// Static states match: `locked` false shows it lifted and swung out. Same
// footprint as an 18pt lucide <Lock/> so it drops into the same tile (the
// private-budget switch). A short static stub fills the pivot leg while the
// shackle is raised, so it never looks detached from the body.
import { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'

const SWING_DEG = 180

export function AnimatedLock({ locked, color, size = 18 }: { locked: boolean; color: string; size?: number }) {
  // lift: 0 = seated, 1 = raised. swing: 0 = over the body, 1 = swung out.
  const lift = useRef(new Animated.Value(locked ? 0 : 1)).current
  const swing = useRef(new Animated.Value(locked ? 0 : 1)).current
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    lift.stopAnimation()
    swing.stopAnimation()
    if (locked) {
      Animated.sequence([
        Animated.timing(swing, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(lift, { toValue: 0, friction: 5, tension: 220, useNativeDriver: true }),
      ]).start()
    } else {
      Animated.sequence([
        Animated.timing(lift, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]).start()
    }
  }, [locked, lift, swing])

  const u = size / 18
  const stroke = Math.max(1.6, 2 * u)
  const bodyW = 14 * u
  const bodyH = 10 * u
  const shackleW = 9.5 * u
  const shackleH = 8 * u
  const rise = 4 * u // how far the shackle lifts out of the body
  const bodyTop = size - 1.5 * u - bodyH
  const shackleLeft = (size - shackleW) / 2
  // The shackle's legs sink `stroke` into the body when seated.
  const shackleTop = bodyTop + stroke - shackleH

  return (
    <View style={{ width: size, height: size }}>
      {/* The pivot leg's exposed bit while raised — it never leaves the body,
          so it doesn't swing; drawn under the shackle, same colour. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: shackleLeft,
          top: bodyTop + stroke - rise,
          width: stroke,
          height: rise,
          backgroundColor: color,
          opacity: lift,
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: shackleLeft,
          top: shackleTop,
          width: shackleW,
          height: shackleH,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderTopLeftRadius: shackleW / 2,
          borderTopRightRadius: shackleW / 2,
          borderColor: color,
          // Pivot on the left leg's centre line.
          transformOrigin: [stroke / 2, shackleH / 2, 0],
          transform: [
            { perspective: 60 * u },
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
            { rotateY: swing.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `-${SWING_DEG}deg`] }) },
          ],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: (size - bodyW) / 2,
          top: bodyTop,
          width: bodyW,
          height: bodyH,
          borderRadius: 2.5 * u,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 2 * u, height: 3.5 * u, borderRadius: u, backgroundColor: 'rgba(0,0,0,0.25)' }} />
      </View>
    </View>
  )
}
