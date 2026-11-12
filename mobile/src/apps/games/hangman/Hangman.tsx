// Live hangman, one screen for every phase:
//   choosing   — the setter picks a category (the hint) and a word: a tapped
//                suggestion, "surprise me", or their own. Everyone else waits.
//   guessing   — the guesser plays the letter pad (or risks the whole word);
//                everyone watches the tiles fill and the house go up live.
//   round_over — the word is revealed, the point flies into the winning
//                team's score, the winners celebrate and the losers get rain.
//
// YOUR team is everywhere (owner, 2026-11): a "You're on Team Orange" strip,
// a wash of your colour behind the screen, your score tile marked "You" and
// the other team's faded. The house belongs to the team that picked the word:
// its outline and roof are in that team's colour.
//
// Feedback (sound + haptic + shake/confetti) is driven by what CHANGED in the
// shared state, so every phone reacts to every move, not only the one that
// made it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated'
import Svg, { Ellipse, G, Path } from 'react-native-svg'
import { ArrowRight, ArrowUp, ChevronLeft, Dices, Pencil, RefreshCw, SkipForward, Sparkles, Trophy } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { games, GameRpcError, type GamePlayer, type GameSession, type Team } from '@/lib/games'
import { fonts, sheetRadius, sp, useTheme } from '@/theme/theme'
import { Avatar } from '@/apps/family/Avatar'
import { Confetti } from '../art/Confetti'
import { HouseBuild } from '../art/HouseBuild'
import { feedback } from '../feedback'
import { HOUSE_PIECES, TEAM_CONFETTI, TEAM_GRADIENT, TEAM_SOFT, TEAM_SOLID } from '../look'
import { useMembers } from '../members'
import { TeamBadge } from '../shared'
import { CATEGORIES, randomWord, suggestions, validWord, wordsFor, type CategoryId } from './words'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

export function Hangman({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width } = useWindowDimensions()
  const { name, avatar } = useMembers()
  const st = session.state
  const myTeam = players.find((p) => p.email === me)?.team as Team | undefined
  const wide = width >= 760
  const host = session.host_email === me
  const phase = st.phase
  const iSet = st.setter === me
  const iGuess = st.guesser === me
  const setterTeam = (st.setter_team ?? 'A') as Team
  const guessTeam = (st.guess_team ?? 'B') as Team

  // Derived, not stored: confetti fires on a round my team won.
  const roundWinner = phase === 'round_over' ? ((st.solved ? guessTeam : setterTeam) as Team) : undefined
  const iWon = !!roundWinner && roundWinner === myTeam
  const confetti = iWon ? (st.round ?? 1) : 0

  const seen = useRef<{ at?: string; phase?: string; turn?: string; round?: number }>({})
  useEffect(() => {
    const s = seen.current
    const turnKey = `${st.round}:${phase}:${phase === 'choosing' ? st.setter : st.guesser}`
    if (s.phase === undefined) {
      seen.current = { at: st.last?.at, phase, turn: turnKey, round: st.round }
      return
    }
    if (st.last?.at && st.last.at !== s.at && phase !== 'round_over') {
      feedback(st.last.hit ? 'hit' : 'miss')
    }
    if (phase === 'round_over' && s.phase !== 'round_over') {
      feedback(iWon ? 'win' : 'lose')
    } else if (st.round !== s.round) {
      feedback('start')
    } else if (turnKey !== s.turn && (iSet || iGuess) && phase !== 'round_over') {
      feedback('turn')
    }
    seen.current = { at: st.last?.at, phase, turn: turnKey, round: st.round }
  }, [st, phase, iWon, iSet, iGuess])

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
    } catch (e) {
      const code = e instanceof GameRpcError ? e.code : 'network'
      Alert.alert(t(`games.err.${code}` as never))
    }
  }

  const scores = st.scores ?? { A: 0, B: 0 }
  // A SENT hangman (migration 092): one round, sender vs one guesser — no
  // teams, scores or team banner; the result offers "send one back".
  const isAsync = session.mode === 'async'
  const sender = session.host_email
  const asyncLine = isAsync
    ? me === sender
      ? t('games.send.yourFor', { name: name(st.guesser) })
      : t('games.send.fromName', { name: name(sender) })
    : ''
  const sendBack = () => router.push(`/games/send?to=${encodeURIComponent(me === sender ? (st.guesser ?? '') : sender)}`)
  const [fitH, setFitH] = useState(0)
  const [houseH, setHouseH] = useState(0)
  const bottomGap = useBottomGap(sp.sm)
  // The house is the word-picking team's: they see it go up, the guessers see
  // it fall apart (art/HouseBuild).
  const houseMode: 'build' | 'destroy' = myTeam === setterTeam ? 'build' : 'destroy'
  const turnEmail = phase === 'choosing' ? st.setter : st.guesser

  // ONE fixed frame for every phase — never taller than the screen, never a
  // scroll (owner, 2026-11). Each phase shows only what matters right then:
  //   choosing  — the word picker (setter) or "X is picking" (everyone else);
  //               no house yet.
  //   guessing  — house (takes the leftover height), hint + word, whose turn,
  //               the letter pad (keys sized to width AND height).
  //   round_over — just the result and the next-round button.
  const top = isAsync ? (
    <AsyncHeader text={asyncLine} email={me === sender ? (st.guesser ?? '') : sender} avatarPath={avatar(me === sender ? (st.guesser ?? '') : sender)} />
  ) : (
    <ScoreBoard scores={scores} myTeam={myTeam} compact />
  )

  const skip =
    host && phase !== 'round_over' && turnEmail && turnEmail !== me ? (
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          Alert.alert(t('games.skipTitle', { name: name(turnEmail) }), t('games.skipBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('games.skip'), onPress: () => act(() => games.skipTurn(session.id)) },
          ])
        }
        style={styles.skip}
      >
        <SkipForward size={14} color={c.textMuted} />
        <Txt variant="muted" style={{ fontSize: 13 }}>
          {t('games.skip')}
        </Txt>
      </Pressable>
    ) : null

  const roundLine = isAsync ? null : (
    <Txt variant="muted" style={{ textAlign: 'center', fontSize: 13 }}>
      {t('games.hangman.round', { n: st.round ?? 1, of: st.rounds ?? 1 })}
    </Txt>
  )

  let body: React.ReactNode = null
  if (phase === 'choosing') {
    body = iSet ? (
      <>
        {roundLine}
        <WordPicker fill lang={session.lang} tint={setterTeam} onPick={(cat, word) => act(() => games.hangman.setWord(session.id, cat, word))} />
      </>
    ) : (
      <>
        {roundLine}
        <View style={styles.center}>
          <WaitCard
            avatarPath={avatar(st.setter ?? '')}
            name={name(st.setter)}
            team={setterTeam}
            text={t('games.hangman.choosing', { name: name(st.setter) })}
          />
        </View>
        {skip}
      </>
    )
  } else if (phase === 'guessing' && st.mask) {
    const house = (
      <View style={{ flex: 1, minHeight: 90 }} onLayout={(e) => setHouseH(e.nativeEvent.layout.height)}>
        {houseH > 0 ? <HouseBuild wrong={st.wrong ?? 0} mode={houseMode} tint={TEAM_GRADIENT[setterTeam]} height={houseH} /> : null}
      </View>
    )
    const word = (
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={[styles.hint, { backgroundColor: c.surface, paddingVertical: 5 }]}>
          <Sparkles size={13} color={c.accent} />
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: c.text }}>
            {st.category ? t(`games.cat.${st.category}` as never) : t('games.hangman.freeWord')}
            {'  ·  '}
            {t('games.hangman.lives', { n: Math.max(0, (st.max_wrong ?? HOUSE_PIECES) - (st.wrong ?? 0)) })}
            {isAsync ? '' : `  ·  ${t('games.hangman.roundShort', { n: st.round ?? 1, of: st.rounds ?? 1 })}`}
          </Txt>
        </View>
        <Mask mask={st.mask} revealAll={false} solved={false} tint={TEAM_SOLID[guessTeam]} />
      </View>
    )
    const play = (
      <>
        <TurnLine
          compact
          email={st.guesser ?? ''}
          avatarPath={avatar(st.guesser ?? '')}
          team={guessTeam}
          text={iGuess ? t('games.hangman.yourGuess') : t('games.hangman.guessing', { name: name(turnEmail) })}
        />
        <LetterPad
          guessed={st.guessed ?? []}
          mask={st.mask ?? ''}
          enabled={iGuess}
          team={guessTeam}
          maxHeight={fitH ? fitH * (wide ? 0.55 : 0.34) : undefined}
          onKey={(l) => {
            feedback('tap')
            void act(() => games.hangman.guess(session.id, l))
          }}
        />
        {iGuess || skip ? (
          <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
            {iGuess ? (
              <View style={{ flex: 1 }}>
                <GuessWord compact team={guessTeam} onGuess={(w) => act(() => games.hangman.guessWord(session.id, w))} />
              </View>
            ) : null}
            {skip}
          </View>
        ) : null}
      </>
    )
    body = wide ? (
      <View style={{ flex: 1, flexDirection: 'row', gap: sp.xl }}>
        <View style={{ flex: 1.1, gap: 10 }}>
          {house}
          {word}
        </View>
        <View style={{ flex: 1, gap: 10, justifyContent: 'center' }}>{play}</View>
      </View>
    ) : (
      <>
        {house}
        {word}
        {play}
      </>
    )
  } else if (phase === 'round_over' && roundWinner) {
    const iSent = me === sender
    const other = name(iSent ? st.guesser : sender)
    const last = (st.round ?? 0) >= (st.rounds ?? 0)
    body = (
      <>
        <View style={styles.center}>
          <View style={{ width: '100%', maxWidth: 560 }}>
            {isAsync ? (
              <RoundResult
                winner={roundWinner}
                mine={iWon}
                solved={!!st.solved}
                word={st.word ?? ''}
                guesser={name(st.guesser)}
                title={
                  st.solved
                    ? iSent
                      ? t('games.send.theyGotIt', { name: other })
                      : t('games.send.youGotIt')
                    : iSent
                      ? t('games.send.theyMissed', { name: other })
                      : t('games.send.youMissed')
                }
                line=""
              />
            ) : (
              <RoundResult winner={roundWinner} mine={iWon} solved={!!st.solved} word={st.word ?? ''} guesser={name(st.guesser)} />
            )}
          </View>
        </View>
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
          {isAsync ? (
            <NextButton
              last={false}
              team={myTeam ?? 'A'}
              label={iSent ? t('games.send.sendAnother', { name: other }) : t('games.send.sendBack', { name: other })}
              sub={t('games.send.sendBackSub')}
              onPress={sendBack}
            />
          ) : (
            <NextButton
              last={last}
              // Next round: the team that guessed now picks the word.
              team={last ? roundWinner : guessTeam}
              sub={
                last
                  ? t('games.hangman.lastRoundSub')
                  : t('games.hangman.nextSub', { n: (st.round ?? 0) + 1, of: st.rounds ?? 0, team: t(`games.team.${guessTeam}`) })
              }
              onPress={() => act(() => games.hangman.next(session.id))}
            />
          )}
        </View>
      </>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.fit, { paddingBottom: bottomGap }]} onLayout={(e) => setFitH(e.nativeEvent.layout.height)}>
        {top}
        {body}
      </View>
      <Confetti fire={confetti} colors={myTeam ? TEAM_CONFETTI[myTeam] : undefined} />
    </View>
  )
}

/** Sent hangman header: who it's from / who it's for, with their avatar. */
function AsyncHeader({ text, email, avatarPath }: { text: string; email: string; avatarPath: string | null }) {
  const { c } = useTheme()
  return (
    <View style={[styles.asyncHead, { backgroundColor: c.card, borderColor: c.border }]}>
      <Avatar name={email} avatarPath={avatarPath} size={32} />
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
        {text}
      </Txt>
    </View>
  )
}

// ── score ──────────────────────────────────────────────────────────────────

/** The two score tiles. When a score goes up, a "+1" floats up into that tile
 *  and the tile pops — the point visibly lands with the team that won it. */
export function ScoreBoard({ scores, myTeam, compact }: { scores: Record<Team, number>; myTeam?: Team; compact?: boolean }) {
  const { t } = useI18n()
  return (
    <View style={{ flexDirection: 'row', gap: compact ? sp.sm : sp.md }}>
      {(['A', 'B'] as Team[]).map((team) => (
        <ScoreTile
          key={team}
          team={team}
          score={scores[team] ?? 0}
          mine={team === myTeam}
          dim={!!myTeam && team !== myTeam}
          label={t(`games.team.${team}`)}
          compact={compact}
        />
      ))}
    </View>
  )
}

function ScoreTile({
  team,
  score,
  mine,
  dim,
  label,
  compact,
}: {
  team: Team
  score: number
  mine: boolean
  dim: boolean
  label: string
  compact?: boolean
}) {
  const { t } = useI18n()
  const pop = useSharedValue(1)
  const plus = useSharedValue(0)
  const prev = useRef(score)
  useEffect(() => {
    if (score > prev.current) {
      plus.set(0)
      plus.set(withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }))
      pop.set(withDelay(650, withSequence(withTiming(1.08, { duration: 170 }), withTiming(1, { duration: 240 }))))
    }
    prev.current = score
  }, [score, pop, plus])
  const tileStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }))
  const plusStyle = useAnimatedStyle(() => ({
    opacity: plus.value === 0 ? 0 : plus.value < 0.7 ? 1 : (1 - plus.value) / 0.3,
    transform: [{ translateY: 60 - plus.value * 70 }, { scale: 0.8 + plus.value * 0.6 }],
  }))
  return (
    <Animated.View style={[{ flex: 1 }, tileStyle]}>
      {compact ? (
        <View style={{ opacity: dim ? 0.42 : 1 }}>
          <GradientBox colors={TEAM_GRADIENT[team]} radius={18} style={styles.scoreCompact}>
            <View style={{ flex: 1 }}>
              {mine ? <Txt style={styles.scoreYou}>{t('games.you').toUpperCase()}</Txt> : null}
              <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 13 }} numberOfLines={1}>
                {label}
              </Txt>
            </View>
            <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 26, lineHeight: 30 }}>{score}</Txt>
          </GradientBox>
        </View>
      ) : (
        <TeamBadge big team={team} label={label} score={score} mine={mine} dim={dim} />
      )}
      <Animated.View pointerEvents="none" style={[styles.plusOne, plusStyle]}>
        <Txt style={[styles.plusText, { color: TEAM_SOLID[team] }]}>+1</Txt>
      </Animated.View>
    </Animated.View>
  )
}

// ── round result ───────────────────────────────────────────────────────────

/** From MY side of the table: a big celebration in my colours when my team
 *  takes the round, a grey card with a little rain cloud when it doesn't. */
function RoundResult({
  winner,
  mine,
  solved,
  word,
  guesser,
  title,
  line,
}: {
  winner: Team
  mine: boolean
  solved: boolean
  word: string
  guesser: string
  /** Sent hangman: no teams to talk about — its own headline and line. */
  title?: string
  line?: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const team = t(`games.team.${winner}`)
  const why = solved ? t('games.hangman.whySolved', { name: guesser, word }) : t('games.hangman.whyBuilt', { word })
  if (mine) {
    return (
      <Animated.View entering={ZoomIn.duration(240)}>
        <GradientBox colors={TEAM_GRADIENT[winner]} radius={26} style={styles.result}>
          <Bouncing>
            <View style={styles.resultIcon}>
              <Trophy size={34} color="#fff" strokeWidth={2} />
            </View>
          </Bouncing>
          <Txt style={styles.resultTitle}>{title ?? t('games.hangman.weWon')}</Txt>
          {line !== '' ? <Txt style={styles.resultTeam}>{line ?? t('games.hangman.pointTo', { team })}</Txt> : null}
          <Txt style={styles.resultWhy}>{why}</Txt>
        </GradientBox>
      </Animated.View>
    )
  }
  return (
    <Animated.View entering={FadeInUp.duration(240)} style={[styles.lostCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <RainCloud />
      <Txt style={[styles.resultTitle, { color: c.text }]}>{title ?? t('games.hangman.theyWon', { team })}</Txt>
      {line !== '' ? (
        <View style={[styles.lostTeam, { backgroundColor: TEAM_SOFT[winner] }]}>
          <Txt style={{ color: TEAM_SOLID[winner], fontFamily: fonts.semibold }}>{line ?? t('games.hangman.pointTo', { team })}</Txt>
        </View>
      ) : null}
      <Txt variant="muted" style={{ textAlign: 'center' }}>
        {why}
      </Txt>
    </Animated.View>
  )
}

function Bouncing({ children }: { children: React.ReactNode }) {
  const y = useSharedValue(0)
  useEffect(() => {
    y.set(withRepeat(withSequence(withTiming(-5, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) })), 2))
  }, [y])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  return <Animated.View style={style}>{children}</Animated.View>
}

/** A small, sad rain cloud: drooping in, then raindrops falling under it. */
function RainCloud() {
  const sway = useSharedValue(0)
  useEffect(() => {
    sway.set(withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })), -1))
  }, [sway])
  const cloud = useAnimatedStyle(() => ({ transform: [{ translateX: -4 + sway.value * 8 }, { rotate: `${-2 + sway.value * 4}deg` }] }))
  return (
    <View style={styles.rainBox}>
      <Animated.View style={[styles.cloudWrap, cloud]}>
        <Svg viewBox="0 0 120 60" style={{ width: '100%', height: '100%' }}>
          <G fill="#9AA6B8">
            <Ellipse cx={42} cy={36} rx={28} ry={18} />
            <Ellipse cx={68} cy={28} rx={26} ry={22} />
            <Ellipse cx={88} cy={40} rx={22} ry={14} />
            <Ellipse cx={60} cy={44} rx={40} ry={12} />
          </G>
          {/* a droopy little face */}
          <Path d="M52 38 q4 -3 8 0 M70 38 q4 -3 8 0" stroke="#5E6B80" strokeWidth={2.4} strokeLinecap="round" fill="none" />
          <Path d="M58 49 q7 -6 14 0" stroke="#5E6B80" strokeWidth={2.4} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
      {[0, 1, 2, 3, 4].map((i) => (
        <Drop key={i} x={30 + i * 15} delay={i * 230} />
      ))}
    </View>
  )
}

function Drop({ x, delay }: { x: number; delay: number }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withDelay(delay, withRepeat(withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }), -1)))
  }, [t, delay])
  const style = useAnimatedStyle(() => ({ opacity: 1 - t.value, transform: [{ translateY: t.value * 34 }] }))
  return <Animated.View style={[styles.drop, { left: `${x}%` }, style]} />
}

function NextButton({ last, team, sub, onPress, label }: { last: boolean; team: Team; sub: string; onPress: () => void; label?: string }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <Animated.View entering={FadeInUp.delay(350).duration(240)}>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true)
          feedback('tap')
          try {
            await onPress()
          } finally {
            setBusy(false)
          }
        }}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }], opacity: busy ? 0.7 : 1 })}
      >
        <GradientBox colors={TEAM_GRADIENT[team]} radius={24} style={styles.next}>
          <View style={{ flex: 1 }}>
            <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 21 }}>
              {label ?? (last ? t('games.hangman.seeResult') : t('games.hangman.nextRound'))}
            </Txt>
            <Txt style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13.5 }}>{sub}</Txt>
          </View>
          <View style={styles.nextArrow}>
            {last && !label ? <Trophy size={22} color={TEAM_SOLID[team]} /> : <ArrowRight size={24} color={TEAM_SOLID[team]} strokeWidth={2.6} />}
          </View>
        </GradientBox>
      </Pressable>
    </Animated.View>
  )
}

// ── the word ───────────────────────────────────────────────────────────────

/** The word as tiles; letters pop in as they're found. Words wrap whole. */
function Mask({ mask, revealAll, solved, tint }: { mask: string; revealAll: boolean; solved: boolean; tint: string }) {
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const words = mask.split(' ')
  const longest = Math.max(...words.map((w) => w.length))
  const avail = Math.min(width - sp.lg * 2, 560)
  const size = Math.max(24, Math.min(44, Math.floor((avail - 4 * longest) / Math.max(longest, 1))))
  const missed = revealAll && !solved
  return (
    <View style={styles.maskWrap}>
      {words.map((w, wi) => (
        <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
          {w.split('').map((ch, i) => {
            const hidden = ch === '_'
            const isSep = ch === '-'
            return (
              <View
                key={`${i}-${ch}`}
                style={[
                  styles.tile,
                  { width: size, height: size * 1.2, borderRadius: size * 0.28 },
                  isSep
                    ? { backgroundColor: 'transparent', borderWidth: 0 }
                    : { backgroundColor: hidden ? c.surface : c.card, borderColor: hidden ? c.border : missed ? c.border : tint },
                ]}
              >
                {hidden ? (
                  <View style={[styles.dash, { backgroundColor: c.textFaint, width: size * 0.42 }]} />
                ) : (
                  <Animated.Text
                    entering={ZoomIn.duration(240)}
                    style={{ fontFamily: fonts.display, fontSize: size * 0.62, color: missed ? c.textMuted : c.text }}
                  >
                    {ch.toUpperCase()}
                  </Animated.Text>
                )}
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

/**
 * Big letter keys, alphabetical, and ONLY the letters not tried yet — so the
 * pad shrinks as the round goes on and each key stays a big, forgiving
 * target (owner, 2026-11: a cramped QWERTY made wrong taps easy). Tried
 * letters move to a compact strip above: found in the team colour, misses
 * struck through.
 */
function LetterPad({
  guessed,
  mask,
  enabled,
  team,
  onKey,
  maxHeight,
}: {
  guessed: string[]
  mask: string
  enabled: boolean
  team: Team
  onKey: (l: string) => void
  /** Height budget for the keys (fit-to-screen play layout). */
  maxHeight?: number
}) {
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const cols = 7
  const avail = Math.min(width >= 760 ? width / 2 - sp.xl * 2 : width - sp.lg * 2, 520)
  const gap = 8
  const left = ALPHABET.filter((l) => !guessed.includes(l))

  const byWidth = Math.floor((avail - (cols - 1) * gap) / cols)
  // Sized for the FULL alphabet (4 rows) so keys don't grow as letters go.
  const byHeight = maxHeight ? Math.floor((maxHeight - 3 * gap) / 4 / 1.12) : byWidth
  const key = Math.max(34, Math.min(byWidth, byHeight))

  const found = new Set(
    mask
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(''),
  )
  return (
    <View style={{ gap: maxHeight ? sp.sm : sp.md }}>
      {guessed.length ? (
        <View style={styles.tried}>
          {guessed.map((l) => {
            const hit = found.has(l)
            return (
              <Animated.View
                key={l}
                entering={ZoomIn.duration(240)}
                style={[styles.triedChip, { backgroundColor: hit ? TEAM_SOLID[team] : c.surface2 }]}
              >
                <Txt
                  style={{
                    fontFamily: fonts.semibold,
                    fontSize: 13,
                    color: hit ? '#fff' : c.textMuted,
                    textDecorationLine: hit ? 'none' : 'line-through',
                  }}
                >
                  {l.toUpperCase()}
                </Txt>
              </Animated.View>
            )
          })}
        </View>
      ) : null}
      <View style={[styles.pad, { gap, opacity: enabled ? 1 : 0.55 }]}>
        {left.map((l) => (
          <Animated.View key={l} exiting={ZoomOut.duration(160)} layout={LinearTransition.duration(200)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={l}
              disabled={!enabled}
              onPress={() => onKey(l)}
              style={({ pressed }) => [
                styles.key,
                {
                  width: key,
                  height: key * 1.12,
                  borderRadius: key * 0.3,
                  backgroundColor: pressed ? TEAM_SOLID[team] : c.card,
                  borderColor: enabled ? TEAM_SOLID[team] : c.border,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                },
              ]}
            >
              {({ pressed }) => (
                <Txt style={{ fontFamily: fonts.display, fontSize: key * 0.46, color: pressed ? '#fff' : c.text }}>{l.toUpperCase()}</Txt>
              )}
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  )
}

export function TurnLine({ email, avatarPath, team, text, compact }: { email: string; avatarPath: string | null; team: Team; text: string; compact?: boolean }) {
  const { c } = useTheme()
  return (
    <Animated.View
      key={email}
      entering={FadeInDown.duration(240)}
      style={[styles.turn, { backgroundColor: c.card, borderColor: TEAM_SOLID[team] }, compact ? { paddingVertical: 6 } : null]}
    >
      <Avatar name={email} avatarPath={avatarPath} size={compact ? 28 : 34} />
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15.5 }}>{text}</Txt>
    </Animated.View>
  )
}

function WaitCard({ avatarPath, name, team, text }: { avatarPath: string | null; name: string; team: Team; text: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Animated.View entering={FadeInDown.duration(240)} style={[styles.wait, { backgroundColor: c.card, borderColor: TEAM_SOLID[team] }]}>
      <View style={[styles.waitRing, { borderColor: TEAM_SOLID[team] }]}>
        <Avatar name={name} avatarPath={avatarPath} size={64} />
      </View>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20, textAlign: 'center' }}>{text}</Txt>
      <Dots color={TEAM_SOLID[team]} />
      <Txt variant="muted" style={{ textAlign: 'center', fontSize: 13.5 }}>
        {t('games.hangman.choosingSub')}
      </Txt>
    </Animated.View>
  )
}

function Dots({ color }: { color: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((x) => (x + 1) % 4), 380)
    return () => clearInterval(id)
  }, [])
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, opacity: i < n ? 1 : 0.25 }} />
      ))}
    </View>
  )
}

// ── picking the word ───────────────────────────────────────────────────────

/**
 * Picking the word, in two short steps so it always fits the screen (owner,
 * 2026-11: no scrolling anywhere in the game):
 *   1. the category (it becomes the hint) — a 2-column grid, or "type my own";
 *   2. a word from it — 8 suggestions with "other words", "surprise me", or
 *      your own (the WordEntrySheet, whose field sits above the keyboard).
 * `fill` stretches the card to the space it's given (the game frame).
 */
export function WordPicker({
  lang,
  tint,
  onPick,
  fill,
}: {
  lang: string
  tint: Team
  onPick: (cat: CategoryId | null, word: string) => Promise<void>
  fill?: boolean
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [cat, setCat] = useState<CategoryId | null>(null)
  const [shuffle, setShuffle] = useState(0)
  const [own, setOwn] = useState(false)
  const [busy, setBusy] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `shuffle` deals a new hand
  const picks = useMemo(() => (cat ? suggestions(lang, cat, 8) : []), [cat, lang, shuffle])
  const color = TEAM_SOLID[tint]
  const catInfo = CATEGORIES.find((x) => x.id === cat)

  async function send(word: string) {
    if (busy) return
    setBusy(true)
    feedback('ready')
    try {
      await onPick(cat, word)
    } finally {
      setBusy(false)
    }
  }

  const entry = (
    <WordEntrySheet
      visible={own}
      team={tint}
      title={t('games.hangman.ownTitle')}
      sub={cat ? t('games.hangman.ownSub', { cat: t(`games.cat.${cat}` as never) }) : t('games.hangman.ownSubNoCat')}
      cta={t('games.hangman.useWord')}
      validate={validWord}
      invalidHint={t('games.err.bad_word')}
      onClose={() => setOwn(false)}
      onSubmit={async (w) => {
        setOwn(false)
        await send(w)
      }}
    />
  )

  if (!cat) {
    return (
      <Animated.View entering={FadeIn.duration(220)} style={[styles.picker, fill ? { flex: 1 } : null, { backgroundColor: c.card, borderColor: color }]}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 22 }}>{t('games.hangman.yourWord')}</Txt>
        <Txt variant="muted" style={{ fontSize: 14 }}>
          {t('games.hangman.pickCategory')}
        </Txt>
        <View style={[styles.catGrid, fill ? { flex: 1 } : null]}>
          {CATEGORIES.map(({ id, icon: Icon, colors }) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={t(`games.cat.${id}` as never)}
              onPress={() => {
                feedback('tap')
                setCat(id)
              }}
              style={({ pressed }) => [styles.catCell, fill ? { flexGrow: 1 } : null, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
            >
              <GradientBox colors={colors} radius={20} style={styles.catCard}>
                {/* a big faded copy of the icon, tucked in the corner */}
                <View pointerEvents="none" style={styles.catGhost}>
                  <Icon size={78} color="#fff" strokeWidth={1.6} />
                </View>
                <View style={styles.catBadge}>
                  <Icon size={20} color="#fff" strokeWidth={2.2} />
                </View>
                <View>
                  <Txt style={styles.catName} numberOfLines={1}>
                    {t(`games.cat.${id}` as never)}
                  </Txt>
                  <Txt style={styles.catCount}>{t('games.hangman.wordsCount', { n: wordsFor(lang, id).length })}</Txt>
                </View>
              </GradientBox>
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setOwn(true)} style={styles.ownLink} hitSlop={6}>
          <Pencil size={15} color={color} />
          <Txt style={{ color, fontFamily: fonts.semibold, fontSize: 14 }}>{t('games.hangman.ownWordNoCat')}</Txt>
        </Pressable>
        {entry}
      </Animated.View>
    )
  }

  return (
    <Animated.View key={cat} entering={FadeIn.duration(220)} style={[styles.picker, fill ? { flex: 1 } : null, { backgroundColor: c.card, borderColor: color }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => setCat(null)}
          style={[styles.catBack, { backgroundColor: c.surface }]}
          hitSlop={6}
        >
          <ChevronLeft size={16} color={c.text} />
          {catInfo ? <catInfo.icon size={15} color={catInfo.tint} /> : null}
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{t(`games.cat.${cat}` as never)}</Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            feedback('tap')
            setShuffle((n) => n + 1)
          }}
          hitSlop={8}
          style={styles.reshuffle}
        >
          <RefreshCw size={14} color={color} />
          <Txt style={{ color, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.hangman.moreWords')}</Txt>
        </Pressable>
      </View>
      <Txt style={[styles.label, { color: c.textMuted }]}>{t('games.hangman.suggestions')}</Txt>
      <View style={[styles.words, fill ? { flex: 1, alignContent: 'flex-start' } : null]}>
        {picks.map((w, i) => (
          <Animated.View key={`${shuffle}-${w}`} entering={FadeIn.delay(i * 25).duration(200)}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => send(w)}
              style={({ pressed }) => [styles.word, { borderColor: pressed ? color : c.border, backgroundColor: pressed ? TEAM_SOFT[tint] : c.bg }]}
            >
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }}>{w}</Txt>
            </Pressable>
          </Animated.View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: sp.sm }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => send(randomWord(lang, cat))}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.85 : 1 }]}
        >
          <GradientBox colors={TEAM_GRADIENT[tint]} radius={16} style={styles.actionFill}>
            <Dices size={18} color="#fff" />
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold }}>{t('games.hangman.random')}</Txt>
          </GradientBox>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOwn(true)}
          style={({ pressed }) => [styles.action, styles.actionFill, { backgroundColor: c.surface, borderRadius: 16, opacity: pressed ? 0.85 : 1 }]}
        >
          <Pencil size={16} color={c.text} />
          <Txt style={{ fontFamily: fonts.semibold }}>{t('games.hangman.ownWord')}</Txt>
        </Pressable>
      </View>
      {entry}
    </Animated.View>
  )
}

function GuessWord({ team, onGuess, compact }: { team: Team; onGuess: (w: string) => Promise<void>; compact?: boolean }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.risk, { borderColor: TEAM_SOLID[team] }, compact ? { paddingVertical: 10 } : null]}
      >
        <Sparkles size={16} color={TEAM_SOLID[team]} />
        <Txt style={{ fontFamily: fonts.semibold, color: TEAM_SOLID[team] }}>{t('games.hangman.riskWord')}</Txt>
      </Pressable>
      <WordEntrySheet
        visible={open}
        team={team}
        title={t('games.hangman.riskWord')}
        sub={t('games.hangman.riskSub')}
        cta={t('games.hangman.riskGo')}
        validate={(w) => w.trim().length >= 2}
        preview={false}
        onClose={() => setOpen(false)}
        onSubmit={async (w) => {
          setOpen(false)
          await onGuess(w)
        }}
      />
      <View style={{ height: 0, backgroundColor: c.bg }} />
    </>
  )
}

/**
 * Typing a word, in the app's current input language: a sheet whose field is
 * the floating capsule (Shopping's add bar), pinned to the sheet's bottom
 * inside a KeyboardAvoidingView so the keyboard can never cover what you type
 * (owner, 2026-11 — the inline field used to sit under the keyboard). Above it,
 * a live preview of the word as the other team will see it, in tiles.
 */
function WordEntrySheet({
  visible,
  team,
  title,
  sub,
  cta,
  validate,
  invalidHint,
  preview = true,
  onClose,
  onSubmit,
}: {
  visible: boolean
  team: Team
  title: string
  sub: string
  cta: string
  validate: (w: string) => boolean
  invalidHint?: string
  preview?: boolean
  onClose: () => void
  onSubmit: (w: string) => Promise<void>
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const gap = useBottomGap(sp.md)
  const [text, setText] = useState('')
  const ok = validate(text)
  const color = TEAM_SOLID[team]
  async function submit() {
    if (!ok) return
    const w = text
    setText('')
    await onSubmit(w)
  }
  const letters = text.trim().replace(/\s+/g, ' ')
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: gap }]}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <View style={[styles.sheetBadge, { backgroundColor: TEAM_SOFT[team] }]}>
            <Pencil size={18} color={color} />
          </View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 24 }}>{title}</Txt>
          <Txt variant="muted" style={{ fontSize: 14.5 }}>
            {sub}
          </Txt>

          {preview ? (
            <View style={[styles.previewBox, { backgroundColor: c.surface }]}>
              {letters ? (
                <View style={styles.maskWrap}>
                  {letters.split(' ').map((w, wi) => (
                    <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
                      {w.split('').map((ch, i) => (
                        <Animated.View
                          key={`${wi}-${i}`}
                          entering={ZoomIn.duration(240)}
                          style={[styles.previewTile, { borderColor: color, backgroundColor: c.card }]}
                        >
                          <Txt style={{ fontFamily: fonts.display, fontSize: 18 }}>{ch === '-' ? '-' : ch.toUpperCase()}</Txt>
                        </Animated.View>
                      ))}
                    </View>
                  ))}
                </View>
              ) : (
                <Txt variant="muted" style={{ fontSize: 14 }}>
                  {t('games.hangman.previewEmpty')}
                </Txt>
              )}
            </View>
          ) : null}
          {text.length > 1 && !ok && invalidHint ? (
            <Txt style={{ color: c.expense, fontSize: 13 }}>{invalidHint}</Txt>
          ) : null}

          <View style={[styles.capsule, { backgroundColor: Platform.OS === 'android' ? c.sheet : c.card, borderColor: ok ? color : c.border }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              returnKeyType="done"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              maxLength={30}
              placeholder={t('games.hangman.typeWord')}
              placeholderTextColor={c.textFaint}
              style={[styles.capsuleInput, { color: c.text }]}
              accessibilityLabel={cta}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cta}
              disabled={!ok}
              onPress={submit}
              style={[styles.capsuleBtn, { backgroundColor: ok ? color : c.surface2 }]}
            >
              <ArrowUp size={21} strokeWidth={2.6} color={ok ? '#fff' : c.textFaint} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  asyncHead: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, padding: 8, paddingRight: sp.md, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, alignContent: 'stretch' },
  catCell: { flexBasis: '47%', minHeight: 64 },
  catCard: { flex: 1, padding: 12, justifyContent: 'space-between', overflow: 'hidden', gap: 6 },
  catGhost: { position: 'absolute', right: -14, bottom: -16, opacity: 0.2, transform: [{ rotate: '-12deg' }] },
  catBadge: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center' },
  catName: { color: '#fff', fontFamily: fonts.display, fontSize: 16.5, lineHeight: 20 },
  catCount: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: fonts.medium },
  catBack: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingLeft: 8, paddingRight: 12, borderRadius: 999 },
  ownLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 },
  fit: { flex: 1, paddingHorizontal: sp.lg, gap: 10 },
  scoreCompact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
  scoreYou: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.8 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  maskWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18, rowGap: 10 },
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  dash: { height: 3, borderRadius: 2, position: 'absolute', bottom: '22%' },
  plusOne: { position: 'absolute', alignSelf: 'center', top: 0 },
  plusText: { fontFamily: fonts.display, fontSize: 34, textShadowColor: 'rgba(255,255,255,0.9)', textShadowRadius: 6 },
  tried: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  triedChip: { minWidth: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  key: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  turn: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, padding: 10, borderRadius: 20, borderWidth: 2 },
  wait: { alignItems: 'center', gap: sp.md, padding: sp.xl, borderRadius: 26, borderWidth: 2 },
  waitRing: { padding: 4, borderRadius: 40, borderWidth: 3 },
  result: { padding: sp.xl, alignItems: 'center', gap: 6 },
  resultIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  resultTitle: { color: '#fff', fontFamily: fonts.display, fontSize: 28, textAlign: 'center', lineHeight: 34 },
  resultTeam: { color: '#fff', fontFamily: fonts.semibold, fontSize: 16 },
  resultWhy: { color: 'rgba(255,255,255,0.9)', textAlign: 'center', fontSize: 14.5 },
  lostCard: { alignItems: 'center', gap: sp.sm, padding: sp.xl, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  lostTeam: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  rainBox: { width: 130, height: 96 },
  cloudWrap: { width: 130, height: 64 },
  drop: { position: 'absolute', top: 58, width: 4, height: 11, borderRadius: 2, backgroundColor: '#8FB4E8' },
  next: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.lg, paddingHorizontal: sp.lg },
  nextArrow: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  picker: { gap: sp.md, padding: sp.lg, borderRadius: 26, borderWidth: 2 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, flexGrow: 1, flexBasis: '45%' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  reshuffle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  word: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5 },
  action: { flex: 1 },
  actionFill: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  risk: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed' },
  skip: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  sheet: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: sp.md, padding: sp.lg, paddingTop: sp.sm, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: sp.xs },
  sheetBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  previewBox: { minHeight: 78, borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: sp.md },
  previewTile: { width: 30, height: 36, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 58,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingLeft: 16,
    paddingRight: 7,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  capsuleInput: { flex: 1, fontSize: 17, fontFamily: fonts.body, paddingVertical: 0 },
  capsuleBtn: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
