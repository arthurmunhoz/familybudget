// "What can you do?" — inside the Roof sheet (owner, 2026-11-13: show, in a
// friendly way, what Roof does). One card per area in that area's Home
// gradient, each with two real requests; tapping one asks it right away.
// Only lists what the assistant really does (same rule as RoofExamples).
import { StyleSheet, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import {
  Bell,
  CalendarDays,
  Calculator,
  FolderLock,
  Gamepad2,
  ListChecks,
  PawPrint,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import type { TKey } from '@/lib/i18n'
import { fonts, sp, useTheme } from '@/theme/theme'
import { Orb } from './AnswerViews'
import { GradientBox } from './GradientBox'
import { APP_GRADIENT } from './palette'

const AREAS: { app: string; icon: LucideIcon; ex: TKey[] }[] = [
  { app: 'shopping', icon: ListChecks, ex: ['roofEx.shop.1', 'roofEx.shop.3'] },
  { app: 'calendar', icon: CalendarDays, ex: ['roofEx.cal.2', 'roofEx.cal.1'] },
  { app: 'budget', icon: Wallet, ex: ['roofEx.money.1', 'roofEx.money.2'] },
  { app: 'pets', icon: PawPrint, ex: ['roofEx.pets.1', 'roofEx.pets.3'] },
  { app: 'family', icon: Users, ex: ['roofEx.family.2', 'roofEx.family.1'] },
  { app: 'pings', icon: Bell, ex: ['roofEx.nudge.1', 'roofEx.nudge.3'] },
  { app: 'docs', icon: FolderLock, ex: ['roofEx.docs.2'] },
  { app: 'calc', icon: Calculator, ex: ['roofEx.calc.1', 'roofEx.calc.4'] },
  { app: 'games', icon: Gamepad2, ex: ['roofEx.games.1'] },
]

export function CapabilitiesView({ onTry }: { onTry: (text: string) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const other = profiles.find((p) => p.email !== profile?.email) ?? profile
  const name = (other?.display_name ?? '').trim().split(/\s+/)[0] || 'Ana'
  return (
    <View style={{ gap: sp.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <Orb />
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28 }}>{t('ask.capsTitle')}</Txt>
          <Txt variant="muted" style={{ fontSize: 14 }}>
            {t('ask.capsSub')}
          </Txt>
        </View>
      </View>
      {AREAS.map((a, i) => (
        <Animated.View
          key={a.app}
          entering={FadeInDown.delay(60 + i * 55).duration(320)}
          style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <View style={s.head}>
            <GradientBox colors={APP_GRADIENT[a.app] ?? APP_GRADIENT.admin} radius={11} style={s.tile}>
              <a.icon size={17} color="#fff" />
            </GradientBox>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }}>{t(`app.${a.app}.name` as TKey)}</Txt>
          </View>
          {a.ex.map((k) => {
            const phrase = t(k, { name })
            return (
              <Pressable
                key={k}
                onPress={() => onTry(phrase)}
                accessibilityRole="button"
                style={({ pressed }) => [s.ex, { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}
              >
                <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 19, color: c.text }}>“{phrase}”</Txt>
              </Pressable>
            )
          })}
        </Animated.View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: sp.md, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  tile: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  ex: { borderRadius: 14, paddingVertical: 9, paddingHorizontal: 12 },
})
