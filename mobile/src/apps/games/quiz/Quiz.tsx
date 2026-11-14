// Live buzzer quiz, team vs team (migration 094). One fixed frame, no scroll:
//   question  — the question card, a countdown, and the big buzzer. First
//               press (as the SERVER receives it) wins the right to answer.
//   answering — the buzzer holder answers by VOICE (the same recogniser as the
//               Home assistant) or by typing; everyone else watches a
//               countdown. Wrong or too slow → they sit this question out and
//               the buzzer reopens for the rest.
//   reveal    — the answer, who scored (a +1 flies into their team's tile),
//               then the next question by itself after a few seconds.
// The server owns every clock; phones correct for their own clock drift with
// `state.now`, and when a deadline passes any phone asks the server to move on
// (quiz_tick), which checks the time itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import Animated, { Easing, FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withRepeat, withTiming, ZoomIn } from 'react-native-reanimated'
import { ArrowUp, Check, Mic, SkipForward, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { Avatar } from '@/apps/family/Avatar'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { games, GameRpcError, type GamePlayer, type GameSession, type QuizState, type Team } from '@/lib/games'
import { useVoice, voiceSupported } from '@/lib/voice'
import { fonts, sp, useTheme } from '@/theme/theme'
import { Confetti } from '../art/Confetti'
import { feedback, preloadSounds } from '../feedback'
import { ScoreBoard } from '../hangman/Hangman'
import { TEAM_CONFETTI, TEAM_GRADIENT, TEAM_SOFT, TEAM_SOLID } from '../look'
import { useMembers } from '../members'
import { GameBtn } from '../shared'
import { Buzzer, CountdownRing } from './Buzzer'
import { AttemptFlash } from './AttemptFlash'
import { PieSplat } from './PieSplat'
import { QuestionCard } from './QuestionCard'

/** This phone's offset from the server clock. Starts from `state.now` (which
 *  may have arrived late — a slow phone then ran seconds behind, owner
 *  2026-11-13) and is replaced by a round-trip measurement: the best of three
 *  `game_server_now` calls, taking the midpoint of the fastest. */
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

/** Seconds left on the server's clock until `at`, ticking every 100 ms. */
function useCountdown(at: string | undefined, offset: React.RefObject<number>) {
  const calc = useCallback(() => (at ? Math.max(0, (Date.parse(at) - (Date.now() + offset.current)) / 1000) : 0), [at, offset])
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    const id = setInterval(() => setLeft(calc()), 100)
    return () => clearInterval(id)
  }, [calc])
  return { left, now: calc }
}

export function Quiz({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width, height } = useWindowDimensions()
  const { name, avatar } = useMembers()
  const gap = useBottomGap(sp.sm)
  const st = session.state as unknown as QuizState
  const myTeam = (players.find((p) => p.email === me)?.team ?? 'A') as Team
  const teamOf = (email: string) => (players.find((p) => p.email === email)?.team ?? null) as Team | null
  const offset = useServerOffset(st.now)
  const { left, now: secondsLeftNow } = useCountdown(st.deadline, offset)
  // The lead-in: every phone shows "3, 2, 1" against the same server time,
  // then the question and the buzzer together.
  const { left: opensIn } = useCountdown(st.opens_at, offset)
  const waiting = st.phase === 'question' && !!st.opens_at && opensIn > 0
  const phase = st.phase
  const locked = (st.locked ?? []).includes(me)
  const iAnswer = phase === 'answering' && st.buzz?.email === me
  // The attempt already on screen when you open the game isn't news: only
  // attempts that land while you watch get the big flash.
  const [firstAttempt] = useState(st.last?.at)
  const total = phase === 'answering' ? 15 : phase === 'reveal' ? 6 : 25

  useEffect(() => preloadSounds(['buzzer', 'correct', 'wrong', 'tick', 'ready', 'win', 'miss', 'tap', 'whoosh', 'splat']), [])

  // Deadline passed → ask the server to move on (once per deadline).
  const ticked = useRef('')
  useEffect(() => {
    // Re-read the clock: right after a NEW deadline arrives `left` can still
    // hold the old 0 for a moment, and a tick then would be wasted on it.
    if (left > 0 || !st.deadline || ticked.current === st.deadline || secondsLeftNow() > 0) return
    ticked.current = st.deadline
    const id = setTimeout(() => void games.quiz.tick(session.id).catch(() => undefined), 300)
    return () => clearTimeout(id)
  }, [left, st.deadline, session.id, secondsLeftNow])

  // Tell the server this phone has the game up — question 1 opens for
  // everyone once every player's phone has (or after 12 s).
  useEffect(() => {
    void games.quiz.ready(session.id).catch(() => undefined)
  }, [session.id])

  // The lead-in counts down out loud on every phone at once, then the
  // question "lands" (the ready sound) as the buzzer opens.
  const leadSec = useRef(-1)
  const leadQ = useRef(0)
  useEffect(() => {
    if (!st.opens_at || phase !== 'question') return
    const n = Math.ceil(opensIn)
    if (n === leadSec.current) return
    leadSec.current = n
    if (n > 0 && n <= 3) feedback('tick')
    if (n === 0 && leadQ.current !== st.q) {
      leadQ.current = st.q
      feedback('ready')
    }
  }, [opensIn, st.opens_at, st.q, phase])

  // Last-seconds ticks while the clock matters to you.
  const lastSec = useRef(-1)
  useEffect(() => {
    const s = Math.ceil(left)
    if (s === lastSec.current) return
    lastSec.current = s
    if (s > 0 && s <= 3 && (phase === 'question' ? !locked : iAnswer)) feedback('tick')
  }, [left, phase, locked, iAnswer])

  // Sounds for what everyone sees happen.
  const seen = useRef({ q: st.q, buzz: st.buzz?.at, last: st.last?.at, phase })
  useEffect(() => {
    const s = seen.current
    if (st.q !== s.q) {
      if (!st.opens_at) feedback('ready')
    } else if (st.buzz?.at && st.buzz.at !== s.buzz) feedback('buzzer')
    if (st.last?.at && st.last.at !== s.last && !st.last.correct) feedback('wrong')
    if (phase === 'reveal' && s.phase !== 'reveal') {
      if (st.reveal?.winner) {
        feedback('correct')
      } else feedback('miss')
    }
    seen.current = { q: st.q, buzz: st.buzz?.at, last: st.last?.at, phase }
  }, [st.q, st.opens_at, st.buzz?.at, st.last, phase, st.reveal, myTeam])

  // Derived: confetti on a question your team scored.
  const confetti = phase === 'reveal' && st.reveal?.winner === myTeam ? st.q : 0

  async function buzz() {
    feedback('tap')
    try {
      const r = await games.quiz.buzz(session.id)
      if (!r.first) feedback('miss')
    } catch (e) {
      if (!(e instanceof GameRpcError && e.code === 'locked_out')) Alert.alert(t('games.err.network'))
    }
  }

  const buzzSize = Math.min(width - sp.lg * 2, height * 0.26, 280)

  let body: React.ReactNode = null
  if (waiting) {
    body = <GetReady n={Math.ceil(opensIn)} first={st.q === 1} team={myTeam} />
  } else if (phase === 'question') {
    body = (
      <View style={styles.center}>
        <CountdownRing left={left} total={total} size={58} color={TEAM_SOLID[myTeam]} track={c.surface2} />
        {st.last && !st.last.correct ? <LastMiss last={st.last} name={name(st.last.email)} /> : null}
        <Buzzer size={buzzSize} colors={TEAM_GRADIENT[myTeam]} state={locked ? 'locked' : 'active'} onPress={buzz} />
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center', color: locked ? c.textMuted : c.text }}>
          {locked ? t('games.quiz.lockedOut') : t('games.quiz.pressIfYouKnow')}
        </Txt>
      </View>
    )
  } else if (phase === 'answering' && st.buzz) {
    body = iAnswer ? (
      <AnswerPanel sessionId={session.id} lang={session.lang} team={myTeam} left={left} total={total} />
    ) : (
      <View style={styles.center}>
        <Animated.View entering={ZoomIn.duration(220)} style={[styles.answeringRing, { borderColor: TEAM_SOLID[st.buzz.team] }]}>
          <Avatar name={name(st.buzz.email)} avatarPath={avatar(st.buzz.email)} size={84} />
        </Animated.View>
        <Txt style={{ fontFamily: fonts.display, fontSize: 22, textAlign: 'center' }}>{t('games.quiz.answering', { name: name(st.buzz.email) })}</Txt>
        <View style={[styles.teamPill, { backgroundColor: TEAM_SOFT[st.buzz.team] }]}>
          <Txt style={{ color: TEAM_SOLID[st.buzz.team], fontFamily: fonts.semibold }}>{t(`games.team.${st.buzz.team}`)}</Txt>
        </View>
        <CountdownRing left={left} total={total} size={58} color={TEAM_SOLID[st.buzz.team]} track={c.surface2} />
      </View>
    )
  } else if (phase === 'reveal' && st.reveal) {
    const w = st.reveal.winner
    body = (
      <>
        <View style={styles.center}>
          <Animated.View entering={FadeInUp.duration(260)} style={{ width: '100%', maxWidth: 520, gap: sp.md }}>
            <View style={[styles.answerCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Txt variant="muted" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                {t('games.quiz.answerWas')}
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 30, textAlign: 'center' }}>{st.reveal.answer}</Txt>
            </View>
            {w ? (
              <GradientBox colors={TEAM_GRADIENT[w]} radius={24} style={styles.winCard}>
                <Check size={26} color="#fff" strokeWidth={3} />
                <View style={{ flex: 1 }}>
                  <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 20 }}>
                    {w === myTeam ? t('games.quiz.weScored') : t('games.hangman.pointTo', { team: t(`games.team.${w}`) })}
                  </Txt>
                  <Txt style={{ color: 'rgba(255,255,255,0.9)' }}>{t('games.quiz.gotIt', { name: name(st.reveal.by) })}</Txt>
                </View>
              </GradientBox>
            ) : (
              <View style={[styles.winCard, { backgroundColor: c.surface, borderRadius: 24 }]}>
                <X size={24} color={c.textMuted} strokeWidth={3} />
                <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 16 }}>{t('games.quiz.nobody')}</Txt>
              </View>
            )}
          </Animated.View>
        </View>
        <GameBtn
          title={st.q >= st.total ? t('games.hangman.seeResult') : t('games.quiz.nextIn', { n: Math.ceil(left) })}
          icon={<SkipForward size={18} color="#fff" />}
          onPress={() => void games.quiz.next(session.id).catch(() => undefined)}
        />
      </>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.fit, { paddingBottom: gap }]}>
        <ScoreBoard scores={st.scores ?? { A: 0, B: 0 }} myTeam={myTeam} compact />
        {st.question && !waiting ? (
          <QuestionCard id={st.question.id} category={st.question.category} text={st.question.text} q={st.q} total={st.total} />
        ) : null}
        {body}
      </View>
      <Confetti fire={confetti} colors={TEAM_CONFETTI[myTeam]} />
      {st.last && st.last.at !== firstAttempt ? (
        <AttemptFlash key={st.last.at} text={st.last.text} correct={st.last.correct} timeout={st.last.timeout} name={name(st.last.email)} />
      ) : null}
      {/* The pie (owner, 2026-11-13): your team answered wrong, or the other
          team got it right — it's your face. A beat after the word shows. */}
      {st.last && st.last.at !== firstAttempt && (teamOf(st.last.email) === myTeam ? !st.last.correct : st.last.correct) ? (
        <DelayedPie key={`pie-${st.last.at}`} />
      ) : null}
    </KeyboardAvoidingView>
  )
}

/** "Get ready… 3" — the same second on every phone. Question 1 may wait a
 *  bit longer for a slow phone to load; then it says so. */
function GetReady({ n, first, team }: { n: number; first: boolean; team: Team }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const big = n <= 3
  return (
    <View style={styles.center}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 24, textAlign: 'center' }}>{t('games.quiz.getReady')}</Txt>
      {big ? (
        <Animated.View key={n} entering={ZoomIn.duration(240)}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 120, lineHeight: 132, color: TEAM_SOLID[team], textAlign: 'center' }}>{n}</Txt>
        </Animated.View>
      ) : (
        <ActivityIndicator size="large" color={TEAM_SOLID[team]} style={{ marginVertical: 40 }} />
      )}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center', color: c.textMuted }}>
        {big ? t('games.quiz.sameTime') : first ? t('games.quiz.waitingPhones') : t('games.quiz.sameTime')}
      </Txt>
    </View>
  )
}

/** "Patricia said 'Paris' ✗" — the attempt that just missed. */
function LastMiss({ last, name }: { last: NonNullable<QuizState['last']>; name: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <Animated.View key={last.at} entering={FadeIn.duration(200)} style={[styles.lastMiss, { backgroundColor: c.surface }]}>
      <X size={14} color="#E8506A" strokeWidth={3} />
      <Txt style={{ fontSize: 13.5, fontFamily: fonts.semibold, color: c.textMuted }} numberOfLines={1}>
        {last.timeout ? t('games.quiz.tooSlow', { name }) : t('games.quiz.said', { name, text: last.text })}
      </Txt>
    </Animated.View>
  )
}

/** The buzzer holder's answer. The mic turns on BY ITSELF the moment the
 *  buzzer is yours (owner, 2026-11: tapping it first cost seconds of a
 *  15-second clock): "turning the mic on…" with a spinner, then "speak now!"
 *  with a pulsing ring and what's being heard, large. Typing stays below —
 *  focusing it drops the mic. */
/** Silence after the last word that means "that's my answer". */
const SPOKEN_DONE_MS = 1300

function AnswerPanel({ sessionId, lang, team, left, total }: { sessionId: string; lang: string; team: Team; left: number; total: number }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  // A ref too: two paths can hand the same answer over in one tick.
  const sentRef = useRef(false)
  const canTalk = voiceSupported()
  const submit = useCallback(
    async (answer: string, alts: string[] = []) => {
      const a = answer.trim()
      if (!a || sentRef.current) return
      sentRef.current = true
      setSent(true)
      try {
        // The recogniser's other guesses ride along — the server accepts the
        // answer if any of them is right ("true" heard, "two" meant).
        await games.quiz.answer(sessionId, a, alts)
      } catch {
        sentRef.current = false
        setSent(false)
      }
    },
    [sessionId],
  )
  // Short-answer mode: the mic stays open through a pause to think (owner,
  // 2026-11: it closed after a few seconds of silence and cost a re-tap), and
  // a repeated word is folded ("borboleta borboleta").
  const voice = useVoice(lang, (heard, alts) => void submit(heard, alts), [], { short: true })
  const { start, stop, cancel } = voice
  const [typing, setTyping] = useState(false)
  // The answer is complete once the words stop changing for a moment — then
  // send it (stop → the hook hands over what it heard).
  // Whatever state the recogniser claims: Android (owner, 2026-11-13) showed
  // the heard answer and then sat until time ran out — its listen never
  // reported "listening", or never ended after stop(). So: words unchanged
  // for a moment → stop, and if the hook hasn't handed them over a beat
  // later, send what's on screen ourselves.
  useEffect(() => {
    const heard = voice.transcript.trim()
    if (!heard || sent || typing) return
    let late: ReturnType<typeof setTimeout> | undefined
    const id = setTimeout(() => {
      stop()
      late = setTimeout(() => {
        if (sentRef.current) return
        void submit(heard)
        cancel()
      }, 700)
    }, SPOKEN_DONE_MS)
    return () => {
      clearTimeout(id)
      if (late) clearTimeout(late)
    }
  }, [voice.transcript, sent, typing, stop, cancel, submit])
  // Safety net: the listen ended (any way at all) with words on screen and
  // nothing sent — send what's shown. What you see is what gets answered.
  const lastState = useRef(voice.state)
  useEffect(() => {
    const was = lastState.current
    lastState.current = voice.state
    const ended = (was === 'listening' || was === 'starting') && (voice.state === 'idle' || voice.state === 'error')
    if (ended && voice.transcript.trim() && !sentRef.current) void submit(voice.transcript)
  }, [voice.state, voice.transcript, submit])
  // Some recognisers still end on a long silence (older Android): reopen
  // quietly while there's time, unless they're typing instead.
  const leftRef = useRef(left)
  const wasLive = useRef(false)
  useEffect(() => {
    leftRef.current = left
  }, [left])
  useEffect(() => {
    if (voice.state === 'listening') wasLive.current = true
  }, [voice.state])
  useEffect(() => {
    // Only a listen that already went live and then ended — not the idle
    // before the first start.
    if (!canTalk || sent || typing || voice.state !== 'idle' || voice.transcript.trim() || !wasLive.current) return
    wasLive.current = false
    if (leftRef.current < 2) return
    const id = setTimeout(() => void start(), 250)
    return () => clearTimeout(id)
  }, [voice.state, voice.transcript, sent, typing, canTalk, start])
  // Listen straight away; stop when this panel goes (answered / time up).
  useEffect(() => {
    if (canTalk) void start()
    return () => cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per buzz
  }, [])
  const starting = voice.state === 'starting'
  const listening = voice.state === 'listening'
  const live = starting || listening

  let hint = t('games.quiz.tapToSpeak')
  if (sent) hint = t('games.quiz.checking')
  else if (starting) hint = t('games.quiz.micStarting')
  else if (listening) hint = t('games.quiz.speakNow')
  else if (voice.state === 'denied') hint = t('games.quiz.micDenied')
  else if (!canTalk) hint = ''

  return (
    <View style={[styles.center, { gap: sp.md }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 24, color: TEAM_SOLID[team] }}>{t('games.quiz.yourAnswer')}</Txt>
        <CountdownRing left={left} total={total} size={48} color={TEAM_SOLID[team]} track={c.surface2} />
      </View>
      {canTalk ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('games.quiz.speak')}
          disabled={sent}
          onPress={() => (live ? voice.stop() : void start())}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
        >
          <MicOrb colors={TEAM_GRADIENT[team]} listening={listening} starting={starting || sent} />
        </Pressable>
      ) : null}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center', color: listening ? TEAM_SOLID[team] : c.textMuted }}>{hint}</Txt>
      <View style={[styles.heard, { backgroundColor: c.sheet, borderColor: voice.transcript ? TEAM_SOLID[team] : c.border }]}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 26, textAlign: 'center', color: voice.transcript ? c.text : c.textFaint }} numberOfLines={2}>
          {voice.transcript || '…'}
        </Txt>
      </View>
      <View style={[styles.capsule, { backgroundColor: c.card, borderColor: text.trim() ? TEAM_SOLID[team] : c.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => {
            setTyping(true)
            cancel()
          }}
          placeholder={t('games.quiz.typeAnswer')}
          placeholderTextColor={c.textFaint}
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={() => void submit(text)}
          editable={!sent}
          style={{ flex: 1, fontSize: 17, color: c.text, paddingVertical: 0 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('games.quiz.send')}
          disabled={!text.trim() || sent}
          onPress={() => void submit(text)}
          style={[styles.capsuleBtn, { backgroundColor: text.trim() ? TEAM_SOLID[team] : c.surface2 }]}
        >
          <ArrowUp size={21} strokeWidth={2.6} color={text.trim() ? '#fff' : c.textFaint} />
        </Pressable>
      </View>
    </View>
  )
}

/** The mic: a team-gradient orb. Starting → a spinner in it; listening → two
 *  soft rings breathing out from it (calm, timed — no springs). */
function MicOrb({ colors, listening, starting }: { colors: readonly [string, string]; listening: boolean; starting: boolean }) {
  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.set(listening ? withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1) : withTiming(0, { duration: 200 }))
  }, [listening, pulse])
  const ring1 = useAnimatedStyle(() => ({ opacity: listening ? 0.45 * (1 - pulse.value) : 0, transform: [{ scale: 1 + pulse.value * 0.55 }] }))
  const ring2 = useAnimatedStyle(() => {
    const p = (pulse.value + 0.5) % 1
    return { opacity: listening ? 0.35 * (1 - p) : 0, transform: [{ scale: 1 + p * 0.55 }] }
  })
  return (
    <View style={styles.orbWrap}>
      <Animated.View pointerEvents="none" style={[styles.orbRing, { backgroundColor: colors[1] }, ring1]} />
      <Animated.View pointerEvents="none" style={[styles.orbRing, { backgroundColor: colors[1] }, ring2]} />
      <GradientBox colors={colors} radius={56} style={styles.mic}>
        {starting ? <ActivityIndicator color="#fff" size="large" /> : <Mic size={42} color="#fff" strokeWidth={2.2} />}
      </GradientBox>
    </View>
  )
}

const styles = StyleSheet.create({
  fit: { flex: 1, paddingHorizontal: sp.lg, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: sp.md },
  lastMiss: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, maxWidth: '90%' },
  answeringRing: { padding: 5, borderRadius: 60, borderWidth: 4 },
  teamPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  answerCard: { alignItems: 'center', gap: 6, padding: sp.lg, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth },
  winCard: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg },
  mic: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  orbWrap: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  orbRing: { position: 'absolute', width: 112, height: 112, borderRadius: 56 },
  heard: { alignSelf: 'stretch', minHeight: 64, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: sp.md, paddingVertical: 10, justifyContent: 'center' },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 58, borderRadius: 22, borderWidth: 1.5, paddingLeft: 16, paddingRight: 7, alignSelf: 'stretch' },
  capsuleBtn: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})

/** The pie, after a beat (the attempt's word shows first). */
function DelayedPie() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setOn(true), 550)
    return () => clearTimeout(id)
  }, [])
  return on ? <PieSplat /> : null
}
