// The sky behind Modo Casa (round 2, owner 2026-11): the current weather as a
// soft, layered band across the TOP of the screen — sky gradient, a sun with a
// halo and slowly breathing rays (or a crescent moon over twinkling stars),
// far and near clouds drifting at different speeds, rain / snow falling, the
// odd storm flash, fog banks swaying. It fades into the page well before the
// content, and the sun/moon sit in the header's quiet gap (landscape) or
// beside the clock (portrait) — never behind the clock's digits.
//
// Performance (a tablet runs this all day): every moving part is its own
// absolutely-positioned layer animated with transform/opacity only (see
// casa.css `.casa-wx-*`), so the GPU just slides pre-rasterised textures —
// nothing repaints. Clouds loop seamlessly as two identical tiles; rain and
// snow are SVG patterns slid by exactly one tile. Reduced motion freezes all.
//
// Derived from mobile/src/components/home/WeatherScene.tsx (same SceneKind
// mapping); the drawing itself is web-only now.
import { useMemo, type CSSProperties } from 'react'

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

// ── palette ──────────────────────────────────────────────────────────────────

interface Palette {
  skyTop: string
  skyMid: string
  glow: string
  sunCore: string
  sunEdge: string
  ray: string
  cloudLit: string
  cloudShade: string
  drop: string
  bolt: string
  flash: string
  star: string
  /** Opacity of the whole sky. */
  strength: number
}

function palette(kind: SceneKind, dark: boolean): Palette {
  const L: Palette = {
    skyTop: '#9CCBF0',
    skyMid: '#D3E8F6',
    glow: '#FFD27A',
    sunCore: '#FFF6D2',
    sunEdge: '#FFC247',
    ray: '#FFCF6E',
    cloudLit: '#FFFFFF',
    cloudShade: '#E2E9F1',
    drop: '#7E9AC0',
    bolt: '#FFCF4D',
    flash: '#FFFFFF',
    star: '#FFFFFF',
    strength: 0.72,
  }
  const D: Palette = {
    skyTop: '#22426A',
    skyMid: '#1F2A3C',
    glow: '#F5A93A',
    sunCore: '#FFF5CF',
    sunEdge: '#F9C35A',
    ray: '#F5B54A',
    cloudLit: '#56617A',
    cloudShade: '#3B4456',
    drop: '#86A3CB',
    bolt: '#FFD566',
    flash: '#B9B3FF',
    star: '#F5F0DC',
    strength: 0.72,
  }
  const b = dark ? D : L
  switch (kind) {
    case 'clear':
      return b
    case 'partly':
      return dark ? { ...b, skyTop: '#253F63' } : { ...b, skyTop: '#A6CDEC', skyMid: '#DCEAF4' }
    case 'cloudy':
      return dark
        ? { ...b, skyTop: '#2C3646', skyMid: '#24282F', cloudLit: '#4C5668', cloudShade: '#373F4D' }
        : { ...b, skyTop: '#BFCAD7', skyMid: '#E2E6EA', cloudLit: '#F7F9FB', cloudShade: '#CBD4DF' }
    case 'fog':
      return dark
        ? { ...b, skyTop: '#2E333C', skyMid: '#26282C', sunCore: '#C9C6B8', sunEdge: '#9A978C', glow: '#8F8A7C', cloudLit: '#727A88', cloudShade: '#5A616E' }
        : { ...b, skyTop: '#D0D6DE', skyMid: '#E9EAEB', sunCore: '#FBF1D2', sunEdge: '#EED79B', glow: '#F1DCA0', cloudLit: '#FFFFFF', cloudShade: '#E4E8EC' }
    case 'rain':
      return dark
        ? { ...b, skyTop: '#222C3A', skyMid: '#1F2329', cloudLit: '#434D5F', cloudShade: '#30384A' }
        : { ...b, skyTop: '#A7B6C8', skyMid: '#DCE1E6', cloudLit: '#E8ECF1', cloudShade: '#BCC6D2' }
    case 'storm':
      return dark
        ? { ...b, skyTop: '#241F36', skyMid: '#1E1C26', cloudLit: '#403A58', cloudShade: '#2C2840' }
        : { ...b, skyTop: '#9F9CBB', skyMid: '#DAD8E2', cloudLit: '#D9D6E5', cloudShade: '#A9A5C2', drop: '#7D7FA8' }
    case 'snow':
      return dark
        ? { ...b, skyTop: '#26324A', skyMid: '#20242E', cloudLit: '#525D78', cloudShade: '#3D4762', drop: '#E9EEF7' }
        : { ...b, skyTop: '#C5D6E8', skyMid: '#E7EDF3', cloudLit: '#FBFCFE', cloudShade: '#D5DFEA', drop: '#AFC3DC' }
    case 'night':
    case 'nightCloudy': {
      const n = dark
        ? { ...b, skyTop: '#121B3A', skyMid: '#18192A', sunCore: '#F7EED2', sunEdge: '#E4D3A4', glow: '#B9B2E6', cloudLit: '#363E5C', cloudShade: '#262C45', strength: 0.95 }
        : { ...b, skyTop: '#6E7DB6', skyMid: '#BCC2E0', sunCore: '#FFF8E2', sunEdge: '#F4DFA6', glow: '#E7E1FF', cloudLit: '#A7AFD2', cloudShade: '#8C96C1', strength: 0.75 }
      return n
    }
  }
}

// ── geometry ─────────────────────────────────────────────────────────────────

/** Cloud tiles are 4:1 so two side by side always cover a landscape or
 *  portrait screen at the band's height. */
const TW = 1600
const TH = 400

interface CloudSpec {
  x: number
  y: number
  s: number
  o: number
  v: 0 | 1 | 2
}

/** A cloud: a flat-bottomed cluster of puffs, lit from above. Three shapes so
 *  a sky never looks copy-pasted. */
function Cloud({ c, fill }: { c: CloudSpec; fill: string }) {
  const puffs =
    c.v === 0
      ? [
          [0, 0, 30],
          [34, -18, 40],
          [78, -6, 34],
          [110, 6, 24],
        ]
      : c.v === 1
        ? [
            [0, 4, 22],
            [26, -14, 30],
            [62, -26, 38],
            [100, -10, 30],
            [130, 4, 20],
          ]
        : [
            [0, 0, 24],
            [30, -12, 30],
            [60, -2, 24],
          ]
  const w = c.v === 0 ? 134 : c.v === 1 ? 150 : 84
  return (
    <g transform={`translate(${c.x} ${c.y}) scale(${c.s})`} opacity={c.o}>
      {puffs.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={fill} />
      ))}
      <rect x={-22} y={0} width={w} height={26} rx={13} fill={fill} />
    </g>
  )
}

function rnd(n: number, seed: number): number[] {
  const out: number[] = []
  let v = seed
  for (let i = 0; i < n; i++) {
    v = (v * 9301 + 49297) % 233280
    out.push(v / 233280)
  }
  return out
}

function cloudsFor(kind: SceneKind): { far: CloudSpec[]; near: CloudSpec[] } {
  const heavy = kind === 'rain' || kind === 'storm' || kind === 'snow'
  const nFar = kind === 'clear' || kind === 'night' ? 2 : kind === 'fog' ? 0 : heavy || kind === 'cloudy' ? 7 : 4
  const nNear = kind === 'clear' || kind === 'night' || kind === 'fog' ? 0 : heavy ? 6 : kind === 'cloudy' ? 5 : 3
  const r = rnd(80, kind.length * 131 + 7)
  const far: CloudSpec[] = []
  for (let i = 0; i < nFar; i++) {
    far.push({
      x: 60 + (i / nFar) * (TW - 260) + r[i] * 90,
      y: 70 + r[i + 20] * 70,
      s: 0.55 + r[i + 40] * 0.35,
      o: kind === 'clear' || kind === 'night' ? 0.35 : 0.55 + r[i + 60] * 0.25,
      v: (i % 3) as 0 | 1 | 2,
    })
  }
  const near: CloudSpec[] = []
  for (let i = 0; i < nNear; i++) {
    near.push({
      x: 120 + (i / nNear) * (TW - 360) + r[i + 10] * 120,
      y: (heavy ? 92 : 118) + r[i + 30] * 50,
      s: (heavy ? 1.25 : 1) + r[i + 50] * 0.45,
      o: 0.92,
      v: ((i + 1) % 2) as 0 | 1,
    })
  }
  return { far, near }
}

// ── layers ───────────────────────────────────────────────────────────────────

function CloudTile({ id, clouds, p, soft }: { id: string; clouds: CloudSpec[]; p: Palette; soft: boolean }) {
  return (
    <svg viewBox={`0 0 ${TW} ${TH}`} preserveAspectRatio="xMinYMin meet" className="casa-wx-tile">
      <defs>
        <linearGradient id={`${id}-g`} gradientUnits="userSpaceOnUse" x1="0" y1="-60" x2="0" y2="26">
          <stop offset="0" stopColor={p.cloudLit} />
          <stop offset="1" stopColor={p.cloudShade} />
        </linearGradient>
        {soft ? (
          <filter id={`${id}-b`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        ) : null}
      </defs>
      <g filter={soft ? `url(#${id}-b)` : undefined}>
        {clouds.map((c, i) => (
          <Cloud key={i} c={c} fill={`url(#${id}-g)`} />
        ))}
      </g>
    </svg>
  )
}

/** Two identical tiles side by side, slid left by one tile forever. */
function Drift({ id, clouds, p, soft, dur }: { id: string; clouds: CloudSpec[]; p: Palette; soft: boolean; dur: number }) {
  if (!clouds.length) return null
  return (
    <div className="casa-wx-drift" style={{ animationDuration: `${dur}s` }}>
      <CloudTile id={`${id}a`} clouds={clouds} p={p} soft={soft} />
      <CloudTile id={`${id}b`} clouds={clouds} p={p} soft={soft} />
    </div>
  )
}

/** A falling layer: a pattern tile repeated over the band, slid down by
 *  exactly one tile so the loop is seamless. */
function Fall({
  id,
  tile,
  dur,
  opacity,
  kind,
  color,
  seed,
}: {
  id: string
  tile: number
  dur: number
  opacity: number
  kind: 'rain' | 'snow'
  color: string
  seed: number
}) {
  const r = useMemo(() => rnd(40, seed), [seed])
  const n = kind === 'rain' ? 5 : 6
  return (
    <div className="casa-wx-fall" style={{ top: -tile, height: `calc(100% + ${tile}px)`, opacity, animationDuration: `${dur}s`, ['--tile' as string]: `${tile}px` } as CSSProperties}>
      <svg width="100%" height="100%">
        <defs>
          <linearGradient id={`${id}-d`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0} />
            <stop offset="1" stopColor={color} stopOpacity={1} />
          </linearGradient>
          <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
            {Array.from({ length: n }, (_, i) => {
              const x = (r[i] * tile) | 0
              const y = (r[i + 10] * tile) | 0
              if (kind === 'rain') {
                const len = tile * (0.16 + r[i + 20] * 0.1)
                // Drawn twice (y and y - tile) so a streak crossing the tile
                // edge wraps instead of being cut.
                return (
                  <g key={i}>
                    <rect x={x} y={y} width={1.6} height={len} rx={0.8} fill={`url(#${id}-d)`} />
                    <rect x={x} y={y - tile} width={1.6} height={len} rx={0.8} fill={`url(#${id}-d)`} />
                  </g>
                )
              }
              const rr = (tile / 80) * (1.1 + r[i + 20] * 1.5)
              return (
                <g key={i} fill={color} opacity={0.6 + r[i + 30] * 0.4}>
                  <circle cx={x} cy={y} r={rr} />
                  <circle cx={x} cy={y - tile} r={rr} />
                  <circle cx={x} cy={y + tile} r={rr} />
                </g>
              )
            })}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    </div>
  )
}

function Stars({ p, few }: { p: Palette; few: boolean }) {
  const r = useMemo(() => rnd(240, 4242), [])
  const n = few ? 24 : 60
  const group = (g: number) => (
    <svg key={g} viewBox={`0 0 ${TW} ${TH}`} preserveAspectRatio="xMidYMin slice" className={`casa-wx-twinkle casa-wx-tw${g}`}>
      {Array.from({ length: n }, (_, i) => i)
        .filter((i) => i % 3 === g)
        .map((i) => {
          const big = i % 11 === 0
          return (
            <circle
              key={i}
              cx={r[i] * TW}
              cy={14 + r[i + 80] * (TH * 0.62)}
              r={big ? 2.1 : 1 + r[i + 160] * 0.7}
              fill={p.star}
              opacity={0.45 + r[i + 120] * 0.55}
            />
          )
        })}
    </svg>
  )
  return <>{[0, 1, 2].map(group)}</>
}

function Sun({ p, rays, dim }: { p: Palette; rays: boolean; dim?: boolean }) {
  const n = 24
  return (
    <div className="casa-wx-orb" style={{ opacity: dim ? 0.5 : 1 }}>
      <div className="casa-wx-halo" style={{ background: `radial-gradient(circle, ${p.glow}55 0%, ${p.glow}1c 34%, transparent 66%)` }} />
      {rays ? (
        <div className="casa-wx-breathe">
          <svg viewBox="-160 -160 320 320" className="casa-wx-rays">
            <defs>
              <radialGradient id="wx-ray" cx="0" cy="0" r="150" gradientUnits="userSpaceOnUse">
                <stop offset="0.22" stopColor={p.ray} stopOpacity={0.34} />
                <stop offset="1" stopColor={p.ray} stopOpacity={0} />
              </radialGradient>
            </defs>
            {Array.from({ length: n }, (_, i) => {
              const a = (i / n) * Math.PI * 2
              const long = i % 2 === 0
              const r0 = 30
              const r1 = long ? 128 : 88
              const w = long ? 0.05 : 0.035
              const pt = (ang: number, rad: number) => `${Math.cos(ang) * rad},${Math.sin(ang) * rad}`
              return <polygon key={i} points={`${pt(a - w, r0)} ${pt(a, r1)} ${pt(a + w, r0)}`} fill="url(#wx-ray)" />
            })}
          </svg>
        </div>
      ) : null}
      <svg viewBox="-160 -160 320 320" className="casa-wx-disc">
        <defs>
          <radialGradient id="wx-sun" cx="-6" cy="-8" r="30" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.sunCore} />
            <stop offset="0.7" stopColor={p.sunEdge} />
            <stop offset="1" stopColor={p.sunEdge} />
          </radialGradient>
          <radialGradient id="wx-sunring" cx="0" cy="0" r="44" gradientUnits="userSpaceOnUse">
            <stop offset="0.45" stopColor={p.glow} stopOpacity={0.35} />
            <stop offset="1" stopColor={p.glow} stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle r={44} fill="url(#wx-sunring)" />
        <circle r={23} fill="url(#wx-sun)" />
      </svg>
    </div>
  )
}

function Moon({ p }: { p: Palette }) {
  return (
    <div className="casa-wx-orb">
      <div className="casa-wx-halo casa-wx-halo-slow" style={{ background: `radial-gradient(circle, ${p.glow}40 0%, ${p.glow}14 40%, transparent 70%)` }} />
      <svg viewBox="-160 -160 320 320" className="casa-wx-disc">
        <defs>
          <mask id="wx-crescent">
            <circle r={28} fill="#fff" />
            <circle cx={14} cy={-9} r={25} fill="#000" />
          </mask>
          <radialGradient id="wx-moon" cx="-14" cy="6" r="34" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.sunCore} />
            <stop offset="1" stopColor={p.sunEdge} />
          </radialGradient>
        </defs>
        <g mask="url(#wx-crescent)">
          <circle r={28} fill="url(#wx-moon)" />
          <circle cx={-14} cy={8} r={4} fill={p.sunEdge} opacity={0.35} />
          <circle cx={-6} cy={18} r={2.6} fill={p.sunEdge} opacity={0.3} />
          <circle cx={-19} cy={-6} r={2.2} fill={p.sunEdge} opacity={0.3} />
        </g>
      </svg>
    </div>
  )
}

function Fog({ p }: { p: Palette }) {
  const band = (y: number, x: number, rx: number, o: number) => <ellipse cx={x} cy={y} rx={rx} ry={22} fill={p.cloudLit} opacity={o} />
  return (
    <>
      <svg viewBox={`0 0 ${TW} ${TH}`} preserveAspectRatio="xMidYMin slice" className="casa-wx-fog casa-wx-fog1">
        <defs>
          <filter id="wx-fogblur" x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <g filter="url(#wx-fogblur)">
          {band(70, 420, 520, 0.55)}
          {band(150, 1150, 600, 0.5)}
          {band(230, 600, 700, 0.4)}
        </g>
      </svg>
      <svg viewBox={`0 0 ${TW} ${TH}`} preserveAspectRatio="xMidYMin slice" className="casa-wx-fog casa-wx-fog2">
        <defs>
          <filter id="wx-fogblur2" x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        <g filter="url(#wx-fogblur2)">
          {band(110, 1000, 560, 0.45)}
          {band(190, 260, 520, 0.4)}
        </g>
      </svg>
    </>
  )
}

export function WeatherScene({ kind, dark }: { kind: SceneKind; dark: boolean }) {
  const p = useMemo(() => palette(kind, dark), [kind, dark])
  const { far, near } = useMemo(() => cloudsFor(kind), [kind])
  const night = kind === 'night' || kind === 'nightCloudy'
  const showSun = kind === 'clear' || kind === 'partly' || kind === 'fog'
  const heavy = kind === 'rain' || kind === 'storm' || kind === 'snow'

  return (
    <div aria-hidden className="casa-wx" style={{ opacity: p.strength }}>
      {/* sky: a vertical wash that dissolves into the page, warmed around the
          sun/moon's spot */}
      <div
        className="casa-wx-layer"
        style={{
          background: `radial-gradient(circle at var(--wx-sx) var(--wx-sy), ${p.glow}${night ? '22' : heavy ? '10' : '38'} 0%, transparent 32%), linear-gradient(180deg, ${p.skyTop} 0%, ${p.skyMid} 52%, transparent 100%)`,
        }}
      />
      {night ? <Stars p={p} few={kind === 'nightCloudy'} /> : null}
      {showSun ? <Sun p={p} rays={kind !== 'fog'} dim={kind === 'fog'} /> : night ? <Moon p={p} /> : null}
      <div className="casa-wx-layer" style={{ opacity: heavy ? 0.85 : 0.75 }}>
        <Drift id="wxf" clouds={far} p={p} soft dur={340} />
      </div>
      {kind === 'rain' || kind === 'storm' ? (
        <div className="casa-wx-precip casa-wx-slant">
          <Fall id="wxr1" kind="rain" tile={110} dur={1.5} opacity={0.4} color={p.drop} seed={11} />
          <Fall id="wxr2" kind="rain" tile={150} dur={0.95} opacity={kind === 'storm' ? 0.7 : 0.6} color={p.drop} seed={29} />
        </div>
      ) : null}
      {kind === 'snow' ? (
        <div className="casa-wx-precip">
          <div className="casa-wx-sway">
            <Fall id="wxs1" kind="snow" tile={150} dur={16} opacity={0.5} color={p.drop} seed={5} />
          </div>
          <div className="casa-wx-sway casa-wx-sway2">
            <Fall id="wxs2" kind="snow" tile={230} dur={11} opacity={0.72} color={p.drop} seed={17} />
          </div>
        </div>
      ) : null}
      {kind === 'fog' ? <Fog p={p} /> : null}
      <div className="casa-wx-layer">
        <Drift id="wxn" clouds={near} p={p} soft={false} dur={heavy ? 190 : 230} />
      </div>
      {kind === 'storm' ? (
        <>
          <div className="casa-wx-layer casa-wx-flash" style={{ background: `linear-gradient(180deg, ${p.flash} 0%, transparent 75%)` }} />
          <svg viewBox="0 0 60 120" className="casa-wx-bolt">
            <path d="M34 0 L8 64 L28 64 L16 120 L54 46 L32 46 L46 0 Z" fill={p.bolt} />
          </svg>
        </>
      ) : null}
      {/* hands the band over to the page well above the content */}
      <div className="casa-wx-layer" style={{ background: 'linear-gradient(180deg, transparent 38%, var(--bg) 100%)' }} />
    </div>
  )
}
