// Games — the hub app's home. Big title in the Home's language, the household's
// open rooms on top (tap to join — that's how the family gathers), then the
// games as illustrated cards. Starting a game opens a small sheet (rounds) and
// creates a LIVE room; everyone else sees it appear here over Realtime.
//
// Hangman is live in this release; Battleship and the buzzer Quiz are shown as
// "coming soon" so the family sees what's next.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { ChevronRight, Send, Users } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { RoofExamples } from '@/components/RoofExamples'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useOnScreen } from '@/lib/onScreen'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { games, GameRpcError, useChallenges, useOpenGames, type GameKind, type GamePlayer, type GameSession, type Room } from '@/lib/games'
import { Avatar } from '@/apps/family/Avatar'
import type { TKey } from '@/lib/i18n'
import { fonts, sheetRadius, sp, useTheme } from '@/theme/theme'
import { BattleshipCover, BingoCover, HangmanCover, QuizCover } from './art/Covers'
import { feedback } from './feedback'
import { GAME_ACTION_SOLID, COVER } from './look'
import { useMembers } from './members'
import { GameBtn, GameTopBar } from './shared'

interface GameCard {
  id: GameKind
  title: TKey
  sub: TKey
  colors: Gradient
  Cover: () => React.ReactElement
  soon?: boolean
}

const CARDS: GameCard[] = [
  { id: 'hangman', title: 'games.hangman', sub: 'games.hangmanSub', colors: COVER.hangman, Cover: HangmanCover },
  { id: 'battleship', title: 'games.battleship', sub: 'games.battleshipSub', colors: COVER.battleship, Cover: BattleshipCover },
  { id: 'quiz', title: 'games.quiz', sub: 'games.quizSub', colors: COVER.quiz, Cover: QuizCover },
  { id: 'bingo', title: 'games.bingo', sub: 'games.bingoSub', colors: COVER.bingo, Cover: BingoCover },
]

const GAME_TITLE: Record<GameKind, TKey> = { hangman: 'games.hangman', battleship: 'games.battleship', quiz: 'games.quiz', bingo: 'games.bingo' }

export function GamesHub() {
  useOnScreen('games')
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { width } = useWindowDimensions()
  const { rooms } = useOpenGames()
  const { session } = useAuth()
  const me = session?.user.email
  const { forMe, sent, played } = useChallenges(me)
  const [creating, setCreating] = useState<GameKind | null>(null)
  // `?start=quiz` (from Roof: "start a match of …") opens that game's sheet.
  const { start } = useLocalSearchParams<{ start?: string }>()
  useEffect(() => {
    if (start === 'hangman' || start === 'battleship' || start === 'quiz' || start === 'bingo') setCreating(start as GameKind)
  }, [start])
  // Phones: one card per row. Tablets/Mac: two or three.
  const cols = width >= 1100 ? 3 : width >= 700 ? 2 : 1

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={styles.wrap}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <GameTopBar
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            right={<RoofExamples variant="pill" examples={['roofEx.games.1', 'roofEx.games.2', 'roofEx.games.6']} />}
          />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl * 2 }}>
          <Txt style={styles.bigTitle}>{t('games.title')}</Txt>
          <Txt style={[styles.bigTitle, { color: c.textFaint }]}>
            {rooms.length ? t('games.roomsOpen', { n: rooms.length }) : t('games.tagline')}
          </Txt>

          {forMe.length || sent.length || played.length ? (
            <View style={{ marginTop: sp.xl }}>
              <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t('games.send.section')}</Txt>
              <View style={[styles.group, { backgroundColor: c.card, borderColor: c.border }]}>
                {[...forMe, ...sent, ...played].slice(0, 8).map((r, i) => (
                  <ChallengeRow key={r.id} room={r} me={me ?? ''} first={i === 0} />
                ))}
              </View>
            </View>
          ) : null}

          {rooms.length ? (
            <View style={{ marginTop: sp.xl }}>
              <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t('games.openRooms')}</Txt>
              <View style={[styles.group, { backgroundColor: c.card, borderColor: c.border }]}>
                {rooms.map((r, i) => (
                  <RoomRow key={r.id} room={r} first={i === 0} title={t(GAME_TITLE[r.game])} />
                ))}
              </View>
            </View>
          ) : null}

          <Txt style={[styles.sectionLabel, { color: c.textMuted, marginTop: sp.xl }]}>{t('games.pick')}</Txt>
          <View style={[styles.grid, { gap: sp.md }]}>
            {CARDS.map((g, i) => (
              <Animated.View
                key={g.id}
                entering={FadeInDown.delay(80 * i).duration(240)}
                style={{ width: cols === 1 ? '100%' : `${100 / cols - 2}%`, flexGrow: 1 }}
              >
                <GameCardView
                  card={g}
                  onPress={() => {
                    if (g.soon) {
                      Alert.alert(t(g.title), t('games.soonBody'))
                      return
                    }
                    feedback('tap')
                    setCreating(g.id)
                  }}
                />
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      </View>
      <CreateSheet
        game={creating}
        onClose={() => setCreating(null)}
        onCreate={async (rounds, bingo) => {
          if (!creating) return
          const settings = creating === 'bingo' ? bingo : creating === 'quiz' ? { questions: rounds } : { rounds }
          const open = async (replace: boolean) => {
            const id = await games.create(creating, lang, settings, replace)
            setCreating(null)
            feedback('pop')
            router.push(`/games/${id}`)
          }
          try {
            await open(false)
          } catch (e) {
            // One open room per person: offer to close the other one.
            if (e instanceof GameRpcError && e.code === 'has_room') {
              Alert.alert(t('games.hasRoom.title'), t('games.hasRoom.body'), [
                { text: t('games.hasRoom.keep'), style: 'cancel' },
                { text: t('games.hasRoom.replace'), style: 'destructive', onPress: () => void open(true).catch(() => Alert.alert(t('games.err.network'))) },
              ])
            } else Alert.alert(t('games.err.network'))
          }
        }}
      />
    </SafeAreaView>
  )
}

function GameCardView({ card, onPress }: { card: GameCard; onPress: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { Cover } = card
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(card.title)}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      <GradientBox colors={card.colors} radius={22} style={styles.cover}>
        <Cover />
        {card.soon ? (
          <View style={styles.soon}>
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 12 }}>{t('games.soon')}</Txt>
          </View>
        ) : null}
      </GradientBox>
      <View style={{ paddingHorizontal: sp.sm, paddingTop: sp.md, paddingBottom: sp.xs, gap: 2 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 21, color: c.text }}>{t(card.title)}</Txt>
        <Txt variant="muted" style={{ fontSize: 14 }}>
          {t(card.sub)}
        </Txt>
      </View>
    </Pressable>
  )
}

function RoomRow({ room, first, title }: { room: GameSession & { players: GamePlayer[] }; first: boolean; title: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { session } = useAuth()
  const { name } = useMembers()
  const me = session?.user.email
  const here = room.players.filter((p) => !p.left_at)
  const mine = here.some((p) => p.email === me)
  const playing = room.status === 'playing'
  const [busy, setBusy] = useState(false)
  async function open() {
    if (playing && !mine) {
      Alert.alert(t('games.err.game_started'))
      return
    }
    setBusy(true)
    try {
      if (!mine) await games.join(room.id)
      feedback('pop')
      router.push(`/games/${room.id}`)
    } catch {
      Alert.alert(t('games.err.network'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.roomRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }, { opacity: pressed ? 0.7 : 1 }]}
    >
      <GradientBox colors={COVER[room.game]} radius={14} style={styles.roomIcon}>
        <Users size={20} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 16 }}>
          {title} · {t('games.roomBy', { name: name(room.host_email) })}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 13.5 }} numberOfLines={1}>
          {playing ? t('games.roomPlaying') : t('games.roomWaiting', { n: here.length })} · {here.map((p) => name(p.email)).join(', ')}
        </Txt>
      </View>
      {busy ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <View style={[styles.joinPill, { backgroundColor: mine ? c.surface : GAME_ACTION_SOLID }]}>
          <Txt style={{ color: mine ? c.text : c.onAction, fontFamily: fonts.semibold, fontSize: 13.5 }}>
            {mine ? t('games.back') : t('games.join')}
          </Txt>
          <ChevronRight size={14} color={mine ? c.text : c.onAction} />
        </View>
      )}
    </Pressable>
  )
}

/** One sent hangman in the Games list: waiting for me, waiting for them, or
 *  the result (✓ guessed / 🏠 house finished). */
function ChallengeRow({ room, me, first }: { room: Room; me: string; first: boolean }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { name, avatar } = useMembers()
  const st = room.state
  const iSent = room.host_email === me
  const other = iSent ? (st.guesser ?? '') : room.host_email
  const waitingForMe = !iSent && room.status === 'playing'
  const line =
    room.status === 'playing'
      ? iSent
        ? t('games.send.waitingFor', { name: name(other) })
        : t('games.send.fromName', { name: name(other) })
      : st.solved
        ? iSent
          ? t('games.send.theyGotIt', { name: name(other) })
          : t('games.send.youGotIt')
        : iSent
          ? t('games.send.theyMissed', { name: name(other) })
          : t('games.send.youMissed')
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/games/${room.id}`)}
      style={({ pressed }) => [styles.roomRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Avatar name={name(other)} avatarPath={avatar(other)} size={42} />
      <View style={{ flex: 1 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }} numberOfLines={1}>
          {line}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
          {room.status === 'done' && st.word ? st.word.toUpperCase() : st.category ? t(`games.cat.${st.category}` as never) : t('games.hangman.freeWord')}
        </Txt>
      </View>
      {waitingForMe ? (
        <View style={[styles.joinPill, { backgroundColor: GAME_ACTION_SOLID }]}>
          <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.send.play')}</Txt>
          <ChevronRight size={14} color={c.onAction} />
        </View>
      ) : (
        <ChevronRight size={18} color={c.textMuted} />
      )}
    </Pressable>
  )
}

const ROUND_OPTIONS = [4, 6, 8, 10]
const QUESTION_OPTIONS = [5, 10, 15, 20]

const BINGO_GOALS = [
  { id: 'line', title: 'games.bingo.optLine', sub: 'games.bingo.optLineSub' },
  { id: 'full', title: 'games.bingo.optFull', sub: 'games.bingo.optFullSub' },
] as const
const BINGO_PACES = [
  { id: 'calm', title: 'games.bingo.paceCalm' },
  { id: 'normal', title: 'games.bingo.paceNormal' },
  { id: 'fast', title: 'games.bingo.paceFast' },
] as const
type BingoSettings = { goal: 'line' | 'full'; pace: 'calm' | 'normal' | 'fast' }

function CreateSheet({ game, onClose, onCreate }: { game: GameKind | null; onClose: () => void; onCreate: (rounds: number, bingo: BingoSettings) => Promise<void> }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const gap = useBottomGap(sp.lg)
  // Rounds (hangman) or questions (quiz); each game has its own default.
  const [pick, setPick] = useState<number | null>(null)
  const count = pick ?? (game === 'quiz' ? 10 : 6)
  const [busy, setBusy] = useState(false)
  const [bingo, setBingo] = useState<BingoSettings>({ goal: 'line', pace: 'normal' })
  const theme = game ? COVER[game][1] : GAME_ACTION_SOLID
  return (
    <Modal visible={!!game} transparent animationType="slide" onRequestClose={onClose}>
      {/* The dim covers the WHOLE screen, sheet included: ending it where the
          sheet starts left the page showing, undimmed, beside the sheet's
          rounded corners — a light band that read as a broken shadow
          (owner, 2026-11-13). */}
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel={t('common.cancel')} />
      <View style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: gap }]}>
        <View style={[styles.grabber, { backgroundColor: c.border }]} />
        {game ? (
          <GradientBox colors={COVER[game]} radius={22} style={{ height: 130, marginBottom: sp.lg }}>
            {game === 'hangman' ? <HangmanCover /> : game === 'battleship' ? <BattleshipCover /> : game === 'quiz' ? <QuizCover /> : game === 'bingo' ? <BingoCover /> : null}
          </GradientBox>
        ) : null}
        <Txt style={{ fontFamily: fonts.display, fontSize: 24 }}>{game ? t(GAME_TITLE[game]) : ''}</Txt>
        <Txt variant="muted" style={{ marginTop: 4 }}>
          {t('games.createHint')}
        </Txt>
        {game === 'hangman' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose()
              router.push('/games/send')
            }}
            style={({ pressed }) => [styles.sendOpt, { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}
          >
            <GradientBox colors={COVER.hangman} radius={14} style={styles.roomIcon}>
              <Send size={18} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }}>{t('games.send.title')}</Txt>
              <Txt variant="muted" style={{ fontSize: 13 }}>
                {t('games.send.optionSub')}
              </Txt>
            </View>
            <ChevronRight size={18} color={c.textMuted} />
          </Pressable>
        ) : null}
        {game === 'hangman' || game === 'quiz' ? (
          <>
        <Txt style={[styles.sectionLabel, { color: c.textMuted, marginTop: sp.xl }]}>
          {game === 'quiz' ? t('games.quiz.questions') : t('games.liveRounds')}
        </Txt>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          {(game === 'quiz' ? QUESTION_OPTIONS : ROUND_OPTIONS).map((n) => {
            const on = n === count
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  feedback('tap')
                  setPick(n)
                }}
                // Selected = an outline + a faint wash in the game's own
                // colour, not a solid blue fill (owner, 2026-11-13).
                style={[
                  styles.roundOpt,
                  on
                    ? { backgroundColor: theme + '14', borderColor: theme, borderWidth: 2 }
                    : { backgroundColor: c.surface, borderColor: c.border },
                ]}
              >
                <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: on ? theme : c.text }}>{n}</Txt>
              </Pressable>
            )
          })}
        </View>
          </>
        ) : null}
        {game === 'bingo' ? (
          <>
            <Txt style={[styles.sectionLabel, { color: c.textMuted, marginTop: sp.xl }]}>{t('games.bingo.optGoal')}</Txt>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {BINGO_GOALS.map((g) => {
                const on = bingo.goal === g.id
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      feedback('tap')
                      setBingo((b) => ({ ...b, goal: g.id }))
                    }}
                    style={[styles.bingoOpt, on ? { backgroundColor: theme + '14', borderColor: theme, borderWidth: 2 } : { backgroundColor: c.surface, borderColor: c.border }]}
                  >
                    <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: on ? theme : c.text }}>{t(g.title)}</Txt>
                    <Txt variant="muted" style={{ fontSize: 12.5 }}>
                      {t(g.sub)}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
            <Txt style={[styles.sectionLabel, { color: c.textMuted, marginTop: sp.lg }]}>{t('games.bingo.optPace')}</Txt>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              {BINGO_PACES.map((p) => {
                const on = bingo.pace === p.id
                return (
                  <Pressable
                    key={p.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      feedback('tap')
                      setBingo((b) => ({ ...b, pace: p.id }))
                    }}
                    style={[styles.roundOpt, { height: 48 }, on ? { backgroundColor: theme + '14', borderColor: theme, borderWidth: 2 } : { backgroundColor: c.surface, borderColor: c.border }]}
                  >
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: on ? theme : c.text }}>{t(p.title)}</Txt>
                  </Pressable>
                )
              })}
            </View>
          </>
        ) : null}
        <GameBtn
          title={t('games.createRoom')}
          // In the game's own colours, like its banner (owner, 2026-11-13).
          colors={game ? COVER[game] : undefined}
          loading={busy}
          style={{ marginTop: sp.xl }}
          onPress={async () => {
            setBusy(true)
            try {
              await onCreate(count, bingo)
            } finally {
              setBusy(false)
            }
          }}
          curveBottom
        />
      </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, padding: sp.sm },
  cover: { height: 170, overflow: 'hidden' },
  soon: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  group: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md },
  roomIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  sendOpt: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 20, marginTop: sp.lg },
  joinPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { width: '100%', maxWidth: 620, alignSelf: 'center', borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius, padding: sp.lg, paddingTop: sp.sm },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: sp.md },
  bingoOpt: { flex: 1, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  roundOpt: { flex: 1, height: 56, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
})
