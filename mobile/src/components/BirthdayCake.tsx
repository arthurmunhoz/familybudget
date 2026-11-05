// One Roof's own birthday cake — drawn, not the 🎂 emoji, so it matches the
// app (the user found the emoji + orange card "too generic"). Two tiers, the
// top frosting dripping in the current colour scheme's accent, sprinkles, and
// lit candles. Colours come from the theme, so every scheme and dark mode get
// a cake in their own palette.
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

export function BirthdayCake({ size = 88, candles = 3 }: { size?: number; candles?: number }) {
  const { c, dark } = useTheme()
  const sponge = dark ? '#F3DCC6' : '#FBE6D2'
  const spongeShade = dark ? '#E5C7AA' : '#F2D2B4'
  const cream = dark ? '#FFF6EC' : '#FFFDF8'
  const n = Math.max(1, Math.min(5, candles))
  // Candles spread evenly over the top tier (x 34…66).
  const xs = Array.from({ length: n }, (_, i) => (n === 1 ? 50 : 36 + (28 * i) / (n - 1)))
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* plate shadow */}
      <Ellipse cx={50} cy={90} rx={40} ry={5} fill="#000" opacity={dark ? 0.35 : 0.08} />
      {/* bottom tier */}
      <Rect x={12} y={58} width={76} height={30} rx={9} fill={sponge} />
      <Rect x={12} y={76} width={76} height={12} rx={6} fill={spongeShade} />
      {/* bottom tier cream band with drips */}
      <Path
        d="M12 66 Q12 58 20 58 H80 Q88 58 88 66 V68 Q84 74 80 68 Q76 62 72 70 Q68 76 64 68 Q60 62 56 69 Q52 75 48 68 Q44 62 40 70 Q36 76 32 68 Q28 62 24 69 Q20 74 16 68 Q13 66 12 68 Z"
        fill={cream}
      />
      {/* top tier */}
      <Rect x={26} y={36} width={48} height={24} rx={8} fill={sponge} />
      <Rect x={26} y={52} width={48} height={8} rx={4} fill={spongeShade} />
      {/* top tier accent frosting with drips */}
      <Path
        d="M26 43 Q26 36 33 36 H67 Q74 36 74 43 V45 Q71 51 68 45 Q65 40 62 47 Q59 53 56 46 Q53 41 50 48 Q47 54 44 46 Q41 41 38 47 Q35 52 32 45 Q29 41 26 46 Z"
        fill={c.accent}
      />
      {/* sprinkles */}
      <G>
        <Rect x={20} y={73} width={6} height={2.4} rx={1.2} fill="#FFC857" transform="rotate(-20 23 74)" />
        <Rect x={36} y={78} width={6} height={2.4} rx={1.2} fill="#7CC6A4" transform="rotate(25 39 79)" />
        <Rect x={54} y={74} width={6} height={2.4} rx={1.2} fill="#F49BB0" transform="rotate(-10 57 75)" />
        <Rect x={70} y={78} width={6} height={2.4} rx={1.2} fill="#7FB3E8" transform="rotate(30 73 79)" />
        <Circle cx={47} cy={82} r={1.4} fill="#FFC857" />
        <Circle cx={62} cy={83} r={1.4} fill={c.accent} />
        <Circle cx={29} cy={83} r={1.4} fill="#F49BB0" />
      </G>
      {/* candles + flames */}
      {xs.map((x) => (
        <G key={x}>
          <Rect x={x - 2.5} y={20} width={5} height={17} rx={2.5} fill={cream} />
          <Rect x={x - 2.5} y={24} width={5} height={2.2} fill={c.accent} opacity={0.75} />
          <Rect x={x - 2.5} y={30} width={5} height={2.2} fill={c.accent} opacity={0.75} />
          <Path d={`M${x} 8 C${x + 4.5} 13 ${x + 3.5} 19 ${x} 19 C${x - 3.5} 19 ${x - 4.5} 13 ${x} 8 Z`} fill="#FFB547" />
          <Path d={`M${x} 12 C${x + 2.2} 15 ${x + 1.8} 18 ${x} 18 C${x - 1.8} 18 ${x - 2.2} 15 ${x} 12 Z`} fill="#FFE7A3" />
        </G>
      ))}
    </Svg>
  )
}
