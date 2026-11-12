// Utilities › the tools' own icons (owner, 2026-11: "prettier, and no more
// squares full of colour"). Drawn here as small two-tone line art on the bare
// card: a rounded stroke in the tool's colour with a soft wash of the same
// colour inside the shape — so each tool still reads at a glance by colour,
// without a filled tile behind it. 48-unit viewBox, drawn at any size.
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'

import type { Gradient } from '@/components/home/palette'

export type ToolArtKind = 'even' | 'items' | 'deal' | 'discount' | 'tag' | 'frame'

export function ToolArt({ kind, colors, dark, size = 44 }: { kind: ToolArtKind; colors: Gradient; dark: boolean; size?: number }) {
  // The deep end of the gradient reads on paper; the light end on Dusk.
  const ink = dark ? colors[0] : colors[1]
  const wash = colors[0]
  const line = { stroke: ink, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  const soft = { fill: wash, fillOpacity: dark ? 0.3 : 0.22 }
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {kind === 'even' ? (
        <>
          {/* a bill pulled apart into three equal shares */}
          <Path d="M25.91 23.40 L25.91 8.90 A14.5 14.5 0 0 1 38.46 30.65 Z" {...soft} />
          <Path d="M24.00 26.70 L36.56 33.95 A14.5 14.5 0 0 1 11.44 33.95 Z" {...soft} fillOpacity={dark ? 0.18 : 0.12} />
          <Path d="M22.09 23.40 L9.54 30.65 A14.5 14.5 0 0 1 22.09 8.90 Z" {...soft} fillOpacity={dark ? 0.1 : 0.06} />
          <Path d="M25.91 23.40 L25.91 8.90 A14.5 14.5 0 0 1 38.46 30.65 Z" {...line} />
          <Path d="M24.00 26.70 L36.56 33.95 A14.5 14.5 0 0 1 11.44 33.95 Z" {...line} />
          <Path d="M22.09 23.40 L9.54 30.65 A14.5 14.5 0 0 1 22.09 8.90 Z" {...line} />
        </>
      ) : kind === 'items' ? (
        <>
          {/* a receipt; each line has its own person (dot) */}
          <Path d="M13 8 H35 V40 L31.3 37.4 L27.7 40 L24 37.4 L20.3 40 L16.7 37.4 L13 40 Z" {...soft} />
          <Path d="M13 8 H35 V40 L31.3 37.4 L27.7 40 L24 37.4 L20.3 40 L16.7 37.4 L13 40 Z" {...line} />
          <Line x1={18} y1={16} x2={26} y2={16} {...line} />
          <Line x1={18} y1={22.5} x2={26} y2={22.5} {...line} />
          <Line x1={18} y1={29} x2={24} y2={29} {...line} />
          <Circle cx={30} cy={16} r={2.1} fill={ink} />
          <Circle cx={30} cy={22.5} r={2.1} fill={ink} fillOpacity={0.6} />
          <Circle cx={30} cy={29} r={2.1} fill={ink} fillOpacity={0.35} />
        </>
      ) : kind === 'deal' ? (
        <>
          {/* a balance tipping toward the better buy */}
          <Path d="M4.5 29 Q10.5 35.5 16.5 29 Z" {...soft} />
          <Path d="M31.5 23 Q37.5 29.5 43.5 23 Z" {...soft} />
          <Line x1={24} y1={11} x2={24} y2={38} {...line} />
          <Line x1={17} y1={39} x2={31} y2={39} {...line} />
          <Line x1={10.5} y1={17.5} x2={37.5} y2={12.5} {...line} />
          <Path d="M10.5 17.5 L5 29 M10.5 17.5 L16 29 M4.5 29 Q10.5 35.5 16.5 29 Z" {...line} />
          <Path d="M37.5 12.5 L32 23 M37.5 12.5 L43 23 M31.5 23 Q37.5 29.5 43.5 23 Z" {...line} />
          <Circle cx={24} cy={10} r={2.4} fill={ink} />
        </>
      ) : kind === 'discount' ? (
        <>
          {/* a price tag with a percent on it */}
          <Path d="M7.8 23.2 L22.2 8.8 Q23 8 24.2 8 H38 Q40 8 40 10 V23.8 Q40 25 39.2 25.8 L24.8 40.2 Q23 42 21.2 40.2 L7.8 26.8 Q6 25 7.8 23.2 Z" {...soft} />
          <Path d="M7.8 23.2 L22.2 8.8 Q23 8 24.2 8 H38 Q40 8 40 10 V23.8 Q40 25 39.2 25.8 L24.8 40.2 Q23 42 21.2 40.2 L7.8 26.8 Q6 25 7.8 23.2 Z" {...line} />
          <Circle cx={33} cy={15} r={2.4} {...line} />
          <Line x1={17.5} y1={30.5} x2={27.5} y2={20.5} {...line} />
          <Circle cx={18.6} cy={21.6} r={1.9} fill={ink} />
          <Circle cx={26.4} cy={29.4} r={1.9} fill={ink} />
        </>
      ) : kind === 'tag' ? (
        <>
          {/* a suitcase with its name tag */}
          <Rect x={9} y={16} width={26} height={22} rx={4.5} {...soft} />
          <Rect x={9} y={16} width={26} height={22} rx={4.5} {...line} />
          <Path d="M17 16 V12 Q17 10 19 10 H25 Q27 10 27 12 V16" {...line} />
          <Line x1={16} y1={16} x2={16} y2={38} {...line} />
          <Line x1={28} y1={16} x2={28} y2={38} {...line} />
          <Circle cx={14} cy={41.5} r={1.8} fill={ink} />
          <Circle cx={30} cy={41.5} r={1.8} fill={ink} />
          <Path d="M35 21 L39.5 24.5" {...line} />
          <Rect x={37} y={24} width={7} height={10} rx={1.8} fill={ink} transform="rotate(-12 40.5 29)" />
        </>
      ) : (
        <>
          {/* a standing frame with a little sunset inside */}
          <Rect x={13} y={12} width={22} height={18} rx={1.8} {...soft} />
          <Rect x={8.5} y={7.5} width={31} height={27} rx={3.5} {...line} />
          <Path d="M13 30 L20.5 21.5 L25.5 26.5 L28.5 23.5 L35 30" {...line} />
          <Circle cx={29.5} cy={16.5} r={2.6} fill={ink} />
          <Line x1={18} y1={34.5} x2={15} y2={41} {...line} />
          <Line x1={30} y1={34.5} x2={33} y2={41} {...line} />
        </>
      )}
    </Svg>
  )
}
