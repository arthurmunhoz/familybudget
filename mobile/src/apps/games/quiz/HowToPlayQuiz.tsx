// Buzzer quiz "How to play" — pictures over prose: the question, the buzzer,
// answer by talking or typing.
import { StyleSheet, View } from 'react-native'
import { Keyboard, Mic, Trophy } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { TEAM_GRADIENT, TEAM_SOLID } from '../look'
import { Buzzer } from './Buzzer'

export function HowToPlayQuiz() {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('games.how.title')}</Txt>
      <Step n={1} colors={TEAM_GRADIENT.A} title={t('games.quiz.how1')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Buzzer size={86} colors={TEAM_GRADIENT.A} state="active" onPress={() => undefined} />
          <Txt variant="muted" style={{ flex: 1, fontSize: 13 }}>
            {t('games.quiz.howFirst')}
          </Txt>
        </View>
      </Step>
      <Step n={2} colors={TEAM_GRADIENT.B} title={t('games.quiz.how2')}>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          <View style={[styles.chip, { backgroundColor: c.surface }]}>
            <Mic size={15} color={TEAM_SOLID.B} />
            <Txt style={{ fontSize: 13, fontFamily: fonts.semibold }}>{t('games.quiz.speak')}</Txt>
          </View>
          <View style={[styles.chip, { backgroundColor: c.surface }]}>
            <Keyboard size={15} color={TEAM_SOLID.B} />
            <Txt style={{ fontSize: 13, fontFamily: fonts.semibold }}>{t('games.quiz.type')}</Txt>
          </View>
        </View>
        <Txt variant="muted" style={{ fontSize: 13, marginTop: 6 }}>
          {t('games.quiz.howWrong')}
        </Txt>
      </Step>
      <View style={[styles.points, { backgroundColor: c.surface }]}>
        <Trophy size={18} color="#E0A100" />
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.quiz.howWin')}</Txt>
      </View>
    </View>
  )
}

function Step({ n, colors, title, children }: { n: number; colors: Gradient; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: sp.sm }}>
      <View style={styles.row}>
        <GradientBox colors={colors} radius={13} style={styles.num}>
          <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 14 }}>{n}</Txt>
        </GradientBox>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15 }}>{title}</Txt>
      </View>
      <View style={{ paddingLeft: 36 }}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: sp.lg, padding: sp.lg, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  points: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 16, padding: sp.md },
})
