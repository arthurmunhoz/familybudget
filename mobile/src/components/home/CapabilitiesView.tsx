// "What can you do?" — inside the Roof sheet (owner, 2026-11-13: show, in a
// friendly way, what Roof does). One card per area in that area's Home
// gradient, each with two real requests (+ "See more"); tapping one asks it right away.
// Only lists what the assistant really does (same rule as RoofExamples).
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated'
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
  ChevronDown,
  ChevronUp,
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

// `ex` shows at once; `more` opens under "See more" for the area that caught
// the person's eye (owner, 2026-11-14) — never everything at once.
const k = (area: string, ns: number[]) => ns.map((n) => `roofEx.${area}.${n}` as TKey)
const AREAS: { app: string; icon: LucideIcon; ex: TKey[]; more: TKey[] }[] = [
  { app: 'shopping', icon: ListChecks, ex: k('shop', [1, 3]), more: k('shop', [5, 6, 7, 2, 4]) },
  { app: 'calendar', icon: CalendarDays, ex: k('cal', [2, 1]), more: k('cal', [5, 6, 3, 7, 8, 4]) },
  { app: 'budget', icon: Wallet, ex: k('money', [1, 2]), more: k('money', [6, 5, 7, 3, 8, 4]) },
  { app: 'pets', icon: PawPrint, ex: k('pets', [1, 3]), more: k('pets', [4, 2, 5, 6]) },
  { app: 'family', icon: Users, ex: k('family', [2, 1]), more: k('family', [4, 3, 6, 5]) },
  { app: 'pings', icon: Bell, ex: k('nudge', [1, 3]), more: k('nudge', [2, 5, 4]) },
  { app: 'docs', icon: FolderLock, ex: k('docs', [2]), more: k('docs', [1, 3, 4]) },
  { app: 'calc', icon: Calculator, ex: k('calc', [1, 4]), more: k('calc', [2, 5, 3, 6, 7, 8]) },
  { app: 'games', icon: Gamepad2, ex: k('games', [1]), more: k('games', [4, 2, 3, 5]) },
]

export function CapabilitiesView({ onTry }: { onTry: (text: string) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const other = profiles.find((p) => p.email !== profile?.email) ?? profile
  const name = (other?.display_name ?? '').trim().split(/\s+/)[0] || 'Ana'
  const [open, setOpen] = useState<Record<string, boolean>>({})
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
          layout={LinearTransition.duration(220)}
          style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <View style={s.head}>
            <GradientBox colors={APP_GRADIENT[a.app] ?? APP_GRADIENT.admin} radius={11} style={s.tile}>
              <a.icon size={17} color="#fff" />
            </GradientBox>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5 }}>{t(`app.${a.app}.name` as TKey)}</Txt>
          </View>
          {(open[a.app] ? [...a.ex, ...a.more] : a.ex).map((key, j) => {
            const phrase = t(key, { name })
            return (
              <Animated.View key={key} entering={j >= a.ex.length ? FadeIn.delay((j - a.ex.length) * 40).duration(220) : undefined}>
                <Pressable
                  onPress={() => onTry(phrase)}
                  accessibilityRole="button"
                  style={({ pressed }) => [s.ex, { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 19, color: c.text }}>“{phrase}”</Txt>
                </Pressable>
              </Animated.View>
            )
          })}
          {a.more.length ? (
            <Pressable
              onPress={() => setOpen((o) => ({ ...o, [a.app]: !o[a.app] }))}
              accessibilityRole="button"
              hitSlop={6}
              style={({ pressed }) => [s.more, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 13.5, color: c.textMuted }}>
                {open[a.app] ? t('ask.capsLess') : t('ask.capsMore', { n: a.more.length })}
              </Txt>
              {open[a.app] ? <ChevronUp size={15} color={c.textMuted} /> : <ChevronDown size={15} color={c.textMuted} />}
            </Pressable>
          ) : null}
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
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 4 },
})
