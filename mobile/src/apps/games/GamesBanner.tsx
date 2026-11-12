// Home banner: open game rooms, right under the ask bar (owner, 2026-11). This
// is how a member with game notifications OFF still finds out someone opened a
// room — the push is opt-out per person (migration 091), the Home card isn't.
// Live over Realtime (useOpenGames). Tap = join (lobby) or go back in.
// Two or more rooms / sent hangmans collapse into one summary card.
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronRight, Gamepad2 } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { games, useChallenges, useOpenGames } from '@/lib/games'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { GAME_ACTION_SOLID, GAMES_GRADIENT } from './look'
import { useMembers } from './members'

const TITLE: Record<string, TKey> = { hangman: 'games.hangman', battleship: 'games.battleship', quiz: 'games.quiz' }

export default function GamesBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { session } = useAuth()
  const { rooms } = useOpenGames()
  const { name } = useMembers()
  const me = session?.user.email
  const { forMe } = useChallenges(me)
  // Lobbies anyone can join, plus games I'm already playing.
  const shown = rooms.filter((r) => {
    const mine = r.players.some((p) => p.email === me && !p.left_at)
    return r.status === 'lobby' || mine
  })
  if (!shown.length && !forMe.length) return null

  // More than one thing → ONE summary card that opens the Games screen
  // (owner, 2026-11: game cards stacked on the Home cluttered it).
  if (shown.length + forMe.length > 1) {
    const parts: string[] = []
    if (shown.length) parts.push(t(shown.length === 1 ? 'games.home.roomsOne' : 'games.home.roomsMany', { n: shown.length }))
    if (forMe.length) parts.push(t(forMe.length === 1 ? 'games.home.sentOne' : 'games.home.sentMany', { n: forMe.length }))
    const kinds = [...new Set(shown.map((r) => t(TITLE[r.game])))]
    if (forMe.length && !kinds.includes(t('games.hangman'))) kinds.push(t('games.hangman'))
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/games')}
        style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1, marginBottom: sp.sm }]}
      >
        <View>
          <GradientBox colors={GAMES_GRADIENT} radius={14} style={styles.icon}>
            <Gamepad2 size={20} color="#fff" />
          </GradientBox>
          <View style={[styles.count, { borderColor: c.sheet, backgroundColor: GAME_ACTION_SOLID }]}>
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 11 }}>{shown.length + forMe.length}</Txt>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
            {parts.join(' · ')}
          </Txt>
          <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
            {kinds.join(' · ')}
          </Txt>
        </View>
        <View style={[styles.pill, { backgroundColor: GAME_ACTION_SOLID }]}>
          <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 13 }}>{t('games.home.see')}</Txt>
          <ChevronRight size={14} color={c.onAction} />
        </View>
      </Pressable>
    )
  }

  return (
    <View style={{ gap: sp.sm, marginBottom: sp.sm }}>
      {forMe.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => router.push(`/games/${r.id}`)}
          style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
        >
          <GradientBox colors={GAMES_GRADIENT} radius={14} style={styles.icon}>
            <Gamepad2 size={20} color="#fff" />
          </GradientBox>
          <View style={{ flex: 1 }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
              {t('games.send.fromName', { name: name(r.host_email) })}
            </Txt>
            <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
              {r.state.category ? t(`games.cat.${r.state.category}` as never) : t('games.hangman.freeWord')}
            </Txt>
          </View>
          <View style={[styles.pill, { backgroundColor: GAME_ACTION_SOLID }]}>
            <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 13 }}>{t('games.send.play')}</Txt>
            <ChevronRight size={14} color={c.onAction} />
          </View>
        </Pressable>
      ))}
      {shown.map((r) => {
        const here = r.players.filter((p) => !p.left_at)
        const mine = here.some((p) => p.email === me)
        const game = t(TITLE[r.game])
        const title =
          r.status === 'playing'
            ? t('games.home.playing', { game })
            : r.host_email === me
              ? t('games.home.openMine', { game })
              : t('games.home.open', { name: name(r.host_email), game })
        return (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={async () => {
              try {
                if (!mine) await games.join(r.id)
                router.push(`/games/${r.id}`)
              } catch {
                Alert.alert(t('games.err.network'))
              }
            }}
            style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <GradientBox colors={GAMES_GRADIENT} radius={14} style={styles.icon}>
              <Gamepad2 size={20} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
                {title}
              </Txt>
              <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={1}>
                {t('games.home.inRoom', { names: here.map((p) => (p.email === me ? t('games.you') : name(p.email))).join(', ') })}
              </Txt>
            </View>
            <View style={[styles.pill, { backgroundColor: mine ? c.surface : GAME_ACTION_SOLID }]}>
              <Txt style={{ color: mine ? c.text : c.onAction, fontFamily: fonts.semibold, fontSize: 13 }}>
                {mine ? t('games.back') : t('games.join')}
              </Txt>
              <ChevronRight size={14} color={mine ? c.text : c.onAction} />
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: -5, right: -6, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
})
