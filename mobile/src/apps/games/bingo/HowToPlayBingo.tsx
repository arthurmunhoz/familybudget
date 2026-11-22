// Bingo "How to play" — pictures over prose: the ball, the dab, the call.
import { StyleSheet, View } from 'react-native'
import { Trophy } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { COVER } from '../look'
import { Ball } from './Ball'
import { Card } from './Card'
import { GOLD } from './look'

const DEMO = [3, 18, 34, 49, 62, 9, 27, 41, 55, 70, 12, 21, 0, 58, 66, 5, 30, 38, 47, 73, 14, 16, 44, 52, 61]

export function HowToPlayBingo() {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('games.how.title')}</Txt>
      <Step n={1} colors={COVER.bingo} title={t('games.bingo.how1')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Ball n={27} size={56} />
          <Txt variant="muted" style={{ flex: 1, fontSize: 13 }}>
            {t('games.bingo.howDraw')}
          </Txt>
        </View>
      </Step>
      <Step n={2} colors={COVER.bingo} title={t('games.bingo.how2')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <Card card={DEMO} marks={new Set([27, 41, 55, 9])} cell={24} gap={3} />
          <Txt variant="muted" style={{ flex: 1, fontSize: 13 }}>
            {t('games.bingo.howMark')}
          </Txt>
        </View>
      </Step>
      <Step n={3} colors={GOLD} title={t('games.bingo.howCall')} />
      <View style={[styles.points, { backgroundColor: c.surface }]}>
        <Trophy size={18} color="#E0A100" />
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.bingo.howWin')}</Txt>
      </View>
    </View>
  )
}

function Step({ n, colors, title, children }: { n: number; colors: Gradient; title: string; children?: React.ReactNode }) {
  return (
    <View style={{ gap: sp.sm }}>
      <View style={styles.row}>
        <GradientBox colors={colors} radius={13} style={styles.num}>
          <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 14 }}>{n}</Txt>
        </GradientBox>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15 }}>{title}</Txt>
      </View>
      {children ? <View style={{ paddingLeft: 36 }}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: sp.lg, padding: sp.lg, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  points: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 16, padding: sp.md },
})
