// The battleship board: an 8×8 patch of sea with ships, shots and the latest
// shot animated (a ripple for water, a burst for a hit). Used for both your
// own fleet and the enemy's waters. Drawn with plain Views (cells, markers)
// plus one SVG per ship so it stays crisp at any size; motion via Reanimated.
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import Animated, { Easing, FadeIn, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg'

import type { Gradient } from '@/components/home/palette'
import type { Ship, Shot } from '@/lib/games'

const SEA: Gradient = ['#8ED3FA', '#4A9BEA']
const SEA_DEEP = '#3C86D6'

/** Hull outline for a ship `len` long, drawn along X in a len×1 box (units of
 *  100), bow on the right — then mapped to vertical when needed. */
function hullPath(len: number, vertical: boolean) {
  const L = len * 100
  const pts: [number, number][] = [
    [14, 30],
    [L - 46, 22],
    [L - 10, 50],
    [L - 46, 78],
    [14, 70],
    [8, 50],
  ]
  const map = ([x, y]: [number, number]) => (vertical ? `${y},${x}` : `${x},${y}`)
  return `M${map(pts[0])} L${map(pts[1])} Q${map([L - 22, 26])} ${map(pts[2])} Q${map([L - 22, 74])} ${map(pts[3])} L${map(pts[4])} Q${map([6, 70])} ${map(pts[5])} Q${map([6, 30])} ${map(pts[0])} Z`
}

/** Hull for the ship art: square-ish stern on the left, pointed bow on the
 *  right, drawn along X in a len×1 box (units of 100). */
function artHull(L: number, inset = 0) {
  const i = inset
  return `M${12 + i} ${16 + i} L${L - 64} ${12 + i} Q${L - 18 - i} ${18 + i} ${L - 5 - i * 1.6} 50 Q${L - 18 - i} ${82 - i} ${L - 64} ${88 - i} L${12 + i} ${84 - i} Q${4 + i} ${84 - i} ${4 + i} ${74 - i} L${4 + i} ${26 + i} Q${4 + i} ${16 + i} ${12 + i} ${16 + i} Z`
}

/** Where the deck pieces go, by ship length: the bridge, funnels and guns
 *  (x centres, in units of 100 per cell). Guns point to the bow. */
function shipLayout(len: number) {
  const L = len * 100
  if (len <= 2) return { bridge: 72, funnels: [128], guns: [] as number[] }
  if (len === 3) return { bridge: 88, funnels: [150], guns: [L - 78] }
  if (len === 4) return { bridge: 112, funnels: [178, 232], guns: [L - 78] }
  return { bridge: 140, funnels: [208, 262], guns: [L - 150, L - 78] }
}

/** Just the ship drawing, `len` cells long, at a given cell size — used on
 *  the board and for the ghost that follows your finger while dragging.
 *  v2 (owner, 2026-11: "a 3D touch, little funnels, more professional"):
 *  a rounded hull lit from above, a pale deck, a bridge with windows, funnels
 *  in the team colour with a white band, guns at the bow, soft shadows. */
export function ShipShape({
  len,
  dir,
  cell,
  colors,
  sunk,
  selected,
}: {
  len: number
  dir: 'h' | 'v'
  cell: number
  colors: Gradient
  sunk?: boolean
  selected?: boolean
}) {
  const v = dir === 'v'
  const L = len * 100
  const w = (v ? 1 : len) * cell
  const h = (v ? len : 1) * cell
  const vb = v ? `0 0 100 ${L}` : `0 0 ${L} 100`
  const key = `${len}${sunk ? 's' : ''}${colors[1].slice(1)}`
  const [light, dark] = sunk ? (['#9AA0AA', '#5E636D'] as const) : colors
  const steel = sunk ? (['#B4B9C2', '#7E848F'] as const) : (['#E9EDF2', '#A9B2BF'] as const)
  const lay = shipLayout(len)
  return (
    <Svg viewBox={vb} width={w} height={h}>
      <Defs>
        <LinearGradient id={`hl${key}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={light} />
          <Stop offset="0.55" stopColor={dark} />
          <Stop offset="1" stopColor={dark} />
        </LinearGradient>
        <LinearGradient id={`st${key}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={steel[0]} />
          <Stop offset="1" stopColor={steel[1]} />
        </LinearGradient>
      </Defs>
      {/* drawn along X; a vertical ship is the same art turned a quarter */}
      <G transform={v ? 'translate(100 0) rotate(90)' : undefined}>
        <Path d={artHull(L)} fill="rgba(10,40,90,0.30)" transform="translate(3 7)" />
        <Path d={artHull(L)} fill={`url(#hl${key})`} stroke={selected ? '#fff' : 'rgba(0,0,0,0.28)'} strokeWidth={selected ? 7 : 3} />
        <Path d={artHull(L, 8)} fill={sunk ? '#C9CCD2' : '#F4EFE6'} />
        <Path d={`M18 33 L${L - 70} 29`} stroke="rgba(0,0,0,0.07)" strokeWidth={2} />
        <Path d={`M18 67 L${L - 70} 71`} stroke="rgba(0,0,0,0.07)" strokeWidth={2} />
        <Path d={`M16 21 L${L - 66} 17`} stroke="rgba(255,255,255,0.55)" strokeWidth={3} strokeLinecap="round" />
        {/* bridge */}
        <Rect x={lay.bridge - 26} y={32} width={58} height={44} rx={8} fill="rgba(10,40,90,0.22)" />
        <Rect x={lay.bridge - 30} y={27} width={58} height={44} rx={8} fill={`url(#st${key})`} stroke="rgba(0,0,0,0.22)" strokeWidth={2.5} />
        <Rect x={lay.bridge + 14} y={34} width={9} height={30} rx={3} fill={sunk ? '#555A63' : '#22324F'} />
        <Rect x={lay.bridge - 23} y={33} width={24} height={9} rx={3} fill="rgba(255,255,255,0.55)" />
        {/* guns */}
        {lay.guns.map((x) => (
          <G key={`g${x}`}>
            <Circle cx={x + 3} cy={54} r={14} fill="rgba(10,40,90,0.22)" />
            <Rect x={x} y={46} width={34} height={8} rx={4} fill={sunk ? '#6B707A' : '#4B5563'} />
            <Circle cx={x} cy={50} r={14} fill={`url(#st${key})`} stroke="rgba(0,0,0,0.25)" strokeWidth={2.5} />
          </G>
        ))}
        {/* funnels: a short cylinder seen from above, leaning to the light */}
        {lay.funnels.map((x) => (
          <G key={`f${x}`}>
            <Ellipse cx={x + 6} cy={57} rx={15} ry={18} fill="rgba(10,40,90,0.25)" />
            <Ellipse cx={x} cy={50} rx={15} ry={18} fill={dark} stroke="rgba(0,0,0,0.3)" strokeWidth={2.5} />
            <Ellipse cx={x - 2} cy={47} rx={13} ry={16} fill={light} />
            <Ellipse cx={x - 2} cy={47} rx={10} ry={12.5} fill="none" stroke="#fff" strokeWidth={3.5} />
            <Ellipse cx={x - 3} cy={45} rx={6} ry={7.5} fill="#1D2230" />
          </G>
        ))}
      </G>
    </Svg>
  )
}

function ShipArt({
  ship,
  cell,
  colors,
  sunk,
  selected,
  appearAfter,
}: {
  ship: Ship
  cell: number
  colors: Gradient
  sunk?: boolean
  selected?: boolean
  /** Fade in after this many ms (the wreck, once the sinking has played). */
  appearAfter?: number
}) {
  const v = ship.dir === 'v'
  return (
    <Animated.View
      pointerEvents="none"
      entering={appearAfter ? FadeIn.delay(appearAfter).duration(500) : undefined}
      style={{ position: 'absolute', left: ship.c * cell, top: ship.r * cell, width: (v ? 1 : ship.len) * cell, height: (v ? ship.len : 1) * cell }}
    >
      <ShipShape len={ship.len} dir={ship.dir} cell={cell} colors={colors} sunk={sunk} selected={selected} />
    </Animated.View>
  )
}

const shipKey = (s: Ship) => `${s.r}:${s.c}:${s.dir}:${s.len}`
/** The sinking starts once the missile has landed and the burst flashed. */
const SINK_DELAY = 900
const SINK_MS = 1700

/** A whole ship going down (owner, 2026-11): it shows in its colours, lists
 *  to one side, settles and fades into the sea while rings spread from every
 *  cell and bubbles break the surface. The grey wreck fades in underneath. */
function SinkFx({ ship, cell, colors }: { ship: Ship; cell: number; colors: Gradient }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.set(withDelay(SINK_DELAY, withTiming(1, { duration: SINK_MS, easing: Easing.inOut(Easing.quad) })))
  }, [p])
  const v = ship.dir === 'v'
  const w = (v ? 1 : ship.len) * cell
  const h = (v ? ship.len : 1) * cell
  // which way it lists: varies by position so two wrecks never match
  const tilt = (ship.r + ship.c) % 2 ? 7 : -7
  const hull = useAnimatedStyle(() => {
    const x = p.value
    return {
      opacity: x === 0 ? 0 : interpolate(x, [0, 0.06, 0.5, 1], [0, 1, 0.85, 0]),
      transform: [
        { translateX: v ? interpolate(x, [0.2, 1], [0, cell * 0.08], 'clamp') : 0 },
        { translateY: v ? 0 : interpolate(x, [0.2, 1], [0, cell * 0.1], 'clamp') },
        { rotate: `${interpolate(x, [0.1, 0.6], [0, tilt], 'clamp')}deg` },
        { scale: interpolate(x, [0.25, 1], [1, 0.74], 'clamp') },
      ],
    }
  })
  const cells = Array.from({ length: ship.len }, (_, i) => ({ r: ship.r + (v ? i : 0), c: ship.c + (v ? 0 : i), i }))
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.abs, { left: ship.c * cell, top: ship.r * cell, width: w, height: h, zIndex: 4 }, hull]}>
        <ShipShape len={ship.len} dir={ship.dir} cell={cell} colors={colors} />
      </Animated.View>
      {cells.map(({ r, c, i }) => (
        <View key={i} pointerEvents="none" style={[styles.fx, { left: c * cell, top: r * cell, width: cell, height: cell, zIndex: 5 }]}>
          <SinkRing p={p} cell={cell} from={0.25 + i * 0.07} />
          <SinkRing p={p} cell={cell} from={0.5 + i * 0.05} />
          {[0, 1, 2].map((b) => (
            <Bubble key={b} p={p} cell={cell} from={0.35 + ((i * 3 + b) % 7) * 0.07} dx={((i * 5 + b * 3) % 5) / 4 - 0.5} dy={((i * 3 + b * 7) % 5) / 4 - 0.5} />
          ))}
        </View>
      ))}
    </>
  )
}

type Progress = ReturnType<typeof useSharedValue<number>>

function SinkRing({ p, cell, from }: { p: Progress; cell: number; from: number }) {
  const style = useAnimatedStyle(() => {
    const t = interpolate(p.value, [from, Math.min(1, from + 0.45)], [0, 1], 'clamp')
    return { opacity: t === 0 || t === 1 ? 0 : 0.8 * (1 - t), transform: [{ scale: 0.3 + t * 1.3 }] }
  })
  return <Animated.View style={[styles.abs, { width: cell * 0.9, height: cell * 0.9, borderRadius: cell, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.9)' }, style]} />
}

function Bubble({ p, cell, from, dx, dy }: { p: Progress; cell: number; from: number; dx: number; dy: number }) {
  const size = cell * (0.12 + Math.abs(dx) * 0.1)
  const style = useAnimatedStyle(() => {
    const t = interpolate(p.value, [from, Math.min(1, from + 0.3)], [0, 1], 'clamp')
    return {
      opacity: t === 0 || t === 1 ? 0 : interpolate(t, [0, 0.3, 0.85, 1], [0, 0.95, 0.8, 0]),
      transform: [{ translateX: dx * cell * 0.6 }, { translateY: dy * cell * 0.6 }, { scale: interpolate(t, [0, 0.85, 1], [0.2, 1, 1.4]) }],
    }
  })
  return <Animated.View style={[styles.abs, { width: size, height: size, borderRadius: size, borderWidth: 1.5, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.35)' }, style]} />
}

/** A burst for a hit: an orange star with a flickering core. */
function HitMark({ size }: { size: number }) {
  const f = useSharedValue(0)
  useEffect(() => {
    f.set(withRepeat(withSequence(withTiming(1, { duration: 520 }), withTiming(0, { duration: 520 })), -1))
  }, [f])
  const flicker = useAnimatedStyle(() => ({ opacity: 0.75 + f.value * 0.25, transform: [{ scale: 0.92 + f.value * 0.08 }] }))
  return (
    <Animated.View style={[{ width: size, height: size }, flicker]}>
      <Svg viewBox="0 0 100 100" width={size} height={size}>
        <Polygon points="50,6 61,34 92,30 68,52 84,82 54,68 34,94 36,62 8,52 36,40" fill="#FF7A2F" />
        <Polygon points="50,24 57,42 74,40 61,54 70,72 52,63 40,78 42,59 26,52 43,44" fill="#FFD25C" />
      </Svg>
    </Animated.View>
  )
}

function MissMark({ size }: { size: number }) {
  return <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: 'rgba(255,255,255,0.9)' }} />
}

/** A little missile, nose down, drawn in a 40×100 box. */
function Missile({ w }: { w: number }) {
  return (
    <Svg viewBox="0 0 40 100" width={w} height={w * 2.5}>
      <Path d="M20 2 C10 10 12 22 20 30 C28 22 30 10 20 2 Z" fill="#FFB24D" opacity={0.9} />
      <Path d="M20 8 C15 13 16 20 20 25 C24 20 25 13 20 8 Z" fill="#FFE08A" />
      <Path d="M8 26 L20 36 L32 26 L32 34 L22 40 L18 40 L8 34 Z" fill="#5E6B80" />
      <Rect x={13} y={34} width={14} height={46} rx={7} fill="#E9EDF3" stroke="#9AA6B8" strokeWidth={2} />
      <Rect x={13} y={52} width={14} height={6} fill="#E8506A" />
      <Path d="M13 78 Q20 100 27 78 Z" fill="#5E6B80" />
    </Svg>
  )
}

/**
 * The newest shot, played once when it's fresh:
 *  - firing (enemy sea): a missile drops from above onto the square;
 *  - incoming (your sea): it comes in from off the corner, big and close,
 *    shrinking as it falls onto the square;
 * then water splashes (droplets + ripple) or the hit flashes. A shot older
 * than a few seconds (switching tabs, reopening) isn't replayed.
 */
function LastShotFx({ shot, cell, side, incoming, fresh }: { shot: Shot; cell: number; side: number; incoming?: boolean; fresh: boolean }) {
  const fly = useSharedValue(fresh ? 0 : 1)
  const imp = useSharedValue(fresh ? 0 : 1)
  useEffect(() => {
    if (!fresh) return
    fly.set(withTiming(1, { duration: 520, easing: Easing.in(Easing.quad) }))
    imp.set(withDelay(520, withTiming(1, { duration: shot.hit ? 700 : 950, easing: Easing.out(Easing.quad) })))
  }, [fresh, shot.hit, fly, imp])

  const tx = shot.c * cell + cell / 2
  const ty = shot.r * cell + cell / 2
  const sx = incoming ? side + cell * 1.5 : tx - cell * 1.2
  const sy = incoming ? -cell * 3 : -cell * 2.6
  const angle = (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI - 90
  const mw = cell * 0.42
  const missile = useAnimatedStyle(() => {
    const p = fly.value
    return {
      opacity: p >= 1 ? 0 : 1,
      transform: [
        { translateX: sx + (tx - sx) * p - mw / 2 },
        { translateY: sy + (ty - sy) * p - mw * 2.5 + mw * 0.4 },
        { rotate: `${angle}deg` },
        { scale: incoming ? 2.4 - 1.4 * p : 1 },
      ],
    }
  })
  const ring = useAnimatedStyle(() => ({ opacity: imp.value === 0 ? 0 : 1 - imp.value, transform: [{ scale: 0.4 + imp.value * 1.8 }] }))
  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.missile, missile]}>
        <Missile w={mw} />
      </Animated.View>
      <View pointerEvents="none" style={[styles.fx, { left: shot.c * cell, top: shot.r * cell, width: cell, height: cell }]}>
        <Animated.View
          style={[
            { width: cell, height: cell, borderRadius: cell, borderWidth: shot.hit ? 0 : 3, borderColor: '#fff' },
            shot.hit ? { backgroundColor: 'rgba(255,170,60,0.75)' } : null,
            ring,
          ]}
        />
        {!shot.hit ? [-1, -0.45, 0.45, 1].map((d) => <Droplet key={d} d={d} cell={cell} p={imp} />) : null}
      </View>
    </>
  )
}

function Droplet({ d, cell, p }: { d: number; cell: number; p: ReturnType<typeof useSharedValue<number>> }) {
  const style = useAnimatedStyle(() => {
    const v = p.value
    return {
      opacity: v === 0 ? 0 : 1 - v,
      transform: [{ translateX: d * cell * 0.55 * v }, { translateY: -cell * 0.9 * Math.sin(Math.PI * v) }],
    }
  })
  return <Animated.View style={[styles.drop, { width: cell * 0.16, height: cell * 0.16, borderRadius: cell }, style]} />
}

export function Board({
  size,
  cell,
  ships = [],
  sunk = [],
  shots,
  colors,
  aim,
  selected,
  preview,
  previewOk,
  onCell,
  dim,
  labels,
  incoming,
}: {
  size: number
  cell: number
  /** Ships to draw (your own fleet). */
  ships?: Ship[]
  /** Sunk ships (revealed on the enemy board). */
  sunk?: Ship[]
  shots: Shot[]
  colors: Gradient
  /** Enemy board: the cell being aimed at. */
  aim?: { r: number; c: number } | null
  /** Placing: index of the selected ship. */
  selected?: number
  /** Placing: cells a ship would cover if dropped where tapped. */
  preview?: [number, number][]
  previewOk?: boolean
  onCell?: (r: number, c: number) => void
  dim?: boolean
  /** Classic A–H across the top and 1–8 down the side (adds LABEL_GUTTER). */
  labels?: boolean
  /** Your own sea: incoming missiles fly in from off-screen. */
  incoming?: boolean
}) {
  const side = size * cell
  const shotAt = new Map(shots.map((s) => [`${s.r}:${s.c}`, s]))
  const last = shots.length ? shots.reduce((a, b) => (a.at > b.at ? a : b)) : null
  // A shot animates when it ARRIVES while this board is on screen — not by
  // comparing its time with this phone's clock (a Galaxy a few seconds off,
  // or a late update, got a plain mark with no missile). The one already
  // there when the board appeared isn't replayed.
  const [firstShot] = useState(() => last?.at ?? null)
  // Ships already sunk when the board appeared are just wrecks; one sunk
  // while we watch plays SinkFx first.
  const [sunkAtMount] = useState(() => new Set(sunk.map(shipKey)))
  const sunkKeys = new Set(sunk.map(shipKey))
  const freshSunk = sunk.filter((s) => !sunkAtMount.has(shipKey(s)))
  const wreckAfter = SINK_DELAY + SINK_MS * 0.55

  const sea = (
    <View style={[styles.board, { opacity: dim ? 0.55 : 1 }]}>
      {/* inner box = exactly side×side, so absolute cells line up with the grid */}
      <View style={{ width: side, height: side }}>
      <Svg width={side} height={side} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={SEA[0]} />
            <Stop offset="1" stopColor={SEA[1]} />
          </LinearGradient>
        </Defs>
        <Rect width={side} height={side} rx={14} fill="url(#sea)" />
        {Array.from({ length: size - 1 }, (_, i) => (
          <Path key={`v${i}`} d={`M${(i + 1) * cell} 4 V${side - 4}`} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        ))}
        {Array.from({ length: size - 1 }, (_, i) => (
          <Path key={`h${i}`} d={`M4 ${(i + 1) * cell} H${side - 4}`} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        ))}
      </Svg>

      {ships.map((s, i) =>
        sunkKeys.has(shipKey(s)) ? null : (
          <ShipArt key={`s${i}-${s.r}-${s.c}-${s.dir}`} ship={s} cell={cell} colors={colors} selected={i === selected} />
        ),
      )}
      {sunk.map((s) => (
        <ShipArt key={`k${shipKey(s)}`} ship={s} cell={cell} colors={colors} sunk appearAfter={sunkAtMount.has(shipKey(s)) ? undefined : wreckAfter} />
      ))}

      {/* placement preview */}
      {preview?.map(([r, c]) =>
        r >= 0 && c >= 0 && r < size && c < size ? (
          <View
            key={`p${r}:${c}`}
            pointerEvents="none"
            style={[styles.abs, { left: c * cell + 2, top: r * cell + 2, width: cell - 4, height: cell - 4, borderRadius: 8, backgroundColor: previewOk ? 'rgba(255,255,255,0.45)' : 'rgba(232,80,106,0.55)' }]}
          />
        ) : null,
      )}

      {/* the cells: tap targets + shot markers */}
      {Array.from({ length: size * size }, (_, i) => {
        const r = Math.floor(i / size)
        const c = i % size
        const shot = shotAt.get(`${r}:${c}`)
        const aimed = aim && aim.r === r && aim.c === c
        return (
          <Pressable
            key={i}
            accessibilityRole={onCell ? 'button' : undefined}
            accessibilityLabel={`${String.fromCharCode(65 + c)}${r + 1}`}
            disabled={!onCell}
            onPress={() => onCell?.(r, c)}
            style={[styles.abs, styles.cell, { left: c * cell, top: r * cell, width: cell, height: cell }]}
          >
            {shot ? shot.hit ? <HitMark size={cell * 0.86} /> : <MissMark size={cell} /> : null}
            {aimed ? <Crosshair cell={cell} /> : null}
          </Pressable>
        )
      })}

      {freshSunk.map((s) => (
        <SinkFx key={`x${shipKey(s)}`} ship={s} cell={cell} colors={colors} />
      ))}
      {last ? <LastShotFx key={last.at} shot={last} cell={cell} side={side} incoming={incoming} fresh={last.at !== firstShot} /> : null}
      </View>
    </View>
  )
  if (!labels) return sea
  return (
    <View>
      <View style={{ flexDirection: 'row', marginLeft: LABEL_GUTTER + 4, height: LABEL_GUTTER }}>
        {Array.from({ length: size }, (_, i) => (
          <Text key={i} style={[styles.label, { width: cell, color: dim ? '#9AA3B2' : '#5E7FA8' }]}>
            {String.fromCharCode(65 + i)}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: LABEL_GUTTER, marginTop: 4 }}>
          {Array.from({ length: size }, (_, i) => (
            <Text key={i} style={[styles.label, { height: cell, lineHeight: cell, color: dim ? '#9AA3B2' : '#5E7FA8' }]}>
              {i + 1}
            </Text>
          ))}
        </View>
        {sea}
      </View>
    </View>
  )
}

/** Room taken by the A–H / 1–8 labels on the top and left of a board. */
export const LABEL_GUTTER = 16

function Crosshair({ cell }: { cell: number }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.set(withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0, { duration: 600 })), -1))
  }, [p])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.9 + p.value * 0.12 }] }))
  return (
    <Animated.View pointerEvents="none" style={[{ width: cell * 0.9, height: cell * 0.9 }, style]}>
      <Svg viewBox="0 0 100 100" width={cell * 0.9} height={cell * 0.9}>
        <Circle cx={50} cy={50} r={36} stroke="#fff" strokeWidth={7} fill="rgba(232,80,106,0.35)" />
        <Path d="M50 4 V26 M50 74 V96 M4 50 H26 M74 50 H96" stroke="#fff" strokeWidth={7} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  )
}

/** Small ship silhouettes in a row — the fleet status (sunk ones crossed out). */
export function FleetStrip({ fleet, sunk, colors }: { fleet: number[]; sunk: number[]; colors: Gradient }) {
  const left = [...sunk]
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
      {fleet.map((len, i) => {
        const k = left.indexOf(len)
        const gone = k >= 0
        if (gone) left.splice(k, 1)
        return (
          <View key={i} style={{ width: len * 12 + 6, height: 14, opacity: gone ? 0.35 : 1 }}>
            <Svg viewBox={`0 0 ${len * 100} 100`} width={len * 12 + 6} height={14}>
              <Path d={hullPath(len, false)} fill={gone ? '#8A8F99' : colors[1]} />
              {gone ? <Path d={`M10 50 H${len * 100 - 10}`} stroke="#fff" strokeWidth={14} /> : null}
            </Svg>
          </View>
        )
      })}
    </View>
  )
}

export { SEA_DEEP }

const styles = StyleSheet.create({
  board: { padding: 4, borderRadius: 18, backgroundColor: SEA_DEEP },
  label: { textAlign: 'center', fontSize: 11, fontWeight: '700' },
  abs: { position: 'absolute' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  fx: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  missile: { position: 'absolute', left: 0, top: 0, zIndex: 5 },
  drop: { position: 'absolute', backgroundColor: '#fff' },
})
