// "How to play" for the waiting room — pictures, not a paragraph (owner,
// 2026-11: nobody reads the text). Three short steps with little drawings, and
// the heart of the rule shown live: two mini houses side by side, playing the
// same misses on a loop — one going UP (what the word's team sees), one
// FALLING APART (what the guessing team sees).
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ArrowDown, ArrowUp, Tag, Trophy } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { HouseBuild } from '../art/HouseBuild'
import { HOUSE_PIECES, TEAM_GRADIENT, TEAM_SOLID } from '../look'

export function HowToPlay() {
  const { c } = useTheme()
  const { t } = useI18n()
  // 0…7 misses, then a beat on the result, then again.
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % (HOUSE_PIECES + 3)), 900)
    return () => clearInterval(id)
  }, [])
  const wrong = Math.min(step, HOUSE_PIECES)

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('games.how.title')}</Txt>

      <Step n={1} colors={TEAM_GRADIENT.A} title={t('games.how.step1')}>
        <View style={styles.row}>
          <View style={[styles.chip, { backgroundColor: c.surface }]}>
            <Tag size={13} color={TEAM_SOLID.A} />
            <Txt style={{ fontSize: 12.5, fontFamily: fonts.semibold }}>{t('games.cat.animals')}</Txt>
          </View>
          {['G', 'A', 'T', 'O'].map((l, i) => (
            <View key={i} style={[styles.miniTile, { borderColor: TEAM_SOLID.A, backgroundColor: c.bg }]}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 13 }}>{l}</Txt>
            </View>
          ))}
        </View>
      </Step>

      <Step n={2} colors={TEAM_GRADIENT.B} title={t('games.how.step2')}>
        <View style={styles.row}>
          {['A', 'E', 'O'].map((l, i) => (
            <View key={l} style={[styles.miniKey, { backgroundColor: i === 1 ? c.surface2 : TEAM_SOLID.B }]}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 14, color: i === 1 ? c.textMuted : '#fff', textDecorationLine: i === 1 ? 'line-through' : 'none' }}>
                {l}
              </Txt>
            </View>
          ))}
          {['_', 'A', '_', 'O'].map((l, i) => (
            <View key={`m${i}`} style={[styles.miniTile, { borderColor: l === '_' ? c.border : TEAM_SOLID.B, backgroundColor: l === '_' ? c.surface : c.bg }]}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 13, color: l === '_' ? c.textFaint : c.text }}>{l === '_' ? '' : l}</Txt>
            </View>
          ))}
        </View>
      </Step>

      <Step n={3} colors={['#8E9AAF', '#5B667A']} title={t('games.how.step3')}>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          <View style={{ flex: 1, gap: 6 }}>
            <HouseBuild wrong={wrong} mode="build" tint={TEAM_GRADIENT.A} height={104} />
            <View style={styles.caption}>
              <ArrowUp size={14} color={TEAM_SOLID.A} strokeWidth={2.6} />
              <Txt style={[styles.captionText, { color: TEAM_SOLID.A }]}>{t('games.how.goesUp')}</Txt>
            </View>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <HouseBuild wrong={wrong} mode="destroy" tint={TEAM_GRADIENT.A} height={104} />
            <View style={styles.caption}>
              <ArrowDown size={14} color={TEAM_SOLID.B} strokeWidth={2.6} />
              <Txt style={[styles.captionText, { color: TEAM_SOLID.B }]}>{t('games.how.fallsDown')}</Txt>
            </View>
          </View>
        </View>
      </Step>

      <View style={[styles.points, { backgroundColor: c.surface }]}>
        <Trophy size={18} color="#E0A100" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.how.pointGuess')}</Txt>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('games.how.pointHouse')}</Txt>
        </View>
      </View>
      <Txt variant="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>
        {t('games.how.swap')}
      </Txt>
    </View>
  )
}

function Step({ n, colors, title, children }: { n: number; colors: Gradient; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: sp.sm }}>
      <View style={styles.stepHead}>
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
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginRight: 4 },
  miniTile: { width: 24, height: 28, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  miniKey: { width: 28, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  captionText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  points: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 16, padding: sp.md },
})
