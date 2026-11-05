// A short welcome the first time someone opens Whereabouts (owner, 2026-11):
// the screen's features hide behind a map and two header buttons, so a new
// user didn't know Places or the Safety radius existed. Four rows, one button,
// no paging — it should take ten seconds. Reopened from the header's "?".
// Seen-state lives in introSeen.ts (per device).
import type { ReactNode } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { MapPin, ShieldCheck, Users, EyeOff } from 'lucide-react-native'

import { GradientBox } from '@/components/home/GradientBox'
import { Pressable } from '@/components/Pressable'
import { Btn, Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'

type Gradient = [string, string]

const ROWS: { key: string; colors: Gradient; icon: ReactNode }[] = [
  { key: 'family', colors: ['#4C7BF4', '#3557C9'], icon: <Users size={22} color="#fff" /> },
  { key: 'places', colors: ['#F6A04D', '#E2683F'], icon: <MapPin size={22} color="#fff" /> },
  { key: 'safety', colors: ['#1FB6A6', '#14857A'], icon: <ShieldCheck size={22} color="#fff" /> },
  { key: 'privacy', colors: ['#8E6CF0', '#6A4BD0'], icon: <EyeOff size={22} color="#fff" /> },
]

export function WhereaboutsIntro({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottom = useBottomGap(sp.xs)
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View style={[s.sheet, { backgroundColor: c.sheet }]}>
          <View style={{ paddingHorizontal: sp.lg }}>
            <Txt style={[s.label, { color: c.textMuted }]}>{t('location.intro.kicker')}</Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 35, color: c.text }}>
              {t('location.intro.title')}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: c.textFaint, marginTop: 2 }}>
              {t('location.intro.sub')}
            </Txt>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: sp.lg, paddingVertical: sp.lg, gap: sp.lg }}>
            {ROWS.map((r) => (
              <View key={r.key} style={s.row}>
                <GradientBox colors={r.colors} radius={16} style={s.tile}>
                  {r.icon}
                </GradientBox>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: c.text }}>
                    {t(`location.intro.${r.key}.title` as TKey)}
                  </Txt>
                  <Txt variant="muted" style={{ fontSize: 14, lineHeight: 19, marginTop: 2 }}>
                    {t(`location.intro.${r.key}.body` as TKey)}
                  </Txt>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.xs, paddingBottom: bottom }}>
            <Btn title={t('location.intro.go')} onPress={onClose} curveBottom />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: sp.lg, maxHeight: '90%' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  tile: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
})
