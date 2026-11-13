// The sky behind the Home's header (owner idea, 2026-11): the current weather
// drawn as a soft little landscape — sun, clouds, rain, snow, a storm, fog, or
// a moonlit night — anchored top-left behind the date line and greeting, and
// fading out downward into the page so every line of text stays legible.
// Pure vector SVG, no images. WEB PORT of mobile/src/components/home/
// WeatherScene.tsx for Modo Casa — keep the two drawings in sync. The whole drawing sits under one
// vertical-fade mask; colours are pastel in light mode and deep in dark.
import { useMemo } from 'react'

const W = 400
const H = 340
/** The drawing sits lower than the status bar: elements are authored for a
 *  0…300 box and shifted down by this much. */
const DROP = 64

/** A soft cloud: overlapping circles on a flat base, at (x, y), scaled. */
function Cloud({ x, y, s = 1, fill, opacity = 1 }: { x: number; y: number; s?: number; fill: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={opacity}>
      <circle cx={0} cy={0} r={26} fill={fill} />
      <circle cx={30} cy={-12} r={34} fill={fill} />
      <circle cx={66} cy={-2} r={28} fill={fill} />
      <circle cx={92} cy={8} r={20} fill={fill} />
      <rect x={-10} y={0} width={112} height={28} rx={14} fill={fill} />
    </g>
  )
}

function Sun({ cx, cy, r, color, glow }: { cx: number; cy: number; r: number; color: string; glow: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 3.2} fill="url(#sunGlow)" />
      <circle cx={cx} cy={cy} r={r * 1.55} fill={glow} opacity={0.35} />
      <circle cx={cx} cy={cy} r={r} fill={color} />
    </g>
  )
}

/** Deterministic pseudo-random sequence so drops / flakes / stars don't move
 *  between renders. */
function seq(n: number, seed: number): number[] {
  const out: number[] = []
  let v = seed
  for (let i = 0; i < n; i++) {
    v = (v * 9301 + 49297) % 233280
    out.push(v / 233280)
  }
  return out
}

export type SceneKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm' | 'night' | 'nightCloudy'

export function sceneFor(code: number, isDay = true): SceneKind {
  const night = !isDay
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if (code === 45 || code === 48) return 'fog'
  if (code === 3) return night ? 'nightCloudy' : 'cloudy'
  if (code === 1 || code === 2) return night ? 'nightCloudy' : 'partly'
  return night ? 'night' : 'clear'
}

export function WeatherScene({ kind, dark, className = '' }: { kind: SceneKind; dark: boolean; className?: string }) {
  const p = useMemo(() => palette(kind, dark), [kind, dark])
  const rnd = useMemo(() => seq(120, kind.length * 97 + 13), [kind])

  return (
    <div aria-hidden className={`pointer-events-none absolute top-0 left-0 ${className}`} style={{ aspectRatio: `${W} / ${H}` }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet" className="casa-sky">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor={p.skyTop} stopOpacity={1} />
            <stop offset="1" stopColor={p.skyBottom} stopOpacity={1} />
          </linearGradient>
          <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={p.glow} stopOpacity={0.55} />
            <stop offset="1" stopColor={p.glow} stopOpacity={0} />
          </radialGradient>
          {/* Everything fades out toward the bottom and toward the right, so
              the scene is strongest in the top-left corner (owner: "no canto
              esquerdo") and never fights the greeting or the gear button. */}
          <linearGradient id="fadeY" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={p.strength} />
            <stop offset="0.5" stopColor="#fff" stopOpacity={p.strength * 0.85} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fadeX" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={1} />
            <stop offset="0.55" stopColor="#fff" stopOpacity={0.7} />
            <stop offset="1" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <mask id="fadeYm" x="0" y="0" width={W} height={H}>
            <rect x={0} y={0} width={W} height={H} fill="url(#fadeY)" />
          </mask>
          <mask id="fadeXm" x="0" y="0" width={W} height={H}>
            <rect x={0} y={0} width={W} height={H} fill="url(#fadeX)" />
          </mask>
        </defs>

        <g mask="url(#fadeYm)">
          <g mask="url(#fadeXm)">
            <rect x={0} y={0} width={W} height={H} fill="url(#sky)" />
            <g transform={`translate(0 ${DROP})`}>

            {kind === 'clear' ? (
              <>
                <Sun cx={70} cy={50} r={34} color={p.sun} glow={p.glow} />
                {/* a far, low hill line — the "landscape" */}
                <path d={`M0 250 Q 110 214 220 238 T ${W} 228 L ${W} ${H} L 0 ${H} Z`} fill={p.hill} opacity={0.55} />
              </>
            ) : null}

            {kind === 'partly' ? (
              <>
                <Sun cx={70} cy={52} r={30} color={p.sun} glow={p.glow} />
                <Cloud x={92} y={92} s={1.05} fill={p.cloud} />
                <Cloud x={250} y={60} s={0.7} fill={p.cloud} opacity={0.8} />
                <path d={`M0 250 Q 110 214 220 238 T ${W} 228 L ${W} ${H} L 0 ${H} Z`} fill={p.hill} opacity={0.5} />
              </>
            ) : null}

            {kind === 'cloudy' || kind === 'nightCloudy' ? (
              <>
                {kind === 'nightCloudy' ? <Moon cx={74} cy={52} color={p.sun} glow={p.glow} /> : null}
                <Cloud x={20} y={72} s={1.15} fill={p.cloudDim} />
                <Cloud x={150} y={50} s={0.95} fill={p.cloud} />
                <Cloud x={270} y={92} s={0.8} fill={p.cloudDim} opacity={0.85} />
              </>
            ) : null}

            {kind === 'rain' || kind === 'storm' || kind === 'snow' ? (
              <>
                <Cloud x={20} y={62} s={1.25} fill={p.cloudDim} />
                <Cloud x={170} y={48} s={1} fill={p.cloud} />
                <Cloud x={290} y={78} s={0.75} fill={p.cloudDim} opacity={0.85} />
                {kind === 'snow'
                  ? rnd.slice(0, 46).map((v, i) => (
                      <circle
                        key={i}
                        cx={(v * W * 1.05) % W}
                        cy={110 + ((rnd[i + 50] * 170) % 170)}
                        r={1.8 + (i % 3)}
                        fill={p.drop}
                        opacity={0.85}
                      />
                    ))
                  : rnd.slice(0, 38).map((v, i) => {
                      const x = (v * W * 1.05) % W
                      const y = 110 + ((rnd[i + 50] * 160) % 160)
                      return (
                        <line
                          key={i}
                          x1={x}
                          y1={y}
                          x2={x - 6}
                          y2={y + 16}
                          stroke={p.drop}
                          strokeWidth={2.2}
                          strokeLinecap="round"
                          opacity={0.75}
                        />
                      )
                    })}
                {kind === 'storm' ? (
                  <path d="M118 96 L98 140 L116 140 L104 180 L140 128 L120 128 L134 96 Z" fill={p.bolt} />
                ) : null}
              </>
            ) : null}

            {kind === 'fog' ? (
              <>
                <Sun cx={80} cy={58} r={26} color={p.sun} glow={p.glow} />
                {/* a few soft bands, kept high and short so they never run
                    through the greeting */}
                {[40, 66, 92].map((y, i) => (
                  <rect
                    key={y}
                    x={i % 2 ? 40 : -20}
                    y={y}
                    width={W * 0.62}
                    height={12}
                    rx={6}
                    fill={p.cloud}
                    opacity={0.45 - i * 0.1}
                  />
                ))}
              </>
            ) : null}

            {kind === 'night' ? (
              <>
                {rnd.slice(0, 34).map((v, i) => (
                  <circle
                    key={i}
                    cx={(v * W) % W}
                    cy={(rnd[i + 40] * 190) % 190}
                    r={i % 5 === 0 ? 1.8 : 1.1}
                    fill={p.star}
                    opacity={0.5 + (rnd[i + 80] % 0.5)}
                  />
                ))}
                <Moon cx={74} cy={56} color={p.sun} glow={p.glow} />
                <path d={`M0 252 Q 110 218 220 240 T ${W} 230 L ${W} ${H} L 0 ${H} Z`} fill={p.hill} opacity={0.6} />
              </>
            ) : null}
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}

/** A crescent: a disc with a sky-coloured disc bitten out of it. */
function Moon({ cx, cy, color, glow }: { cx: number; cy: number; color: string; glow: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={90} fill="url(#sunGlow)" />
      <circle cx={cx} cy={cy} r={42} fill={glow} opacity={0.18} />
      <path
        d={`M ${cx + 6} ${cy - 30} A 30 30 0 1 0 ${cx + 6} ${cy + 30} A 23 23 0 1 1 ${cx + 6} ${cy - 30} Z`}
        fill={color}
      />
    </g>
  )
}

interface Palette {
  skyTop: string
  skyBottom: string
  sun: string
  glow: string
  cloud: string
  cloudDim: string
  drop: string
  bolt: string
  hill: string
  star: string
  /** Overall opacity at the top of the fade. */
  strength: number
}

function palette(kind: SceneKind, dark: boolean): Palette {
  const base: Palette = dark
    ? { skyTop: '#2B3550', skyBottom: '#1A1D2A', sun: '#F6C86A', glow: '#F6B04A', cloud: '#5A6378', cloudDim: '#454D60', drop: '#7FA6D6', bolt: '#F6C84A', hill: '#2A3142', star: '#F3EEDB', strength: 0.75 }
    : { skyTop: '#FFD58F', skyBottom: '#FFEFD6', sun: '#FFB733', glow: '#FFA41F', cloud: '#FFFFFF', cloudDim: '#DCE4EE', drop: '#6E9BD3', bolt: '#F5B82E', hill: '#F0C98A', star: '#FFFFFF', strength: 1 }
  switch (kind) {
    case 'clear':
      return base
    case 'partly':
      return dark ? { ...base, skyTop: '#2E3A56' } : { ...base, skyTop: '#BFDDF8', skyBottom: '#F3EDE2', hill: '#E2D3AE' }
    case 'cloudy':
      return dark
        ? { ...base, skyTop: '#33394A' }
        : { ...base, skyTop: '#CDD6E2', skyBottom: '#EEEDEB', cloud: '#FFFFFF', cloudDim: '#DCE3EC' }
    case 'fog':
      return dark
        ? { ...base, skyTop: '#363B47', sun: '#9AA0AE', glow: '#8A90A0' }
        : { ...base, skyTop: '#D3D9E2', skyBottom: '#ECEDEE', sun: '#F7D98F', glow: '#F2CF7A', cloud: '#BCC5D2' }
    case 'rain':
      return dark
        ? { ...base, skyTop: '#28303F', cloud: '#4C5568', cloudDim: '#3C4455' }
        : { ...base, skyTop: '#B5C7DB', skyBottom: '#ECEDEF', cloud: '#F1F4F8', cloudDim: '#D2DBE6' }
    case 'storm':
      return dark
        ? { ...base, skyTop: '#2A2638', cloud: '#4A4560', cloudDim: '#3A3650' }
        : { ...base, skyTop: '#BBB1D4', skyBottom: '#EEEBF0', cloud: '#E6E2EE', cloudDim: '#CFC8DE' }
    case 'snow':
      return dark
        ? { ...base, skyTop: '#2C3548', cloud: '#56607A', cloudDim: '#465068', drop: '#E8EEF8' }
        : { ...base, skyTop: '#CADDF1', skyBottom: '#F1F1F1', cloud: '#FFFFFF', cloudDim: '#DCE6F2', drop: '#93B1D6' }
    case 'night':
    case 'nightCloudy':
      return dark
        ? { ...base, skyTop: '#1E2850', skyBottom: '#15182A', sun: '#F4E6BC', glow: '#E8D49A', hill: '#1C2236', strength: 0.85 }
        : { ...base, skyTop: '#9AA6D8', skyBottom: '#E6E2F0', sun: '#F4C95C', glow: '#F1C24E', cloud: '#C9CEE6', cloudDim: '#B5BBDB', hill: '#BDC2E0', star: '#5D6BB0', strength: 1 }
  }
}
