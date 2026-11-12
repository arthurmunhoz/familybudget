// Cover art for the game cards on the Games screen — original illustrations in
// the app's look: a frosted-white subject on the game's own gradient, a few
// soft shapes, a gentle idle animation so the screen feels alive.
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'

const VB = '0 0 320 180'

function useBob(duration = 2600, amp = 4) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    ))
  }, [t, duration])
  return useAnimatedStyle(() => ({ transform: [{ translateY: -amp + t.value * amp * 2 }] }))
}

/** Hangman: the One Roof house, half built, over a row of letter tiles. */
export function HangmanCover() {
  const bob = useBob()
  const tiles = ['C', 'A', '', 'A']
  return (
    <>
      <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
        <G opacity={0.25} fill="#fff">
          <Ellipse cx={40} cy={36} rx={24} ry={9} />
          <Ellipse cx={282} cy={50} rx={28} ry={9} />
        </G>
        <Path d="M-10 170 Q160 146 330 170 L330 190 L-10 190 Z" fill="rgba(255,255,255,0.22)" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="cvDoor" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFD38A" />
              <Stop offset="1" stopColor="#FFA040" />
            </LinearGradient>
          </Defs>
          {/* house: roof done on the left only — still going up */}
          <Path d="M200 34 L200 84 L146 84 Q140 84 144 79 Z" fill="#fff" />
          <Path d="M200 34 L252 79" stroke="rgba(255,255,255,0.65)" strokeWidth={3} strokeDasharray="5 6" strokeLinecap="round" />
          <Path d="M156 84 H244 V142 Q244 150 236 150 H164 Q156 150 156 142 Z" fill="rgba(255,255,255,0.92)" />
          <Rect x={190} y={112} width={20} height={38} rx={10} fill="url(#cvDoor)" />
          {/* letter tiles */}
          {tiles.map((ch, i) => (
            <G key={i}>
              <Rect x={22 + i * 30} y={104} width={24} height={30} rx={7} fill={ch ? '#fff' : 'rgba(255,255,255,0.3)'} />
              {ch ? (
                <SvgText x={34 + i * 30} y={125} fontSize={17} fontWeight="800" fill="#D9466F" textAnchor="middle">
                  {ch}
                </SvgText>
              ) : (
                <Rect x={28 + i * 30} y={127} width={12} height={3} rx={1.5} fill="#fff" />
              )}
            </G>
          ))}
        </Svg>
      </Animated.View>
    </>
  )
}

/** Battleship: two little boats on rolling waves and a target marker. */
export function BattleshipCover() {
  const bob = useBob(2200, 3)
  const bob2 = useBob(2900, 4)
  return (
    <>
      <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
        {/* grid hint */}
        <G stroke="rgba(255,255,255,0.14)" strokeWidth={1}>
          {Array.from({ length: 9 }, (_, i) => (
            <Path key={`v${i}`} d={`M${20 + i * 35} 0 V180`} />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <Path key={`h${i}`} d={`M0 ${10 + i * 35} H320`} />
          ))}
        </G>
        <Circle cx={250} cy={58} r={20} stroke="#fff" strokeWidth={3} fill="none" opacity={0.85} />
        <Circle cx={250} cy={58} r={9} stroke="#fff" strokeWidth={3} fill="none" opacity={0.85} />
        <Path d="M250 30 V44 M250 72 V86 M222 58 H236 M264 58 H278" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <Path d="M48 118 H150 L136 140 H64 Z" fill="#fff" />
          <Rect x={78} y={100} width={40} height={18} rx={5} fill="rgba(255,255,255,0.9)" />
          <Rect x={92} y={86} width={8} height={16} rx={3} fill="rgba(255,255,255,0.85)" />
          <Circle cx={90} cy={109} r={3} fill="#2563D9" opacity={0.6} />
          <Circle cx={104} cy={109} r={3} fill="#2563D9" opacity={0.6} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, bob2]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <Path d="M176 126 H232 L224 140 H184 Z" fill="rgba(255,255,255,0.85)" />
          <Rect x={194} y={114} width={20} height={12} rx={4} fill="rgba(255,255,255,0.8)" />
        </Svg>
      </Animated.View>
      <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
        <Path d="M-10 146 Q20 136 50 146 T110 146 T170 146 T230 146 T290 146 T350 146 V190 H-10 Z" fill="rgba(255,255,255,0.28)" />
        <Path d="M-10 160 Q25 150 60 160 T130 160 T200 160 T270 160 T340 160 V190 H-10 Z" fill="rgba(255,255,255,0.2)" />
      </Svg>
    </>
  )
}

/** Quiz: a big round buzzer with question bubbles popping around it. */
export function QuizCover() {
  const bob = useBob(1800, 3)
  return (
    <>
      <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
        <G fill="rgba(255,255,255,0.9)">
          <Circle cx={64} cy={52} r={18} />
          <Path d="M58 66 L52 80 L70 68 Z" />
        </G>
        <SvgText x={64} y={59} fontSize={20} fontWeight="900" fill="#6E3FD8" textAnchor="middle">
          ?
        </SvgText>
        <G fill="rgba(255,255,255,0.75)">
          <Circle cx={262} cy={46} r={13} />
        </G>
        <SvgText x={262} y={52} fontSize={15} fontWeight="900" fill="#6E3FD8" textAnchor="middle">
          !
        </SvgText>
        <G stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.7}>
          <Path d="M110 70 L122 80 M208 70 L196 80 M160 46 V58" />
        </G>
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        <Svg viewBox={VB} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="cvBuzz" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FF8A8A" />
              <Stop offset="1" stopColor="#E8405C" />
            </LinearGradient>
          </Defs>
          <Ellipse cx={160} cy={150} rx={62} ry={14} fill="rgba(255,255,255,0.9)" />
          <Rect x={104} y={128} width={112} height={22} rx={8} fill="#fff" />
          <Ellipse cx={160} cy={118} rx={42} ry={22} fill="#C9304C" />
          <Ellipse cx={160} cy={110} rx={42} ry={22} fill="url(#cvBuzz)" />
          <Ellipse cx={148} cy={103} rx={14} ry={5} fill="rgba(255,255,255,0.55)" />
        </Svg>
      </Animated.View>
    </>
  )
}
