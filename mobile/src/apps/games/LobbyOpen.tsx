// The waiting room of a game with NO teams (bingo): everyone in one list,
// each with a ready tick. The host starts once the others are ready — alone
// works too (a practice round).
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated'
import { Check, CircleHelp, Crown } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { games, GameRpcError, type GamePlayer, type GameSession } from '@/lib/games'
import { fonts, sheetRadius, sp, useTheme } from '@/theme/theme'
import { BingoCover } from './art/Covers'
import { HowToPlayBingo } from './bingo/HowToPlayBingo'
import { feedback } from './feedback'
import { COVER } from './look'
import { useMembers } from './members'
import { GameBtn, MemberChip } from './shared'

export function LobbyOpen({ session, players, me }: { session: GameSession; players: GamePlayer[]; me: string }) {
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
  const tint = COVER.bingo[1]

  const prev = useRef({ n: here.length, ready: here.filter((p) => p.ready).length })
  useEffect(() => {
    const ready = here.filter((p) => p.ready).length
    if (here.length > prev.current.n) feedback('pop')
    else if (ready > prev.current.ready) feedback('ready')
    prev.current = { n: here.length, ready }
  }, [here])

  const fail = (e: unknown) => Alert.alert(t(`games.err.${e instanceof GameRpcError ? e.code : 'network'}` as never))
  // Start keeps its spinner until the game replaces the lobby (see Lobby).
  const [starting, setStarting] = useState(false)
  async function start() {
    setStarting(true)
    try {
      await games.start(session.id)
    } catch (e) {
      setStarting(false)
      fail(e)
    }
  }
  async function ready() {
    feedback(mine?.ready ? 'tap' : 'ready')
    setBusy(true)
    try {
      await games.setReady(session.id, !mine?.ready)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const goal = session.settings?.goal === 'line' ? t('games.bingo.goalLine') : t('games.bingo.goalFull')
  const status = !allReady
    ? t('games.lobby.waitingReady', { n: others.filter((p) => !p.ready).length })
    : host
      ? others.length
        ? t('games.lobby.allSetHost')
        : t('games.bingo.lobbyAlone')
      : t('games.lobby.allSet', { name: name(session.host_email) })

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: sp.lg }}>
        <Txt style={styles.bigTitle}>{t('games.lobby.title')}</Txt>
        <Txt style={[styles.bigTitle, { color: c.textFaint }]}>{t('games.lobby.sub', { n: here.length })}</Txt>

        <GradientBox colors={COVER.bingo} radius={24} style={styles.banner}>
          <BingoCover />
          <View style={styles.bannerChip}>
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 13 }}>{goal}</Txt>
          </View>
        </GradientBox>

        <View style={[styles.list, { backgroundColor: c.card, borderColor: c.border }]}>
          <Txt style={[styles.label, { color: c.textMuted }]}>{t('games.bingo.everyone')}</Txt>
          <ScrollView contentContainerStyle={{ gap: sp.sm }} showsVerticalScrollIndicator={false}>
            {here.map((p) => (
              <Animated.View key={p.email} entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={LinearTransition.duration(200)}>
                <MemberChip
                  email={p.email}
                  label={p.email === me ? t('games.you') : name(p.email)}
                  avatarPath={avatar(p.email)}
                  highlight={p.email === me ? tint : undefined}
                  trailing={
                    p.email === session.host_email ? (
                      <Crown size={16} color="#E0A100" />
                    ) : p.ready ? (
                      <Animated.View entering={ZoomIn} style={[styles.tick, { backgroundColor: tint }]}>
                        <Check size={13} color="#fff" strokeWidth={3} />
                      </Animated.View>
                    ) : (
                      <View style={[styles.tick, { borderWidth: 2, borderColor: c.border }]} />
                    )
                  }
                />
              </Animated.View>
            ))}
          </ScrollView>
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
          <HowToPlayBingo />
          <GameBtn title={t('games.how.gotIt')} colors={COVER.bingo} onPress={() => setHow(false)} curveBottom />
        </View>
      </Modal>

      <View style={[styles.dock, { paddingBottom: gap, borderTopColor: c.border, backgroundColor: c.bg }]}>
        <Txt variant="muted" style={{ textAlign: 'center', marginBottom: sp.sm }}>
          {status}
        </Txt>
        {host ? (
          <GameBtn title={t('games.lobby.start')} colors={COVER.bingo} disabled={!allReady || starting} loading={starting} onPress={() => void start()} curveBottom />
        ) : (
          <GameBtn
            title={mine?.ready ? t('games.lobby.notReady') : t('games.lobby.ready')}
            variant={mine?.ready ? 'secondary' : 'primary'}
            colors={COVER.bingo}
            disabled={busy}
            onPress={() => void ready()}
            curveBottom
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  banner: { height: 120, marginTop: sp.lg, overflow: 'hidden' },
  bannerChip: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  list: { flex: 1, marginTop: sp.lg, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: sp.md },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.md },
  howBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', marginVertical: sp.md, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  howSheet: { width: '100%', maxWidth: 620, alignSelf: 'center', gap: sp.md, padding: sp.md, borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dock: { paddingHorizontal: sp.lg, paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth },
})
