// "Send a hangman" (migration 092): pick who it's for, pick the word (same
// picker as the live game), send. Each person gets their own one-round
// hangman and a notification, plays whenever they like, and the result comes
// back to you. `?to=email` preselects someone ("send one back").
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated'
import { Check, Send } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { Avatar } from '@/apps/family/Avatar'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { games, GameRpcError } from '@/lib/games'
import { fonts, sp, useTheme } from '@/theme/theme'
import { feedback } from '../feedback'
import { COVER, TEAM_SOLID } from '../look'
import { useMembers } from '../members'
import { GameBtn, GameTopBar } from '../shared'
import { WordPicker } from './Hangman'

export function SendHangman() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { session, profiles } = useAuth()
  const { name, avatar } = useMembers()
  const gap = useBottomGap(sp.lg)
  const me = session?.user.email
  const params = useLocalSearchParams<{ to?: string }>()
  const others = profiles.filter((p) => p.email !== me)
  const [picked, setPicked] = useState<string[]>(() => (params.to && others.some((p) => p.email === params.to) ? [params.to] : []))
  const [step, setStep] = useState<'who' | 'word' | 'sent'>(params.to && picked.length ? 'word' : 'who')

  function toggle(email: string) {
    feedback('tap')
    setPicked((cur) => (cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email]))
  }

  const names = picked.map((e) => name(e)).join(', ')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={styles.wrap}>
        <View style={{ paddingHorizontal: sp.lg }}>
          <GameTopBar
            title={t('games.send.title')}
            onBack={() => {
              if (step === 'word' && !params.to) setStep('who')
              else if (router.canGoBack()) router.back()
              else router.replace('/games')
            }}
          />
        </View>

        {step === 'sent' ? (
          <View style={styles.sent}>
            <Animated.View entering={ZoomIn.duration(300)}>
              <GradientBox colors={COVER.hangman} radius={56} style={styles.sentIcon}>
                <Send size={44} color="#fff" />
              </GradientBox>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(150).duration(260)} style={{ gap: 6 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 28, textAlign: 'center' }}>{t('games.send.sentTitle')}</Txt>
              <Txt variant="muted" style={{ textAlign: 'center' }}>
                {t('games.send.sentSub', { names })}
              </Txt>
            </Animated.View>
            <GameBtn title={t('games.backToGames')} onPress={() => router.replace('/games')} style={{ marginTop: sp.lg, alignSelf: 'stretch' }} />
          </View>
        ) : step === 'who' ? (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl }}>
              <Txt style={styles.bigTitle}>{t('games.send.whoTitle')}</Txt>
              <Txt style={[styles.bigTitle, { color: c.textFaint }]}>{t('games.send.whoSub')}</Txt>
              <View style={[styles.people, { marginTop: sp.xl }]}>
                {others.map((p, i) => {
                  const on = picked.includes(p.email)
                  return (
                    <Animated.View key={p.email} entering={FadeIn.delay(i * 40).duration(200)} style={styles.personWrap}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => toggle(p.email)}
                        style={[styles.person, { backgroundColor: c.card, borderColor: on ? TEAM_SOLID.A : c.border }, on ? { borderWidth: 2 } : null]}
                      >
                        <View>
                          <Avatar name={name(p.email)} avatarPath={avatar(p.email)} size={64} />
                          {on ? (
                            <Animated.View entering={ZoomIn.duration(160)} style={[styles.check, { backgroundColor: TEAM_SOLID.A, borderColor: c.card }]}>
                              <Check size={14} color="#fff" strokeWidth={3} />
                            </Animated.View>
                          ) : null}
                        </View>
                        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
                          {name(p.email)}
                        </Txt>
                      </Pressable>
                    </Animated.View>
                  )
                })}
              </View>
              {!others.length ? (
                <Txt variant="muted" style={{ marginTop: sp.xl }}>
                  {t('games.send.nobody')}
                </Txt>
              ) : null}
            </ScrollView>
            <View style={{ paddingHorizontal: sp.lg, paddingBottom: gap }}>
              <GameBtn title={t('games.send.next')} disabled={!picked.length} onPress={() => setStep('word')} curveBottom />
            </View>
          </>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl, gap: sp.lg }} keyboardShouldPersistTaps="handled">
            <View style={styles.toRow}>
              <Txt variant="muted">{t('games.send.to')}</Txt>
              {picked.map((e) => (
                <View key={e} style={[styles.toChip, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Avatar name={name(e)} avatarPath={avatar(e)} size={22} />
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5 }}>{name(e)}</Txt>
                </View>
              ))}
            </View>
            <WordPicker
              lang={lang}
              tint="A"
              onPick={async (cat, word) => {
                try {
                  await games.hangman.send(picked, cat, word, lang)
                  feedback('win')
                  setStep('sent')
                } catch (e) {
                  const code = e instanceof GameRpcError ? e.code : 'network'
                  Alert.alert(t(`games.err.${code}` as never))
                }
              }}
            />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  bigTitle: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  personWrap: { width: '30%', flexGrow: 1, maxWidth: 160 },
  person: { alignItems: 'center', gap: sp.sm, paddingVertical: sp.lg, paddingHorizontal: sp.sm, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth },
  check: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  toRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: sp.sm },
  toChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  sent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp.xl, gap: sp.lg },
  sentIcon: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
})
