// One game room: follows the session live and shows the lobby, the game, or
// the final scoreboard. Opening a room you're not in (a shared link, a push
// later) joins you automatically while it's still in the lobby.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import Animated, { FadeInUp, ZoomIn } from 'react-native-reanimated'
import { Crown, DoorOpen, Trophy, WifiOff } from 'lucide-react-native'

import { Loader, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useOnScreen } from '@/lib/onScreen'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { games, useGameRoom, type GameSession, type Team } from '@/lib/games'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { Confetti } from './art/Confetti'
import { feedback, preloadSounds } from './feedback'
import { Battleship } from './battleship/Battleship'
import { Quiz } from './quiz/Quiz'
import { Hangman } from './hangman/Hangman'
import { Lobby } from './Lobby'
import { useMembers } from './members'
import { GAMES_GRADIENT, TEAM_CONFETTI, TEAM_GRADIENT } from './look'
import { GameBtn, GameTopBar, LeaveSheet, TeamWash } from './shared'

const TITLE: Record<string, TKey> = { hangman: 'games.hangman', battleship: 'games.battleship', quiz: 'games.quiz' }

export function Room({ id }: { id: string }) {
  useOnScreen('games')
  const { c } = useTheme()
  const { t } = useI18n()
  const { session: auth } = useAuth()
  const me = auth?.user.email ?? ''
  const { session, players, missing, online } = useGameRoom(id, me)
  const joining = useRef(false)
  // Load every game sound now, so the first one doesn't play late.
  useEffect(() => preloadSounds(), [])

  const mine = players.find((p) => p.email === me && !p.left_at)
  const myTeam = session?.mode === 'async' ? undefined : (mine?.team ?? undefined)
  useEffect(() => {
    if (!session || mine || joining.current || session.status !== 'lobby' || !players.length) return
    joining.current = true
    void games.join(id).catch(() => undefined)
  }, [session, mine, players.length, id])

  const [confirmLeave, setConfirmLeave] = useState(false)
  const hostLobby = !!session && session.host_email === me && session.status === 'lobby'
  function leave() {
    if (!session || session.mode === 'async' || session.status === 'done' || session.status === 'cancelled') {
      if (router.canGoBack()) router.back()
      else router.replace('/games')
      return
    }
    setConfirmLeave(true)
  }

  const leaveRef = useRef(leave)
  useEffect(() => {
    leaveRef.current = leave
  })

  async function doLeave() {
    setConfirmLeave(false)
    await games.leave(id).catch(() => undefined)
    if (router.canGoBack()) router.back()
    else router.replace('/games')
  }

  // Android's back button asks too, instead of dropping you out of a game.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        leaveRef.current()
        return true
      })
      return () => sub.remove()
    }, []),
  )

  let body: React.ReactNode
  if (missing) body = <Ended text={t('games.err.game_not_found')} />
  else if (!session) body = <Loader />
  // A sent hangman is always its own one-round screen, finished or not.
  else if (session.mode === 'async') body = <Hangman session={session} players={players} me={me} />
  else if (session.status === 'lobby') body = <Lobby session={session} players={players} me={me} />
  else if (session.status === 'playing') {
    body =
      session.game === 'hangman' ? (
        <Hangman session={session} players={players} me={me} />
      ) : session.game === 'battleship' ? (
        <Battleship session={session} players={players} me={me} />
      ) : session.game === 'quiz' ? (
        <Quiz session={session} players={players} me={me} />
      ) : null
  } else if (session.status === 'cancelled') body = <Ended text={t('games.cancelled')} />
  else body = <GameOver session={session} myTeam={players.find((p) => p.email === me)?.team ?? undefined} />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {/* Your team's glow from the very top (behind status bar + top bar). */}
      <TeamWash team={myTeam} />
      <View style={styles.wrap}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <GameTopBar
            title={session ? t(TITLE[session.game]) : ''}
            onBack={leave}
            exitLabel={session && session.mode === 'live' && (session.status === 'lobby' || session.status === 'playing') ? t('games.exitShort') : undefined}
          />
        </View>
        {session?.status === 'playing' && session.mode === 'live' && online ? (
          <AwayBanner away={players.filter((p) => !p.left_at && p.email !== me && !online.has(p.email)).map((p) => p.email)} />
        ) : null}
        {body}
      </View>
      <LeaveSheet
        visible={confirmLeave}
        title={t(hostLobby ? 'games.leaveHostTitle' : 'games.leaveTitle')}
        body={t(session?.status === 'playing' ? 'games.leavePlaying' : 'games.leaveLobby')}
        confirm={t(hostLobby ? 'games.closeRoom' : 'games.exitRoom')}
        onConfirm={() => void doLeave()}
        onClose={() => setConfirmLeave(false)}
      />
    </SafeAreaView>
  )
}

function Ended({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: sp.lg }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 24, textAlign: 'center' }}>{text}</Txt>
      <GameBtn title={t('games.backToGames')} onPress={() => router.replace('/games')} />
    </View>
  )
}

/** A team's final score: same size for both teams (owner, 2026-11: the
 *  "You" chip made one card taller). The tag and the crown float on the
 *  card's corners instead of taking a row; the losing side is faded. */
function FinalScore({ team, score, mine, winner, faded }: { team: Team; score: number; mine: boolean; winner: boolean; faded: boolean }) {
  const { t } = useI18n()
  return (
    <View style={{ flex: 1, opacity: faded ? 0.5 : 1 }}>
      <GradientBox colors={TEAM_GRADIENT[team]} radius={26} style={styles.final}>
        <View pointerEvents="none" style={styles.finalBlob} />
        {winner ? (
          <View style={styles.crown}>
            <Crown size={16} color="#fff" strokeWidth={2.4} />
          </View>
        ) : null}
        {mine ? (
          <View style={styles.finalYou}>
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6 }}>{t('games.you').toUpperCase()}</Txt>
          </View>
        ) : null}
        <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 54, lineHeight: 60 }}>{score}</Txt>
        <Txt style={{ color: 'rgba(255,255,255,0.92)', fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
          {t(`games.team.${team}`)}
        </Txt>
      </GradientBox>
    </View>
  )
}

/** Someone's phone dropped out of the room (presence) for a while — likely
 *  no connection. Shown only after a grace period so a blip doesn't flash. */
function AwayBanner({ away }: { away: string[] }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { name } = useMembers()
  const key = away.join(',')
  const [shownFor, setShownFor] = useState('')
  useEffect(() => {
    if (!key) return
    const id = setTimeout(() => setShownFor(key), AWAY_GRACE_MS)
    return () => clearTimeout(id)
  }, [key])
  if (!key || shownFor !== key) return null
  const names = away.map((e) => name(e)).join(', ')
  return (
    <Animated.View entering={FadeInUp.duration(220)} style={[styles.away, { backgroundColor: c.sheet, borderColor: c.border }]}>
      <WifiOff size={18} color="#E04A63" />
      <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 14 }} numberOfLines={2}>
        {t(away.length > 1 ? 'games.awayMany' : 'games.away', { names })}
      </Txt>
    </Animated.View>
  )
}

const AWAY_GRACE_MS = 8000

function GameOver({ session, myTeam }: { session: GameSession; myTeam?: Team | null }) {
  const { t, lang } = useI18n()
  const { name } = useMembers()
  const leftBy = session.state.ended === 'abandoned' ? session.state.left_by : undefined
  const gap = useBottomGap(sp.lg)
  const scores = session.state.scores ?? { A: 0, B: 0 }
  const tie = scores.A === scores.B
  const winner: Team = scores.A > scores.B ? 'A' : 'B'
  const abandoned = session.state.ended === 'abandoned' || session.state.ended === 'cancelled' || session.state.ended === 'expired'
  const won = !tie && !abandoned && myTeam === winner
  useEffect(() => {
    // The results get applause, for everyone — no chime (owner, 2026-11).
    if (!abandoned) feedback('applause')
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, padding: sp.lg, gap: sp.lg, justifyContent: 'center' }}>
        <Animated.View entering={ZoomIn.duration(240)} style={{ alignItems: 'center' }}>
          <GradientBox colors={tie || abandoned ? GAMES_GRADIENT : TEAM_GRADIENT[winner]} radius={60} style={styles.trophy}>
            {leftBy ? <DoorOpen size={52} color="#fff" strokeWidth={1.8} /> : <Trophy size={56} color="#fff" strokeWidth={1.8} />}
          </GradientBox>
        </Animated.View>
        <Animated.View entering={FadeInUp.delay(150).duration(240)} style={{ gap: 6 }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 32, textAlign: 'center', lineHeight: 38 }}>
            {session.state.ended === 'expired' ? t('games.over.expired') : abandoned ? t('games.over.ended') : tie ? t('games.over.tie') : t('games.over.wins', { team: t(`games.team.${winner}`) })}
          </Txt>
          {leftBy ? (
            <Txt variant="muted" style={{ textAlign: 'center', fontSize: 16 }}>
              {t('games.over.leftBy', { name: name(leftBy) })}
            </Txt>
          ) : null}
          {!abandoned && !tie ? (
            <Txt variant="muted" style={{ textAlign: 'center' }}>
              {won ? t('games.over.youWon') : t('games.over.nextTime')}
            </Txt>
          ) : null}
        </Animated.View>
        <Animated.View entering={FadeInUp.delay(300).duration(240)} style={{ flexDirection: 'row', gap: sp.md }}>
          {(['A', 'B'] as const).map((tm) => (
            <FinalScore
              key={tm}
              team={tm}
              score={scores[tm]}
              mine={myTeam === tm}
              winner={!tie && !abandoned && winner === tm}
              faded={!tie && !abandoned && winner !== tm}
            />
          ))}
        </Animated.View>
      </View>
      <View style={{ paddingHorizontal: sp.lg, paddingBottom: gap, gap: sp.sm }}>
        <GameBtn
          title={t('games.over.again')}
          onPress={async () => {
            try {
              const id = await games.create(session.game, lang, session.settings)
              feedback('pop')
              router.replace(`/games/${id}`)
            } catch {
              Alert.alert(t('games.err.network'))
            }
          }}
        />
        <GameBtn title={t('games.backToGames')} variant="secondary" onPress={() => router.replace('/games')} curveBottom />
      </View>
      <Confetti fire={won || tie ? 1 : 0} colors={won ? TEAM_CONFETTI[winner] : undefined} />
    </View>
  )
}

const styles = StyleSheet.create({
  away: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: sp.lg, marginBottom: sp.sm, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  final: { height: 132, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  finalBlob: { position: 'absolute', width: 140, height: 140, borderRadius: 70, right: -50, top: -60, backgroundColor: 'rgba(255,255,255,0.14)' },
  crown: { position: 'absolute', top: 10, left: 10, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.25)' },
  finalYou: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.28)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  wrap: { flex: 1, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  trophy: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
})
