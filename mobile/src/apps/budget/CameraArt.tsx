// A realistic greyscale camera, drawn (no bitmap, no new asset): the backdrop
// of Money's "Scan receipt" button (owner idea, 2026-11 — it should catch the
// eye). Rendered with a lot of transparency and cropped to the body + lens so
// the label sits on top of it. Fills its parent; `crop` picks the band shown.
import { StyleSheet } from 'react-native'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'

export function CameraArt({ opacity = 0.22 }: { opacity?: number }) {
  return (
    // viewBox crops the 240×150 drawing to its middle band (body + lens), so a
    // wide, short button still shows the lens front and centre.
    <Svg style={StyleSheet.absoluteFill} viewBox="16 52 210 78" preserveAspectRatio="xMidYMid slice" pointerEvents="none">
      <Defs>
        <LinearGradient id="cBody" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4a4a4a" />
          <Stop offset="0.5" stopColor="#2a2a2a" />
          <Stop offset="1" stopColor="#161616" />
        </LinearGradient>
        <LinearGradient id="cPlate" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f2f2f2" />
          <Stop offset="0.45" stopColor="#bdbdbd" />
          <Stop offset="0.55" stopColor="#9a9a9a" />
          <Stop offset="1" stopColor="#d6d6d6" />
        </LinearGradient>
        <LinearGradient id="cMetal" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#f5f5f5" />
          <Stop offset="0.35" stopColor="#9c9c9c" />
          <Stop offset="0.6" stopColor="#e2e2e2" />
          <Stop offset="1" stopColor="#6e6e6e" />
        </LinearGradient>
        <RadialGradient id="cGlass" cx="0.42" cy="0.38" r="0.7">
          <Stop offset="0" stopColor="#5a5a5a" />
          <Stop offset="0.35" stopColor="#262626" />
          <Stop offset="0.8" stopColor="#0b0b0b" />
          <Stop offset="1" stopColor="#000" />
        </RadialGradient>
        <RadialGradient id="cDeep" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#3c3c3c" />
          <Stop offset="0.6" stopColor="#121212" />
          <Stop offset="1" stopColor="#050505" />
        </RadialGradient>
        <LinearGradient id="cGrip" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#1c1c1c" />
          <Stop offset="0.5" stopColor="#2e2e2e" />
          <Stop offset="1" stopColor="#151515" />
        </LinearGradient>
        <Pattern id="cLeather" width="3" height="3" patternUnits="userSpaceOnUse">
          <Rect width="3" height="3" fill="#232323" />
          <Circle cx="1" cy="1" r="0.7" fill="#2f2f2f" />
          <Circle cx="2.4" cy="2.3" r="0.5" fill="#1a1a1a" />
        </Pattern>
      </Defs>
      <G opacity={opacity}>
        {/* top plate */}
        <Rect x="16" y="30" width="208" height="20" rx="8" fill="url(#cPlate)" />
        {/* body, leatherette, grip */}
        <Rect x="12" y="44" width="216" height="98" rx="14" fill="url(#cBody)" />
        <Rect x="12" y="56" width="216" height="76" fill="url(#cLeather)" opacity={0.95} />
        <Rect x="12" y="44" width="216" height="98" rx="14" fill="none" stroke="#5a5a5a" strokeWidth={1} />
        <Rect x="12" y="44" width="44" height="98" rx="14" fill="url(#cGrip)" />
        {/* lens: knurled metal ring, inner ring, glass, aperture */}
        <Circle cx="132" cy="92" r="50" fill="url(#cMetal)" />
        <Circle cx="132" cy="92" r="45" fill="#1b1b1b" />
        <Circle cx="132" cy="92" r="45" fill="none" stroke="#3a3a3a" strokeWidth={5} strokeDasharray="1.2 1.6" />
        <Circle cx="132" cy="92" r="38" fill="url(#cMetal)" />
        <Circle cx="132" cy="92" r="34" fill="#0e0e0e" />
        <Circle cx="132" cy="92" r="30" fill="url(#cGlass)" />
        <Circle cx="132" cy="92" r="17" fill="url(#cDeep)" />
        <Circle cx="132" cy="92" r="17" fill="none" stroke="#4a4a4a" strokeWidth={0.8} />
        <Circle cx="132" cy="92" r="8" fill="#050505" />
        {/* reflections */}
        <Ellipse cx="120" cy="78" rx="11" ry="6" fill="#fff" opacity={0.35} transform="rotate(-30 120 78)" />
        <Circle cx="126" cy="86" r="2.4" fill="#fff" opacity={0.7} />
        <Ellipse cx="146" cy="106" rx="6" ry="3" fill="#fff" opacity={0.12} transform="rotate(-30 146 106)" />
        {/* viewfinder window */}
        <Circle cx="200" cy="60" r="5" fill="#111" stroke="#666" strokeWidth={1} />
        <Circle cx="198.5" cy="58.5" r="1.4" fill="#fff" opacity={0.5} />
      </G>
    </Svg>
  )
}
