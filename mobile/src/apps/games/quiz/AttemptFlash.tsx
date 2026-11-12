// What someone just answered, shown BIG over the quiz for a moment on every
// phone (owner, 2026-11: "mostrar a palavra que a pessoa falou em evidência").
// Right → a green card with a check that draws in, "Correct!", the word large
// and a burst of soft rings; wrong → a coral card with ✕ and the word struck
// through; time up → a quiet grey card. Calm timed motion: rise + fade in,
// hold, fade out. Never takes a touch.
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated'
import { Check, Clock, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp } from '@/theme/theme'

const GOOD: Gradient = ['#3FD3A0', '#0E9F78']
const BAD: Gradient = ['#FF8F86', '#E04A63']
const SLOW: Gradient = ['#A3A9B6', '#6E7584']
const HOLD_MS = 1500

export function AttemptFlash({ text, correct, timeout, name }: { text: string; correct: boolean; timeout?: boolean; name: string }) {
  const { t } = useI18n()
  const show = useSharedValue(0)
  const burst = useSharedValue(0)
  useEffect(() => {
    show.set(
      withSequence(
        withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) }),
        withDelay(HOLD_MS, withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) })),
      ),
    )
    if (correct) burst.set(withDelay(120, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })))
  }, [show, burst, correct])

  const card = useAnimatedStyle(() => ({
    opacity: show.value,
    transform: [{ translateY: (1 - show.value) * 18 }, { scale: 0.94 + show.value * 0.06 }],
  }))
  const dim = useAnimatedStyle(() => ({ opacity: show.value * 0.28 }))
  const ring0 = useAnimatedStyle(() => ({ opacity: (1 - burst.value) * 0.5, transform: [{ scale: 0.6 + burst.value * 1.1 }] }))
  const ring1 = useAnimatedStyle(() => ({ opacity: (1 - burst.value) * 0.4, transform: [{ scale: 0.6 + burst.value * 1.45 }] }))
  const rings = [ring0, ring1]

  const colors = timeout ? SLOW : correct ? GOOD : BAD
  const Icon = timeout ? Clock : correct ? Check : X
  const title = timeout ? t('games.quiz.timeUp') : correct ? t('games.quiz.right') : t('games.quiz.wrongShort')

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dim]} />
      <View style={styles.center}>
        {correct
          ? rings.map((r, i) => <Animated.View key={i} style={[styles.ring, { borderColor: GOOD[0] }, r]} />)
          : null}
        <Animated.View style={[styles.wrap, card]}>
          <GradientBox colors={colors} radius={30} style={styles.card}>
            <View style={styles.badge}>
              <Icon size={34} color="#fff" strokeWidth={3} />
            </View>
            <Txt style={styles.title}>{title}</Txt>
            {timeout ? (
              <Txt style={styles.by}>{name}</Txt>
            ) : (
              <>
                <Txt style={styles.by}>{t('games.quiz.saidBy', { name })}</Txt>
                <Txt
                  style={[styles.word, !correct && { textDecorationLine: 'line-through', textDecorationColor: 'rgba(255,255,255,0.7)' }]}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  “{text}”
                </Txt>
              </>
            )}
          </GradientBox>
        </Animated.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sp.lg },
  wrap: {
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  card: { alignItems: 'center', gap: 6, paddingHorizontal: sp.lg, paddingTop: sp.lg, paddingBottom: sp.xl },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
  },
  title: { color: '#fff', fontFamily: fonts.display, fontSize: 26 },
  by: { color: 'rgba(255,255,255,0.88)', fontFamily: fonts.semibold, fontSize: 14 },
  word: { color: '#fff', fontFamily: fonts.display, fontSize: 40, lineHeight: 48, textAlign: 'center', marginTop: 4 },
  ring: { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 6 },
})
