// Calculator hub app — RN port of the PWA's calc/Calculator.tsx. Three tools:
//  1. Split a bill (evenly, or by item with tip/tax — photo scan is stubbed)
//  2. Better deal (price-per-unit comparison)
//  3. Discount (final sale price)
// No database is used by this module.
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  ChevronRight,
  Scale,
  Tag,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { router } from 'expo-router'

import { AppHeader, Screen, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { radius, sp, useTheme } from '@/theme/theme'

import { SplitBill } from '@/apps/calc/SplitBill'
import { BetterDeal } from '@/apps/calc/BetterDeal'
import { Discount } from '@/apps/calc/Discount'

type Tool = 'split' | 'unit' | 'discount'

const TOOLS: { id: Tool; icon: LucideIcon; title: TKey; sub: TKey }[] = [
  { id: 'split', icon: Utensils, title: 'calc.tool.split', sub: 'calc.tool.splitSub' },
  { id: 'unit', icon: Scale, title: 'calc.tool.unit', sub: 'calc.tool.unitSub' },
  { id: 'discount', icon: Tag, title: 'calc.tool.discount', sub: 'calc.tool.discountSub' },
]

export default function CalculatorScreen() {
  const { t } = useI18n()
  const [tool, setTool] = useState<Tool | null>(null)
  const active = TOOLS.find((x) => x.id === tool)

  const title = active ? t(active.title) : t('calc.title')
  const onBack = tool
    ? () => setTool(null)
    : () => (router.canGoBack() ? router.back() : router.replace('/'))

  return (
    <Screen scroll>
      <AppHeader title={title} onBack={onBack} />
      {tool === 'split' ? (
        <SplitBill />
      ) : tool === 'unit' ? (
        <BetterDeal />
      ) : tool === 'discount' ? (
        <Discount />
      ) : (
        <Menu onPick={setTool} />
      )}
    </Screen>
  )
}

function Menu({ onPick }: { onPick: (t: Tool) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View style={{ gap: sp.md, marginTop: sp.sm }}>
      {TOOLS.map((tl) => {
        const Icon = tl.icon
        return (
          <Pressable
            key={tl.id}
            onPress={() => onPick(tl.id)}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: pressed ? c.cardActive : c.card, borderColor: c.border },
            ]}
          >
            <View style={[styles.tileIcon, { backgroundColor: c.surface }]}>
              <Icon size={24} color={c.accent} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontWeight: '700', color: c.text }}>{t(tl.title)}</Txt>
              <Txt variant="faint">{t(tl.sub)}</Txt>
            </View>
            <ChevronRight size={20} color={c.textFaint} />
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: sp.lg,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
