// A shaded sphere in one of the five ball colours: lit from the top left,
// dark at the lower right rim, with a small hot highlight. Static art — the
// things that move (the number face, the whole ball) are laid over / around it.
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg'

import { BALL_COLOR, BALL_DARK, BALL_LIGHT } from './look'

export function Sphere({ col, size }: { col: number; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="sph" cx="36%" cy="30%" r="78%" fx="33%" fy="26%">
          <Stop offset="0" stopColor={BALL_LIGHT[col]} />
          <Stop offset="0.42" stopColor={BALL_COLOR[col]} />
          <Stop offset="1" stopColor={BALL_DARK[col]} />
        </RadialGradient>
        <RadialGradient id="rim" cx="50%" cy="50%" r="50%">
          <Stop offset="0.8" stopColor="#000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000" stopOpacity={0.22} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={50} fill="url(#sph)" />
      <Circle cx={50} cy={50} r={50} fill="url(#rim)" />
      {/* light bouncing back up from the floor */}
      <Ellipse cx={62} cy={86} rx={22} ry={7} fill="#fff" opacity={0.12} />
    </Svg>
  )
}

/** The specular highlight, drawn OVER the number face. */
export function Shine({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" pointerEvents="none">
      <Ellipse cx={31} cy={22} rx={17} ry={9} fill="#fff" opacity={0.6} transform="rotate(-32 31 22)" />
      <Circle cx={22} cy={34} r={3.5} fill="#fff" opacity={0.5} />
    </Svg>
  )
}
