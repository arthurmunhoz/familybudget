// Bingo (migration 121): no teams, a card each. The server draws a ball every
// few seconds; every phone plays the same little show for it — the globe
// whirls, a ball drops out and rolls up to the front, and only then turns its
// number to the room. Nobody's card is marked for them (owner, 2026-11-22:
// "the point is that they're watching for their numbers"): you tap what you
// have, and you press BINGO yourself. The first valid call the server gets wins.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native'
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { Pause, Play } from 'lucide-react-native'

import { Avatar } from '@/apps/family/Avatar'
import { GradientBox } from '@/components/home/GradientBox'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { GameRpcError, games, type BingoState, type GamePlayer, type GameSession } from '@/lib/games'
import { fonts, sp, useTheme } from '@/theme/theme'
import { Confetti } from '../art/Confetti'
import { feedback, haptic, preloadSounds, stopSound } from '../feedback'
import { COVER } from '../look'
import { useMembers } from '../members'
import { Ball } from './Ball'
import { Card } from './Card'
import { Globe } from './Globe'
import { canCall, leftNow } from './logic'
import { GOLD } from './look'

// The cage turns long enough to hear it (the recording runs ~6 s; it fades
// out when the ball comes out). The drop recording starts right on the
// ball's knock, so it plays as the ball leaves the chute.
const SPIN_MS = 2600
const ROLL_MS = 800
const STAGE_H = 188
const GLOBE = 130
const SLOT = 92

/** This phone's offset from the server clock: `state.now` first, then the
 *  best of three round trips (same as the quiz). */
function useServerOffset(serverNow: string | undefined) {
  const offset = useRef(0)
  const measured = useRef(false)
  useEffect(() => {
    if (serverNow && !measured.current) offset.current = Date.parse(serverNow) - Date.now()
  }, [serverNow])
  useEffect(() => {
    let alive = true
    void (async () => {
      let best = Infinity
      for (let i = 0; i < 3 && alive; i++) {
        try {
          const t0 = Date.now()
          const iso = await games.serverNow()
          const t1 = Date.now()
          if (t1 - t0 < best) {
            best = t1 - t0
            offset.current = Date.parse(iso) - (t0 + t1) / 2
            measured.current = true
          }
        } catch {
          /* keep the state-based guess */
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return offset
}

function useCountdown(at: string | undefined, offset: React.RefObject<number>) {
  const calc = useCallback(() => (at ? Math.max(0, (Date.parse(at) - (Date.now() + offset.current)) / 1000) : 0), [at, offset])
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 200)
    return () => clearInterval(id)
  }, [calc])
  return { left, now: calc }
}

export function Bingo({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width } = useWindowDimensions()
  const { name, avatar } = useMembers()
  const gap = useBottomGap(sp.md)
  const reduce = useReducedMotion()
  const st = session.state as unknown as BingoState
  const drawn = useMemo(() => st.drawn ?? [], [st.drawn])
  const card = useMemo(() => st.cards?.[me] ?? [], [st.cards, me])
  const host = session.host_email === me
  const wide = width >= 760

  useEffect(() => preloadSounds(['rattle', 'drop', 'call', 'dab', 'tap', 'correct', 'wrong', 'tick']), [])

  // ── the clock: ask for the next ball when its time comes ──────────────────
  const offset = useServerOffset(st.now)
  const { left, now: leftNowSec } = useCountdown(st.next_at, offset)
  const ticked = useRef('')
  useEffect(() => {
    if (st.paused || left > 0 || !st.next_at || ticked.current === st.next_at || leftNowSec() > 0) return
    ticked.current = st.next_at
    const id = setTimeout(() => void games.bingo.tick(session.id).catch(() => undefined), 250)
    return () => clearTimeout(id)
  }, [left, st.next_at, st.paused, session.id, leftNowSec])

  // ── the show for each new ball ────────────────────────────────────────────
  // `shown` = balls whose number this screen has turned to the player. A ball
  // that arrived but is still in the globe can't be marked yet.
  const [shown, setShown] = useState(drawn.length)
  const [phase, setPhase] = useState<'idle' | 'spin' | 'roll'>('idle')
  const roll = useSharedValue(1)
  const pop = useSharedValue(1)
  useEffect(() => {
    if (drawn.length <= shown) return
    // Came back after missing some: only the newest gets the show.
    if (drawn.length - shown > 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- catching up with the server
      setShown(drawn.length - 1)
      return
    }
    const reveal = () => {
      setPhase('idle')
      setShown(drawn.length)
      feedback('call')
      pop.set(withSequence(withTiming(1.16, { duration: 120 }), withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) })))
    }
    if (reduce) {
      reveal()
      return
    }
    setPhase('spin')
    feedback('rattle')
    const a = setTimeout(() => {
      setPhase('roll')
      feedback('drop')
      stopSound('rattle', 450)
      roll.set(0)
      roll.set(withTiming(1, { duration: ROLL_MS, easing: Easing.bezier(0.3, 0, 0.2, 1) }))
    }, SPIN_MS)
    const b = setTimeout(reveal, SPIN_MS + ROLL_MS)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
      stopSound('rattle', 150)
    }
  }, [drawn.length, shown, reduce, roll, pop])

  const revealed = useMemo(() => new Set(drawn.slice(0, shown)), [drawn, shown])
  const incoming = phase !== 'idle' && drawn.length > shown ? drawn[shown] : null
  const current = incoming ?? (shown > 0 ? drawn[shown - 1] : null)
  const history = useMemo(() => drawn.slice(0, incoming != null ? shown : Math.max(0, shown - 1)).reverse().slice(0, 5), [drawn, shown, incoming])

  // The ball rolls from the chute under the globe up to its place.
  const [stageW, setStageW] = useState(0)
  const slotX = stageW - 18 - SLOT
  const slotY = 34
  const fromX = 16 + GLOBE / 2 - SLOT / 2
  const fromY = STAGE_H - SLOT / 2 - 26
  const rollStyle = useAnimatedStyle(() => {
    const p = roll.value
    return {
      opacity: p <= 0.02 ? 0 : 1,
      transform: [
        { translateX: (fromX - slotX) * (1 - p) },
        { translateY: (fromY - slotY) * (1 - p) - Math.sin(p * Math.PI) * 22 },
        { scale: (0.26 + 0.74 * p) * pop.value },
        { rotate: `${(1 - p) * -540}deg` },
      ],
    }
  })

  // ── my marks: mine to make, shown at once, confirmed by the server ────────
  const [local, setLocal] = useState<number[]>([])
  const pending = useRef<Promise<unknown>[]>([])
  const marks = useMemo(() => new Set([...(st.marks?.[me] ?? []), ...local]), [st.marks, me, local])
  const [shake, setShake] = useState<{ n: number; k: number }>()
  const [hint, setHint] = useState('')
  useEffect(() => {
    if (!hint) return
    const id = setTimeout(() => setHint(''), 1800)
    return () => clearTimeout(id)
  }, [hint])
  function onCell(n: number) {
    if (!n || marks.has(n)) return
    if (!revealed.has(n)) {
      haptic('error')
      setShake((s) => ({ n, k: (s?.k ?? 0) + 1 }))
      setHint(t('games.err.not_drawn'))
      return
    }
    feedback('dab')
    setLocal((l) => [...l, n])
    const p = games.bingo.mark(session.id, n).catch(() => {
      setLocal((l) => l.filter((x) => x !== n))
      setHint(t('games.err.network'))
    })
    pending.current.push(p)
    void p.finally(() => {
      pending.current = pending.current.filter((x) => x !== p)
    })
  }

  // ── what I can call ───────────────────────────────────────────────────────
  const lineTaken = !!st.line
  const can = canCall(card, [...marks], st.goal, lineTaken)
  const leftMine = leftNow(card, [...marks], st.goal, lineTaken)
  const [calling, setCalling] = useState(false)
  async function call() {
    if (calling || !can) return
    setCalling(true)
    feedback('tap')
    try {
      await Promise.all(pending.current)
      await games.bingo.call(session.id)
    } catch (e) {
      const code = e instanceof GameRpcError ? e.code : 'network'
      feedback('wrong')
      Alert.alert(t(`games.err.${code}` as never))
    } finally {
      setCalling(false)
    }
  }
  const pulse = useSharedValue(1)
  useEffect(() => {
    if (can && !reduce) pulse.set(withRepeat(withSequence(withTiming(1.04, { duration: 520 }), withTiming(1, { duration: 520 })), -1))
    else pulse.set(withTiming(1, { duration: 150 }))
  }, [can, reduce, pulse])
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }))

  // ── someone called the first line (playing for the whole card) ───────────
  const [firstLine] = useState(st.line?.at)
  const [lineFlash, setLineFlash] = useState(0)
  const lineAt = st.line?.at
  useEffect(() => {
    if (!lineAt || lineAt === firstLine) return
    feedback('correct')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a server event, shown once
    setLineFlash((k) => k + 1)
  }, [lineAt, firstLine])

  // ── the others, and how close they are ───────────────────────────────────
  const others = (st.order ?? []).filter((e) => e !== me && players.some((p) => p.email === e && !p.left_at))

  // ── sizes: the card takes whatever height is left ─────────────────────────
  const [area, setArea] = useState({ w: 0, h: 0 })
  const GAP = 6
  const cell = area.w ? Math.max(34, Math.min(92, Math.floor(Math.min((area.w - GAP * 4) / 5, (area.h - GAP * 5) / 5.5)))) : 0
  const onArea = (e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })

  const lastBall = drawn.length >= 75
  const status = st.paused
    ? host
      ? t('games.bingo.paused')
      : t('games.bingo.pausedBy', { name: name(session.host_email) })
    : lastBall
      ? t('games.bingo.lastBall')
      : phase !== 'idle'
        ? t('games.bingo.spinning')
        : drawn.length === 0
          ? t('games.bingo.first')
          : t('games.bingo.nextIn', { n: Math.ceil(left) })
  const progress = st.paused || phase !== 'idle' || !st.pace ? 0 : Math.max(0, Math.min(1, 1 - left / st.pace))

  const stage = (
    <View style={{ gap: sp.sm }}>
      <GradientBox colors={COVER.bingo} radius={28} style={{ height: STAGE_H, overflow: 'hidden' }}>
        <View style={StyleSheet.absoluteFill} onLayout={(e) => setStageW(e.nativeEvent.layout.width)}>
          <View pointerEvents="none" style={styles.blob} />
          <View style={{ position: 'absolute', left: 16, top: (STAGE_H - GLOBE * 1.26) / 2 }}>
            <Globe size={GLOBE} spinning={phase === 'spin'} />
          </View>
          <View style={{ position: 'absolute', left: 16 + GLOBE + 12, right: 18 + SLOT + 8, top: 16 }}>
            <Txt style={styles.kicker}>{t('games.bingo.ballOf', { n: shown })}</Txt>
            <Txt style={styles.statusTxt} numberOfLines={2}>
              {status}
            </Txt>
          </View>
          {/* the last few balls, newest first */}
          <View style={{ position: 'absolute', left: 16 + GLOBE + 12, right: 12, bottom: 14, flexDirection: 'row', gap: 6 }}>
            {history.map((n) => (
              <Animated.View key={n} entering={FadeIn.duration(260)} layout={LinearTransition.duration(260)}>
                <Ball n={n} size={30} />
              </Animated.View>
            ))}
          </View>
          {current != null && stageW ? (
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: slotX, top: slotY }, phase === 'spin' ? { opacity: 0 } : rollStyle]}>
              <Ball n={current} size={SLOT} blank={incoming != null} />
            </Animated.View>
          ) : null}
        </View>
      </GradientBox>
      <View style={[styles.track, { backgroundColor: c.border }]}>
        <View style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 2, backgroundColor: COVER.bingo[1] }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, minHeight: 34 }}>
        <View style={[styles.goal, { backgroundColor: c.card, borderColor: c.border }]}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 13 }} numberOfLines={1}>
            {st.goal === 'line' ? t('games.bingo.goalLine') : lineTaken ? t('games.bingo.goalFullNow') : t('games.bingo.goalFull')}
          </Txt>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
          {others.slice(0, 5).map((e) => {
            const n = leftNow(st.cards?.[e] ?? [], st.marks?.[e] ?? [], st.goal, lineTaken)
            const hot = n <= 1
            return (
              <View key={e} style={[styles.other, { backgroundColor: hot ? GOLD[0] : c.card, borderColor: hot ? GOLD[1] : c.border }]}>
                <Avatar name={name(e)} avatarPath={avatar(e)} size={24} />
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: hot ? '#3A2600' : c.text }}>{n}</Txt>
              </View>
            )
          })}
        </View>
      </View>
    </View>
  )

  const dock = (
    <View style={{ gap: 6 }}>
      <Txt variant="muted" style={{ textAlign: 'center', fontSize: 13.5, minHeight: 19 }}>
        {hint || (can ? t('games.bingo.pressNow') : leftMine === 1 ? t('games.bingo.leftOne') : t('games.bingo.left', { n: leftMine }))}
      </Txt>
      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
        {host ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={st.paused ? t('games.bingo.resume') : t('games.bingo.pause')}
            onPress={() => {
              feedback('tap')
              void games.bingo.pause(session.id, !st.paused).catch(() => undefined)
            }}
            style={({ pressed }) => [styles.pause, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            {st.paused ? <Play size={22} color={c.text} fill={c.text} /> : <Pause size={22} color={c.text} fill={c.text} />}
          </Pressable>
        ) : null}
        <Animated.View style={[{ flex: 1 }, pulseStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('games.bingo.call')}
            disabled={!can || calling}
            onPress={() => void call()}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
          >
            {can ? (
              <GradientBox colors={GOLD} radius={26} style={styles.callBtn}>
                <Txt style={[styles.callTxt, { color: '#3A2600' }]}>{can === 'line' && st.goal === 'full' ? t('games.bingo.callLine') : t('games.bingo.call')}</Txt>
              </GradientBox>
            ) : (
              <View style={[styles.callBtn, { borderRadius: 26, backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
                <Txt style={[styles.callTxt, { color: c.textFaint }]}>{t('games.bingo.call')}</Txt>
              </View>
            )}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  )

  const cardView = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={onArea}>
      {cell && card.length ? (
        <Animated.View entering={FadeInDown.duration(260)}>
          <Card card={card} marks={marks} cell={cell} gap={GAP} win={st.line?.by === me ? st.line.cells : undefined} shake={shake} onCell={onCell} />
        </Animated.View>
      ) : !card.length ? (
        <Txt variant="muted" style={{ textAlign: 'center' }}>
          {t('games.bingo.watching')}
        </Txt>
      ) : null}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: sp.xl, paddingHorizontal: sp.lg, paddingBottom: gap }}>
          <View style={{ width: 400, gap: sp.lg, justifyContent: 'center' }}>
            {stage}
            {dock}
          </View>
          {cardView}
        </View>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: sp.lg, paddingBottom: gap, gap: sp.sm }}>
          {stage}
          {cardView}
          {dock}
        </View>
      )}
      {lineFlash && st.line ? (
        <Animated.View key={lineFlash} entering={FadeInDown.duration(240)} exiting={FadeOut.duration(300)} pointerEvents="none" style={styles.flashWrap}>
          <LineFlash text={st.line.by === me ? t('games.bingo.lineYou') : t('games.bingo.lineBy', { name: name(st.line.by) })} />
        </Animated.View>
      ) : null}
      <Confetti fire={lineFlash} />
    </View>
  )
}

/** "Ana called the line!" — up for a few seconds, then gone. */
function LineFlash({ text }: { text: string }) {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setOn(false), 3800)
    return () => clearTimeout(id)
  }, [])
  if (!on) return null
  return (
    <GradientBox colors={GOLD} radius={20} style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
      <Txt style={{ color: '#3A2600', fontFamily: fonts.display, fontSize: 18, textAlign: 'center' }}>{text}</Txt>
    </GradientBox>
  )
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: 'rgba(255,255,255,0.12)' },
  kicker: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  statusTxt: { color: '#fff', fontFamily: fonts.display, fontSize: 19, lineHeight: 23, marginTop: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  goal: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  other: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 3, paddingRight: 9, paddingVertical: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  pause: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  callBtn: { height: 62, alignItems: 'center', justifyContent: 'center' },
  callTxt: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 1.5 },
  flashWrap: { position: 'absolute', left: sp.lg, right: sp.lg, top: STAGE_H + 30, alignItems: 'center' },
})
