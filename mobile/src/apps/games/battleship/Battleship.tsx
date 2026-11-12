// Live battleship, team vs team (migration 093). One fixed frame, never a
// scroll (owner, 2026-11):
//   placing — your team's sea and the ships to place. Tap a ship below, tap
//             the sea to drop it; tap a placed ship to pick it up, then
//             rotate/remove it or tap elsewhere to move it. "Shuffle" places
//             everything. Teammates see each change live (state.rev). When the
//             fleet is complete the team confirms; both teams → battle.
//   battle  — one sea at a time on a phone: the enemy's when your team fires,
//             yours while they fire (you can switch). Tap a square to aim,
//             "Fire!" to shoot — two steps so a slip of the finger doesn't
//             waste a shot. Hit → same player again; miss → the other team.
//             Tablets show both seas side by side.
// The other team's fleet never reaches this phone: the server answers shots.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  ZoomIn,
} from 'react-native-reanimated'
import { Anchor, Crosshair, RotateCw, Shuffle, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { games, GameRpcError, type BattleshipState, type GamePlayer, type GameSession, type Ship, type Team } from '@/lib/games'
import { fonts, sp, useTheme } from '@/theme/theme'
import { feedback, preloadSounds } from '../feedback'
import { ScoreBoard, TurnLine } from '../hangman/Hangman'
import { other, TEAM_GRADIENT, TEAM_SOFT, TEAM_SOLID } from '../look'
import { GameBtn } from '../shared'
import { useMembers } from '../members'
import { Avatar } from '@/apps/family/Avatar'
import { Board, FleetStrip, LABEL_GUTTER, ShipShape } from './Board'
import { cells, fits, nearestFit, randomFleet, remaining } from './fleet'

export function Battleship({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
  const st = session.state as unknown as BattleshipState
  const myTeam = (players.find((p) => p.email === me)?.team ?? 'A') as Team
  const gap = useBottomGap(sp.sm)
  const [area, setArea] = useState({ w: 0, h: 0 })

  return (
    <View style={[styles.fit, { paddingBottom: gap }]}>
      {/* Scores only matter once shots fly — not while hiding the fleet. */}
      {st.phase === 'battle' ? <ScoreBoard scores={st.scores ?? { A: 0, B: 0 }} myTeam={myTeam} compact /> : null}
      <View style={{ flex: 1 }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {area.h > 0 ? (
          st.phase === 'placing' ? (
            <Placing session={session} st={st} myTeam={myTeam} area={area} />
          ) : (
            <Battle session={session} st={st} myTeam={myTeam} me={me} area={area} />
          )
        ) : null}
      </View>
    </View>
  )
}

function useAct() {
  const { t } = useI18n()
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        return true
      } catch (e) {
        const code = e instanceof GameRpcError ? e.code : 'network'
        Alert.alert(t(`games.err.${code}` as never))
        return false
      }
    },
    [t],
  )
}

// ── placing ────────────────────────────────────────────────────────────────

type Drag = { from: number; len: number; dir: 'h' | 'v'; dx: number; dy: number }

/**
 * Hiding the fleet (owner, 2026-11): DRAG ships — from the tray onto the sea,
 * or around the sea; drop one off the sea to send it back to the tray. Tap a
 * ship to select it: two little round buttons appear at its end — rotate and
 * remove (no toolbar at the bottom). Tap a tray ship to drop it in the first
 * free spot. "Shuffle" places everything.
 *
 * Drag mechanics: gesture callbacks run on the JS thread (`runOnJS(true)`), a
 * "ghost" ship follows the finger (shared values → no re-render per frame),
 * and on release the ghost's top-left is snapped to the nearest cell of the
 * board measured in window coordinates.
 */
function Placing({ session, st, myTeam, area }: { session: GameSession; st: BattleshipState; myTeam: Team; area: { w: number; h: number } }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const act = useAct()
  const size = st.size ?? 8
  const fleet = st.fleet ?? [4, 3, 3, 2, 2]
  const [ships, setShips] = useState<Ship[]>([])
  const [selected, setSelected] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  // Gesture callbacks may come from an older render: they read these refs,
  // never the state above, so a drag always sees the current fleet.
  const dragRef = useRef<Drag | null>(null)
  const shipsRef = useRef<Ship[]>([])
  const [preview, setPreview] = useState<{ cells: [number, number][]; ok: boolean } | null>(null)
  const ready = !!st.ready?.[myTeam]
  const theirReady = !!st.ready?.[other(myTeam)]
  const left = remaining(fleet, ships)
  const complete = left.length === 0

  // Load my team's fleet, and again whenever a teammate moves a ship.
  const rev = st.rev?.[myTeam] ?? 0
  const lastSent = useRef(-1)
  useEffect(() => {
    if (rev === lastSent.current) return
    let on = true
    void games.battleship.myFleet(session.id).then((f) => {
      if (on) setShips(f ?? [])
    })
    return () => {
      on = false
    }
  }, [rev, session.id])

  useEffect(() => {
    shipsRef.current = ships
  }, [ships])

  function save(next: Ship[]) {
    shipsRef.current = next
    setShips(next)
    lastSent.current = rev + 1
    void act(() => games.battleship.setFleet(session.id, next))
  }

  // Board takes what's left after the tray + buttons (~200pt) — square,
  // with room for the A–H / 1–8 labels.
  const boardSide = Math.min(area.w, area.h - 200, 560)
  const cell = Math.floor((boardSide - 8 - LABEL_GUTTER) / size)
  const side = cell * size

  // Window positions, measured on layout and again when a drag starts.
  const rootRef = useRef<View>(null)
  const boardRef = useRef<View>(null)
  const pos = useRef({ root: { x: 0, y: 0 }, board: { x: 0, y: 0 } })
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => (pos.current.root = { x, y }))
    boardRef.current?.measureInWindow((x, y) => (pos.current.board = { x, y }))
  }, [])

  const gx = useSharedValue(0)
  const gy = useSharedValue(0)
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: gx.value }, { translateY: gy.value }] }))

  /** Where would the ghost land? (window coords of the finger) */
  function target(d: Drag, ax: number, ay: number) {
    const left0 = ax - d.dx - pos.current.board.x
    const top0 = ay - d.dy - pos.current.board.y
    const ship: Ship = { r: Math.round(top0 / cell), c: Math.round(left0 / cell), len: d.len, dir: d.dir }
    // finger over the sea at all?
    const fx = ax - pos.current.board.x
    const fy = ay - pos.current.board.y
    const overBoard = fx >= -cell / 2 && fy >= -cell / 2 && fx <= side + cell / 2 && fy <= side + cell / 2
    return { ship, overBoard, ok: overBoard && fits(shipsRef.current, ship, size, d.from >= 0 ? d.from : undefined) }
  }

  function startDrag(d: Drag, ax: number, ay: number) {
    if (ready) return
    measure()
    setSelected(undefined)
    dragRef.current = d
    setDrag(d)
    gx.set(ax - d.dx - pos.current.root.x)
    gy.set(ay - d.dy - pos.current.root.y)
    feedback('tap')
  }
  function moveDrag(ax: number, ay: number) {
    const d = dragRef.current
    if (!d) return
    gx.set(ax - d.dx - pos.current.root.x)
    gy.set(ay - d.dy - pos.current.root.y)
    const { ship, overBoard, ok } = target(d, ax, ay)
    const key = overBoard ? `${ship.r}:${ship.c}:${ok}` : 'off'
    if (key !== previewKey.current) {
      previewKey.current = key
      setPreview(overBoard ? { cells: cells(ship), ok } : null)
    }
  }
  const previewKey = useRef('')
  function endDrag(ax: number, ay: number) {
    const d = dragRef.current
    if (!d) return
    const { ship, overBoard, ok } = target(d, ax, ay)
    const ships = shipsRef.current
    dragRef.current = null
    setDrag(null)
    setPreview(null)
    previewKey.current = ''
    if (ok) {
      feedback('splash')
      save(d.from >= 0 ? ships.map((s, i) => (i === d.from ? ship : s)) : [...ships, ship])
    } else if (!overBoard && d.from >= 0) {
      // dropped off the sea → back to the tray
      feedback('tap')
      save(ships.filter((_, i) => i !== d.from))
    } else feedback('miss')
  }

  function autoPlace(len: number) {
    for (let r = 0; r < size; r++)
      for (let c2 = 0; c2 < size; c2++)
        for (const dir of ['h', 'v'] as const) {
          const s: Ship = { r, c: c2, len, dir }
          if (fits(ships, s, size)) {
            feedback('splash')
            save([...ships, s])
            return
          }
        }
    feedback('miss')
  }

  function rotate(i: number) {
    const s = ships[i]
    // Turn in place if it fits; otherwise turn AND slide to the nearest free
    // spot (owner, 2026-11: a ship next to another wouldn't rotate at all).
    const turned = nearestFit(ships, { ...s, dir: s.dir === 'h' ? 'v' : 'h' }, size, i)
    if (turned) {
      feedback('tap')
      save(ships.map((x, k) => (k === i ? turned : x)))
    } else feedback('miss')
  }

  function remove(i: number) {
    feedback('tap')
    save(ships.filter((_, k) => k !== i))
    setSelected(undefined)
  }

  const shown = drag && drag.from >= 0 ? ships.filter((_, i) => i !== drag.from) : ships
  const sel = selected !== undefined ? ships[selected] : undefined

  return (
    <View ref={rootRef} onLayout={measure} style={{ flex: 1, gap: sp.md, alignItems: 'center' }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20, textAlign: 'center' }}>
        {ready ? t('games.bs.fleetSet') : t('games.bs.placeTitle')}
      </Txt>

      <View>
        <Board
          size={size}
          cell={cell}
          ships={shown}
          shots={[]}
          colors={TEAM_GRADIENT[myTeam]}
          selected={drag ? undefined : selected}
          preview={preview?.cells}
          previewOk={preview?.ok}
          dim={ready}
          onCell={ready ? undefined : () => setSelected(undefined)}
          labels
        />
        {/* grab handles over each placed ship + the selected ship's controls */}
        <View ref={boardRef} onLayout={measure} pointerEvents="box-none" style={[styles.overlay, { width: side, height: side }]}>
          {!ready
            ? ships.map((s, i) => (
                // Stays mounted while its ship is dragged — unmounting the
                // detector mid-gesture would cancel the drag.
                <DragHandle
                  key={`${i}-${s.r}-${s.c}-${s.dir}`}
                  style={{ left: s.c * cell, top: s.r * cell, width: (s.dir === 'v' ? 1 : s.len) * cell, height: (s.dir === 'v' ? s.len : 1) * cell }}
                  onTap={() => {
                    feedback('tap')
                    setSelected(selected === i ? undefined : i)
                  }}
                  onStart={(ax, ay, x, y) => startDrag({ from: i, len: s.len, dir: s.dir, dx: x, dy: y }, ax, ay)}
                  onMove={moveDrag}
                  onEnd={endDrag}
                />
              ))
            : null}
          {sel && !drag && !ready ? (
            <ShipControls
              ship={sel}
              cell={cell}
              side={side}
              tint={TEAM_SOLID[myTeam]}
              onRotate={() => rotate(selected!)}
              onRemove={() => remove(selected!)}
            />
          ) : null}
        </View>
      </View>

      {ready ? (
        <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center', gap: sp.sm, alignSelf: 'stretch' }}>
          <View style={[styles.statusPill, { backgroundColor: TEAM_SOFT[other(myTeam)] }]}>
            <Txt style={{ color: TEAM_SOLID[other(myTeam)], fontFamily: fonts.semibold }}>
              {theirReady ? t('games.bs.theyReady', { team: t(`games.team.${other(myTeam)}`) }) : t('games.bs.theyPlacing', { team: t(`games.team.${other(myTeam)}`) })}
            </Txt>
          </View>
          <GameBtn title={t('games.bs.changeFleet')} variant="secondary" onPress={() => act(() => games.battleship.ready(session.id, false))} style={{ alignSelf: 'stretch' }} />
        </Animated.View>
      ) : (
        <View style={{ alignSelf: 'stretch', gap: sp.sm }}>
          {/* the ships still to place — drag one to the sea, or tap it */}
          <View style={styles.tray}>
            {left.length ? (
              left.map((len, i) => (
                <DragHandle
                  key={`${len}-${i}`}
                  style={[styles.trayShip, { borderColor: c.border, backgroundColor: c.card }]}
                  onTap={() => autoPlace(len)}
                  onStart={(ax, ay) => startDrag({ from: -1, len, dir: 'h', dx: (len * cell) / 2, dy: cell / 2 }, ax, ay)}
                  onMove={moveDrag}
                  onEnd={endDrag}
                >
                  <FleetStrip fleet={[len]} sunk={[]} colors={TEAM_GRADIENT[myTeam]} />
                </DragHandle>
              ))
            ) : (
              <Txt variant="muted" style={{ fontSize: 13.5 }}>
                {t('games.bs.allPlaced')}
              </Txt>
            )}
          </View>
          <Txt variant="muted" style={{ textAlign: 'center', fontSize: 13 }}>
            {left.length ? t('games.bs.hintDrag') : t('games.bs.hintDone')}
          </Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <View style={{ flex: 1 }}>
              <GameBtn
                variant="secondary"
                title={t('games.bs.shuffle')}
                icon={<Shuffle size={18} color={c.text} />}
                onPress={() => {
                  feedback('splash')
                  setSelected(undefined)
                  save(randomFleet(fleet, size))
                }}
              />
            </View>
            <View style={{ flex: 1.4 }}>
              <GameBtn
                title={t('games.bs.fleetReady')}
                colors={TEAM_GRADIENT[myTeam]}
                icon={<Anchor size={18} color="#fff" />}
                disabled={!complete || busy}
                loading={busy}
                onPress={async () => {
                  setBusy(true)
                  feedback('ready')
                  setSelected(undefined)
                  await act(() => games.battleship.ready(session.id, true))
                  setBusy(false)
                }}
              />
            </View>
          </View>
        </View>
      )}

      {/* the ship following your finger */}
      {drag ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]}>
          <ShipShape len={drag.len} dir={drag.dir} cell={cell} colors={TEAM_GRADIENT[myTeam]} selected />
        </Animated.View>
      ) : null}
    </View>
  )
}

/** A press target for a ship: tap → onTap, drag → onStart/onMove/onEnd with
 *  window coordinates (gesture callbacks on the JS thread). */
function DragHandle({
  style,
  children,
  onTap,
  onStart,
  onMove,
  onEnd,
}: {
  style: StyleProp<ViewStyle>
  children?: React.ReactNode
  onTap: () => void
  onStart: (ax: number, ay: number, x: number, y: number) => void
  onMove: (ax: number, ay: number) => void
  onEnd: (ax: number, ay: number) => void
}) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onStart((e) => onStart(e.absoluteX, e.absoluteY, e.x, e.y))
    .onUpdate((e) => onMove(e.absoluteX, e.absoluteY))
    .onEnd((e) => onEnd(e.absoluteX, e.absoluteY))
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, ok) => {
      if (ok) onTap()
    })
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View style={[{ position: children ? 'relative' : 'absolute' }, style]}>{children}</View>
    </GestureDetector>
  )
}

/** Two little round buttons at the selected ship's end: rotate and remove. */
function ShipControls({
  ship,
  cell,
  side,
  tint,
  onRotate,
  onRemove,
}: {
  ship: Ship
  cell: number
  side: number
  tint: string
  onRotate: () => void
  onRemove: () => void
}) {
  const B = 32
  const endX = (ship.c + (ship.dir === 'h' ? ship.len : 1)) * cell
  const topY = ship.r * cell
  // Sit just past the ship's far corner, pulled back inside the sea at edges.
  const left = Math.min(Math.max(endX - B * 2 - 4, 0), side - B * 2 - 6)
  const top = topY - B - 6 < 0 ? (ship.r + (ship.dir === 'v' ? ship.len : 1)) * cell + 6 : topY - B - 6
  return (
    <Animated.View entering={ZoomIn.duration(160)} style={[styles.ctrls, { left, top: Math.min(top, side - B) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="rotate" onPress={onRotate} hitSlop={6} style={[styles.ctrl, { backgroundColor: tint }]}>
        <RotateCw size={16} color="#fff" strokeWidth={2.6} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="remove" onPress={onRemove} hitSlop={6} style={[styles.ctrl, { backgroundColor: '#fff' }]}>
        <X size={16} color="#E8506A" strokeWidth={2.8} />
      </Pressable>
    </Animated.View>
  )
}

// ── battle ─────────────────────────────────────────────────────────────────

/** When the missile reaches the water on screen (Board's LastShotFx flies for
 *  520 ms). The impact sound starts a touch earlier to cover the speaker's
 *  output latency, so what you hear lands WITH what you see. */
const IMPACT_MS = 470
/** After a miss, let the splash play out before the turn changes hands. */
const HANDOVER_MS = 1500
/** How long the "Team X's turn" card stays up. */
const BANNER_MS = 1500

function Battle({ session, st, myTeam, me, area }: { session: GameSession; st: BattleshipState; myTeam: Team; me: string; area: { w: number; h: number } }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width } = useWindowDimensions()
  const { name, avatar } = useMembers()
  const act = useAct()
  const wide = width >= 760
  const enemy = other(myTeam)
  const [ownFleet, setOwnFleet] = useState<Ship[]>([])
  const [aim, setAim] = useState<{ r: number; c: number } | null>(null)
  const [busy, setBusy] = useState(false)

  // The turn as SHOWN lags the real one by a beat: when a miss hands the turn
  // over, the missile lands and splashes first, then a "Team X's turn" card
  // comes up and the sea slides over — instead of the screen flashing to the
  // other board mid-shot (owner, 2026-11).
  const [shown, setShown] = useState({ team: st.turn_team, shooter: st.shooter })
  const [view, setView] = useState<'enemy' | 'mine'>(st.turn_team === myTeam ? 'enemy' : 'mine')
  const [banner, setBanner] = useState<{ team: Team; shooter: string | null } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (st.turn_team === shown.team && st.shooter === shown.shooter) return
    const sameTeam = st.turn_team === shown.team
    const next = { team: st.turn_team, shooter: st.shooter }
    const delay = sameTeam ? 0 : HANDOVER_MS
    timers.current.push(
      setTimeout(() => {
        setShown(next)
        setAim(null)
        if (!sameTeam && next.team) {
          setBanner({ team: next.team, shooter: next.shooter })
          setView(next.team === myTeam ? 'enemy' : 'mine')
          feedback(next.shooter === me ? 'turn' : 'pop')
          timers.current.push(setTimeout(() => setBanner(null), BANNER_MS))
        }
      }, delay),
    )
  }, [st.turn_team, st.shooter, shown.team, shown.shooter, myTeam, me])
  const myTurn = shown.shooter === me && st.shooter === me && !banner

  useEffect(() => {
    let on = true
    void games.battleship.myFleet(session.id).then((f) => on && setOwnFleet(f ?? []))
    return () => {
      on = false
    }
  }, [session.id])

  useEffect(() => preloadSounds(['whoosh', 'splash', 'boom', 'sink', 'turn', 'pop', 'tap']), [])

  // Every phone reacts to every shot: a whoosh as it flies, the impact sound
  // when it lands.
  const seen = useRef(st.last?.at)
  useEffect(() => {
    const last = st.last
    if (!last || last.at === seen.current) return
    seen.current = last.at
    feedback('whoosh')
    timers.current.push(setTimeout(() => feedback(last.sunk ? 'sink' : last.hit ? 'boom' : 'splash'), IMPACT_MS))
  }, [st.last])

  async function fire() {
    if (!aim || busy) return
    setBusy(true)
    const target = aim
    setAim(null)
    await act(() => games.battleship.fire(session.id, target.r, target.c))
    setBusy(false)
  }

  const size = st.size ?? 8
  const fleet = st.fleet ?? [4, 3, 3, 2, 2]
  const reserve = 200 // turn line + last shot + tabs + fire button
  const side = wide ? Math.min((area.w - sp.xl) / 2, area.h - reserve, 520) : Math.min(area.w, area.h - reserve - 20, 560)
  const cell = Math.floor((side - 8 - LABEL_GUTTER) / size)
  const shotsOnEnemy = st.shots?.[enemy] ?? []
  const shotsOnMe = st.shots?.[myTeam] ?? []
  const shot = (r: number, c2: number) => shotsOnEnemy.some((s) => s.r === r && s.c === c2)

  const enemyBoard = (
    <View style={{ alignItems: 'center', gap: 6 }}>
      {wide ? <SeaLabel text={t('games.bs.enemySea', { team: t(`games.team.${enemy}`) })} team={enemy} /> : null}
      <Board
        labels
        size={size}
        cell={cell}
        sunk={st.sunk?.[enemy] ?? []}
        shots={shotsOnEnemy}
        colors={TEAM_GRADIENT[enemy]}
        aim={aim}
        onCell={
          myTurn
            ? (r, c2) => {
                if (shot(r, c2)) return
                feedback('tap')
                setAim({ r, c: c2 })
              }
            : undefined
        }
      />
      <FleetStrip fleet={fleet} sunk={(st.sunk?.[enemy] ?? []).map((s) => s.len)} colors={TEAM_GRADIENT[enemy]} />
    </View>
  )
  const myBoard = (
    <View style={{ alignItems: 'center', gap: 6 }}>
      {wide ? <SeaLabel text={t('games.bs.mySea')} team={myTeam} /> : null}
      <Board labels incoming size={size} cell={cell} ships={ownFleet} sunk={st.sunk?.[myTeam] ?? []} shots={shotsOnMe} colors={TEAM_GRADIENT[myTeam]} />
      <FleetStrip fleet={fleet} sunk={(st.sunk?.[myTeam] ?? []).map((s) => s.len)} colors={TEAM_GRADIENT[myTeam]} />
    </View>
  )

  const last = st.last
  const lastLine = last
    ? last.sunk
      ? t('games.bs.sunk', { name: name(last.by), len: last.len ?? 0 })
      : last.hit
        ? t('games.bs.hitAgain', { name: name(last.by) })
        : t('games.bs.water', { name: name(last.by) })
    : t('games.bs.firstShot', { team: t(`games.team.${st.turn_team ?? 'A'}`) })
  const turnTeam = (shown.team ?? 'A') as Team

  return (
    <View style={{ flex: 1, gap: sp.sm }}>
      {/* what's happening — at the top, where the eye goes first */}
      <TurnLine
        compact
        email={shown.shooter ?? ''}
        avatarPath={avatar(shown.shooter ?? '')}
        team={turnTeam}
        text={shown.shooter === me ? t('games.bs.yourShot') : t('games.bs.theirShot', { name: name(shown.shooter) })}
      />
      <Animated.View key={last?.at ?? 'start'} entering={FadeInDown.delay(last ? IMPACT_MS : 0).duration(220)} style={[styles.lastLine, { backgroundColor: last?.hit ? TEAM_SOFT[last.team] : c.surface }]}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: last?.hit ? TEAM_SOLID[last.team] : c.text, textAlign: 'center' }}>{lastLine}</Txt>
      </Animated.View>

      {!wide ? (
        <View style={[styles.seg, { backgroundColor: c.surface }]}>
          {(['enemy', 'mine'] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
              onPress={() => setView(v)}
              style={[styles.segBtn, view === v ? { backgroundColor: c.card } : null]}
            >
              {v === 'enemy' ? <Crosshair size={15} color={TEAM_SOLID[enemy]} /> : <Anchor size={15} color={TEAM_SOLID[myTeam]} />}
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: view === v ? c.text : c.textMuted }}>
                {v === 'enemy' ? t('games.bs.enemyTab') : t('games.bs.mineTab')}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {wide ? (
          <View style={{ flexDirection: 'row', gap: sp.xl }}>
            {enemyBoard}
            {myBoard}
          </View>
        ) : view === 'enemy' ? (
          <Animated.View key="e" entering={SlideInLeft.duration(380)} exiting={SlideOutRight.duration(300)}>
            {enemyBoard}
          </Animated.View>
        ) : (
          <Animated.View key="m" entering={SlideInRight.duration(380)} exiting={SlideOutLeft.duration(300)}>
            {myBoard}
          </Animated.View>
        )}
        {banner ? <TurnBanner team={banner.team} shooter={banner.shooter} me={me} myTeam={myTeam} /> : null}
      </View>

      {myTurn ? (
        <Animated.View entering={FadeInDown.duration(220)}>
          <Pressable accessibilityRole="button" disabled={!aim || busy} onPress={fire} style={({ pressed }) => ({ opacity: !aim ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <GradientBox colors={TEAM_GRADIENT[myTeam]} radius={20} style={styles.fire}>
              <Crosshair size={20} color="#fff" />
              <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 19 }}>
                {aim ? t('games.bs.fireAt', { cell: `${String.fromCharCode(65 + aim.c)}${aim.r + 1}` }) : t('games.bs.pickTarget')}
              </Txt>
            </GradientBox>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  )
}

/** "Team Purple's turn · Patricia fires" — a card that pops over the sea when
 *  the turn changes hands, in that team's colours. */
function TurnBanner({ team, shooter, me, myTeam }: { team: Team; shooter: string | null; me: string; myTeam: Team }) {
  const { t } = useI18n()
  const { name, avatar } = useMembers()
  return (
    <Animated.View entering={ZoomIn.duration(260)} exiting={FadeOut.duration(220)} pointerEvents="none" style={styles.bannerWrap}>
      <GradientBox colors={TEAM_GRADIENT[team]} radius={26} style={styles.banner}>
        <Avatar name={name(shooter)} avatarPath={avatar(shooter ?? '')} size={56} />
        <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 26, textAlign: 'center' }}>
          {team === myTeam ? t('games.bs.ourTurn') : t('games.bs.theirTurn', { team: t(`games.team.${team}`) })}
        </Txt>
        <Txt style={{ color: 'rgba(255,255,255,0.9)', fontSize: 15, textAlign: 'center' }}>
          {shooter === me ? t('games.bs.youFire') : t('games.bs.nameFires', { name: name(shooter) })}
        </Txt>
      </GradientBox>
    </Animated.View>
  )
}

function SeaLabel({ text, team }: { text: string; team: Team }) {
  return (
    <Animated.View entering={ZoomIn.duration(200)} style={[styles.statusPill, { backgroundColor: TEAM_SOFT[team] }]}>
      <Txt style={{ color: TEAM_SOLID[team], fontFamily: fonts.semibold, fontSize: 13 }}>{text}</Txt>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fit: { flex: 1, paddingHorizontal: sp.lg, gap: 10 },
  tray: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, justifyContent: 'center', minHeight: 40, alignItems: 'center' },
  trayShip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1.5 },
  overlay: { position: 'absolute', left: 4 + LABEL_GUTTER, top: 4 + LABEL_GUTTER },
  ghost: { position: 'absolute', left: 0, top: 0, opacity: 0.92 },
  ctrls: { position: 'absolute', flexDirection: 'row', gap: 6 },
  ctrl: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  tool: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 14 },
  statusPill: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  seg: { flexDirection: 'row', borderRadius: 14, padding: 3 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 11 },
  lastLine: { borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
  bannerWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  banner: { alignItems: 'center', gap: 6, paddingVertical: sp.xl, paddingHorizontal: sp.xl, minWidth: 240 },
  fire: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15 },
})
