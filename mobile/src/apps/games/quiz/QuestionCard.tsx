// The quiz question card: a category header in the category's own gradient —
// its icon on a frosted tile, the name in display type, a big faded copy of
// the icon and a few soft circles for texture, and "3 / 10" as a pill — then
// the question itself, LARGE, on a plain card so it reads at arm's length.
// (Owner, 2026-11: the strip + auto-shrunk text was "mal dá para ler" on iPhone.)
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { FlaskConical, Flag, Globe, Lightbulb, PawPrint, Trophy, UtensilsCrossed, type LucideIcon } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { QUIZ_CAT } from '../look'

const CAT_ICON: Record<string, LucideIcon> = {
  general: Lightbulb,
  geography: Globe,
  science: FlaskConical,
  animals: PawPrint,
  sports: Trophy,
  food: UtensilsCrossed,
  brazil: Flag,
}

/** Bigger type for shorter questions; never auto-shrunk (iOS shrank it to unreadable). */
function questionSize(text: string, wide: boolean) {
  const n = text.length
  const base = n <= 55 ? 28 : n <= 90 ? 25 : n <= 130 ? 22 : 20
  return wide ? Math.round(base * 1.2) : base
}

export function QuestionCard({ id, category, text, q, total }: { id: string | number; category: string; text: string; q: number; total: number }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width } = useWindowDimensions()
  const wide = width >= 600
  const colors = QUIZ_CAT[category] ?? QUIZ_CAT.general
  const Icon = CAT_ICON[category] ?? Lightbulb
  const size = questionSize(text, wide)

  return (
    <Animated.View key={id} entering={FadeInDown.duration(260)} style={[styles.card, { backgroundColor: c.sheet, borderColor: c.border }]}>
      <GradientBox colors={colors} radius={0} style={styles.head}>
        {/* texture: soft circles + a big faded icon, behind everything */}
        <View pointerEvents="none" style={[styles.blob, { width: 120, height: 120, right: -30, top: -50 }]} />
        <View pointerEvents="none" style={[styles.blob, { width: 60, height: 60, right: 70, bottom: -34 }]} />
        <View pointerEvents="none" style={styles.watermark}>
          <Icon size={86} color="rgba(255,255,255,0.18)" strokeWidth={1.6} />
        </View>
        <View style={styles.iconTile}>
          <Icon size={22} color="#fff" strokeWidth={2.2} />
        </View>
        <Txt style={styles.catName} numberOfLines={1}>
          {t(`games.quizcat.${category}` as never)}
        </Txt>
        <View style={styles.countPill}>
          <Txt style={styles.count}>{t('games.quiz.qOf', { n: q, of: total })}</Txt>
        </View>
      </GradientBox>
      <View style={styles.body}>
        <Txt style={[styles.question, { color: c.text, fontSize: size, lineHeight: Math.round(size * 1.22) }]}>{text}</Txt>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: sp.lg, paddingVertical: 14, overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  watermark: { position: 'absolute', right: 8, top: -8, transform: [{ rotate: '-12deg' }] },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  catName: { flex: 1, color: '#fff', fontFamily: fonts.display, fontSize: 21 },
  countPill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: 'rgba(0,0,0,0.16)' },
  count: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13 },
  body: { paddingHorizontal: sp.lg, paddingTop: 18, paddingBottom: 22, minHeight: 110, justifyContent: 'center' },
  question: { fontFamily: fonts.display, textAlign: 'center' },
})
