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
import { QuestionCard } from './QuestionCard'

/** Seconds left on the server's clock for `deadline`, ticking every 100 ms. */
function useCountdown(deadline: string | undefined, serverNow: string | undefined) {
  const offset = useRef(0)
  useEffect(() => {
    if (serverNow) offset.current = Date.parse(serverNow) - Date.now()
  }, [serverNow])
  const calc = useCallback(() => (deadline ? Math.max(0, (Date.parse(deadline) - (Date.now() + offset.current)) / 1000) : 0), [deadline])
  const [left, setLeft] = useState(25)
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
  const { left, now: secondsLeftNow } = useCountdown(st.deadline, st.now)
  const phase = st.phase
  const locked = (st.locked ?? []).includes(me)
  const iAnswer = phase === 'answering' && st.buzz?.email === me
  // The attempt already on screen when you open the game isn't news: only
  // attempts that land while you watch get the big flash.
  const [firstAttempt] = useState(st.last?.at)
  const total = phase === 'answering' ? 15 : phase === 'reveal' ? 6 : 25

  useEffect(() => preloadSounds(['buzzer', 'correct', 'wrong', 'tick', 'ready', 'win', 'miss', 'tap']), [])

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
    if (st.q !== s.q) feedback('ready')
    else if (st.buzz?.at && st.buzz.at !== s.buzz) feedback('buzzer')
    if (st.last?.at && st.last.at !== s.last && !st.last.correct) feedback('wrong')
    if (phase === 'reveal' && s.phase !== 'reveal') {
      if (st.reveal?.winner) {
        feedback('correct')
      } else feedback('miss')
    }
    seen.current = { q: st.q, buzz: st.buzz?.at, last: st.last?.at, phase }
  }, [st.q, st.buzz?.at, st.last, phase, st.reveal, myTeam])

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
  if (phase === 'question') {
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
        {st.question ? (
          <QuestionCard id={st.question.id} category={st.question.category} text={st.question.text} q={st.q} total={st.total} />
        ) : null}
        {body}
      </View>
      <Confetti fire={confetti} colors={TEAM_CONFETTI[myTeam]} />
      {st.last && st.last.at !== firstAttempt ? (
        <AttemptFlash key={st.last.at} text={st.last.text} correct={st.last.correct} timeout={st.last.timeout} name={name(st.last.email)} />
      ) : null}
    </KeyboardAvoidingView>
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
  const canTalk = voiceSupported()
  const submit = useCallback(
    async (answer: string, alts: string[] = []) => {
      const a = answer.trim()
      if (!a || sent) return
      setSent(true)
      try {
        // The recogniser's other guesses ride along — the server accepts the
        // answer if any of them is right ("true" heard, "two" meant).
        await games.quiz.answer(sessionId, a, alts)
      } catch {
        setSent(false)
      }
    },
    [sessionId, sent],
  )
  // Short-answer mode: the mic stays open through a pause to think (owner,
  // 2026-11: it closed after a few seconds of silence and cost a re-tap), and
  // a repeated word is folded ("borboleta borboleta").
  const voice = useVoice(lang, (heard, alts) => void submit(heard, alts), [], { short: true })
  const { start, stop, cancel } = voice
  const [typing, setTyping] = useState(false)
  // The answer is complete once the words stop changing for a moment — then
  // send it (stop → the hook hands over what it heard).
  useEffect(() => {
    if (voice.state !== 'listening' || !voice.transcript.trim() || sent) return
    const id = setTimeout(() => stop(), SPOKEN_DONE_MS)
    return () => clearTimeout(id)
  }, [voice.transcript, voice.state, sent, stop])
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
