// Battleship "How to play" — pictures over prose, like the hangman's: hide the
// fleet, take turns aiming, a hit means you fire again.
import { StyleSheet, View } from 'react-native'
import { Crosshair, Trophy } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { TEAM_GRADIENT, TEAM_SOLID } from '../look'
import { Board, FleetStrip } from './Board'

export function HowToPlayBattleship() {
  const { c } = useTheme()
  const { t } = useI18n()
  const demoShots = [
    { r: 1, c: 1, hit: true, by: '', at: '1' },
    { r: 1, c: 2, hit: true, by: '', at: '2' },
    { r: 3, c: 3, hit: false, by: '', at: '0' },
  ]
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('games.how.title')}</Txt>
      <Step n={1} colors={TEAM_GRADIENT.A} title={t('games.bs.how1')}>
        <FleetStrip fleet={[4, 3, 3, 2, 2]} sunk={[]} colors={TEAM_GRADIENT.A} />
      </Step>
      <Step n={2} colors={TEAM_GRADIENT.B} title={t('games.bs.how2')}>
        <View style={{ flexDirection: 'row', gap: sp.md, alignItems: 'center' }}>
          <Board size={5} cell={22} shots={demoShots} colors={TEAM_GRADIENT.B} aim={{ r: 3, c: 1 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.row}>
              <Crosshair size={15} color={TEAM_SOLID.B} />
              <Txt style={{ fontSize: 13, flex: 1 }}>{t('games.bs.howAim')}</Txt>
            </View>
            <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: TEAM_SOLID.A }}>{t('games.bs.howHit')}</Txt>
            <Txt style={{ fontSize: 13 }} variant="muted">
              {t('games.bs.howMiss')}
            </Txt>
          </View>
        </View>
      </Step>
      <View style={[styles.points, { backgroundColor: c.surface }]}>
        <Trophy size={18} color="#E0A100" />
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.bs.howWin')}</Txt>
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
  points: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 16, padding: sp.md },
})
