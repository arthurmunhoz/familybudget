// The waiting room: two team columns (side by side at every width — a family
// fits), each player with avatar and a ready tick. You tap the other team to
// switch, then "I'm ready". The host starts once everyone's ready and both
// teams have someone. Joining, switching and readying all chime for everyone.
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated'
import { Check, CircleHelp, Crown } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { games, GameRpcError, teamOf, type GamePlayer, type GameSession, type Team } from '@/lib/games'
import { fonts, sheetRadius, sp, useTheme } from '@/theme/theme'
import { feedback } from './feedback'
import { TEAM_GRADIENT, TEAM_SOLID } from './look'
import { useMembers } from './members'
import { HowToPlayBattleship } from './battleship/HowToPlayBattleship'
import { HowToPlayQuiz } from './quiz/HowToPlayQuiz'
import { HowToPlay } from './hangman/HowToPlay'
import { GameBtn, MemberChip, MyTeamBanner } from './shared'

export function Lobby({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { name, avatar } = useMembers()
  const gap = useBottomGap(sp.lg)
  const [busy, setBusy] = useState(false)
  const [how, setHow] = useState(false)
  const here = players.filter((p) => !p.left_at)
  const mine = here.find((p) => p.email === me)
  const host = session.host_email === me
  const others = here.filter((p) => p.email !== session.host_email)
  const allReady = others.every((p) => p.ready)
  const bothTeams = teamOf(here, 'A').length > 0 && teamOf(here, 'B').length > 0
  const canStart = host && allReady && bothTeams

  // Chime when someone arrives or gets ready (not for my own taps — those
  // already gave feedback).
  const prev = useRef({ n: here.length, ready: here.filter((p) => p.ready).length })
  useEffect(() => {
    const ready = here.filter((p) => p.ready).length
    if (here.length > prev.current.n) feedback('pop')
    else if (ready > prev.current.ready) feedback('ready')
    prev.current = { n: here.length, ready }
  }, [here])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      const code = e instanceof GameRpcError ? e.code : 'network'
      Alert.alert(t(`games.err.${code}` as never))
    } finally {
      setBusy(false)
    }
  }

  // Start keeps its spinner until the game screen replaces the lobby: on a
  // slower phone (the Galaxy) the switch takes a moment, and a button that
  // went back to normal read as "nothing happened" (owner, 2026-11).
  const [starting, setStarting] = useState(false)
  async function start() {
    setStarting(true)
    try {
      await games.start(session.id)
    } catch (e) {
      setStarting(false)
      const code = e instanceof GameRpcError ? e.code : 'network'
      Alert.alert(t(`games.err.${code}` as never))
    }
  }

  function switchTo(team: Team) {
    if (!mine || mine.team === team) return
    feedback('pop')
    void act(() => games.setTeam(session.id, team))
  }

  const status = !bothTeams
    ? t('games.lobby.needTeams')
    : !allReady
      ? t('games.lobby.waitingReady', { n: others.filter((p) => !p.ready).length })
      : host
        ? t('games.lobby.allSetHost')
        : t('games.lobby.allSet', { name: name(session.host_email) })

  return (
    <View style={{ flex: 1 }}>
      {/* Fits the screen — no scrolling anywhere in the game (owner, 2026-11).
          The team columns take the leftover height; the rules open in a sheet. */}
      <View style={{ flex: 1, paddingHorizontal: sp.lg }}>
        <Txt style={styles.bigTitle}>{t('games.lobby.title')}</Txt>
        <Txt style={[styles.bigTitle, { color: c.textFaint }]}>{t('games.lobby.sub', { n: here.length })}</Txt>

        {mine?.team ? (
          <View style={{ marginTop: sp.lg }}>
            <MyTeamBanner team={mine.team} />
          </View>
        ) : null}
        <View style={[styles.cols, { marginTop: sp.lg, flex: 1 }]}>
          {(['A', 'B'] as Team[]).map((team) => {
            const list = teamOf(here, team)
            const joinable = !!mine && mine.team !== team
            return (
              <Pressable
                key={team}
                accessibilityRole="button"
                accessibilityLabel={t('games.lobby.joinTeam', { team: t(`games.team.${team}`) })}
                disabled={!joinable}
                onPress={() => switchTo(team)}
                style={({ pressed }) => [
                  styles.col,
                  mine?.team === team
                    ? { backgroundColor: c.card, borderColor: TEAM_SOLID[team], borderWidth: 2 }
                    : { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 0.6 },
                ]}
              >
                <GradientBox colors={TEAM_GRADIENT[team]} radius={18} style={styles.colHead}>
                  <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 19 }}>{t(`games.team.${team}`)}</Txt>
                  <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{t('games.lobby.players', { n: list.length })}</Txt>
                </GradientBox>
                <View style={{ gap: sp.sm, padding: sp.sm }}>
                  {list.map((p) => (
                    <Animated.View key={p.email} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
                      <MemberChip
                        email={p.email}
                        label={p.email === me ? t('games.you') : name(p.email)}
                        avatarPath={avatar(p.email)}
                        highlight={p.email === me ? TEAM_SOLID[team] : undefined}
                        trailing={
                          p.email === session.host_email ? (
                            <Crown size={16} color="#E0A100" />
                          ) : p.ready ? (
                            <Animated.View entering={ZoomIn} style={[styles.tick, { backgroundColor: TEAM_SOLID[team] }]}>
                              <Check size={13} color="#fff" strokeWidth={3} />
                            </Animated.View>
                          ) : (
                            <View style={[styles.tick, { borderWidth: 2, borderColor: c.border }]} />
                          )
                        }
                      />
                    </Animated.View>
                  ))}
                  {joinable ? (
                    <Animated.View entering={FadeIn} style={[styles.joinHint, { borderColor: TEAM_SOLID[team] }]}>
                      <Txt style={{ color: TEAM_SOLID[team], fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.lobby.tapToJoin')}</Txt>
                    </Animated.View>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setHow(true)}
          style={({ pressed }) => [styles.howBtn, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
        >
          <CircleHelp size={18} color={c.accent} />
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5 }}>{t('games.how.title')}</Txt>
        </Pressable>
      </View>
      <Modal visible={how} transparent animationType="slide" onRequestClose={() => setHow(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setHow(false)} accessibilityLabel={t('common.close')} />
        <View style={[styles.howSheet, { backgroundColor: c.sheet, paddingBottom: gap }]}>
          {session.game === 'battleship' ? <HowToPlayBattleship /> : session.game === 'quiz' ? <HowToPlayQuiz /> : <HowToPlay />}
          <GameBtn title={t('games.how.gotIt')} onPress={() => setHow(false)} curveBottom />
        </View>
      </Modal>

      <View style={[styles.dock, { paddingBottom: gap, borderTopColor: c.border, backgroundColor: c.bg }]}>
        <Txt variant="muted" style={{ textAlign: 'center', marginBottom: sp.sm }}>
          {status}
        </Txt>
        {host ? (
          <GameBtn
            title={t('games.lobby.start')}
            disabled={!canStart || busy || starting}
            loading={busy || starting}
            onPress={() => void start()}
            curveBottom
          />
        ) : (
          <GameBtn
            title={mine?.ready ? t('games.lobby.notReady') : t('games.lobby.ready')}
            variant={mine?.ready ? 'secondary' : 'primary'}
            disabled={busy}
            onPress={() => {
              feedback(mine?.ready ? 'tap' : 'ready')
              void act(() => games.setReady(session.id, !mine?.ready))
            }}
            curveBottom
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  cols: { flexDirection: 'row', gap: sp.md, alignItems: 'stretch' },
  col: { flex: 1, alignSelf: 'stretch', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 6 },
  howBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', marginVertical: sp.md, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  howSheet: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: sp.md, padding: sp.md, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius },
  colHead: { paddingVertical: sp.md, paddingHorizontal: sp.md, gap: 2 },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  joinHint: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 12, alignItems: 'center' },
  dock: { paddingHorizontal: sp.lg, paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth },
})
