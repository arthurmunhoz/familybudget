// Utilities hub (slug/route stays `calc` — it started life as "Calculator").
// 2026-11 restyle in the Home's language: a big title with what's here in
// faded type, the tools as tiles with their own gradient icon (like the Home's
// app icons), grouped under tracked section labels, and a hint that the Home's
// ask bar can run them ("divide 58,71 em 3"). Each tool is its own route under
// app/calc/ (native back gesture, real stack entry).
//
// Tools:
//   Bills & shopping — split evenly (wizard), split by item (photo scan,
//                      Plus), better deal (unit price), discount
//   Printables       — luggage tag (see apps/calc/printables: the reusable
//                      format for printable cards)
// No database is used by this module.
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, type Href } from 'expo-router'
import { Luggage, ReceiptText, Scale, Sparkles, Tag, UsersRound, type LucideIcon } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { ToolTopBar } from '@/apps/calc/wizard'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { usePlus } from '@/lib/plus'
import { fonts, sp, useTheme } from '@/theme/theme'

interface Tool {
  id: string
  route: Href
  icon: LucideIcon
  /** The tile's own gradient — each tool reads at a glance, like Home icons. */
  colors: Gradient
  title: TKey
  sub: TKey
  plus?: boolean
  /** Powered by AI — gets a "✨ AI" badge on the tile. */
  ai?: boolean
}

const SECTIONS: { title: TKey; tools: Tool[] }[] = [
  {
    title: 'calc.section.bills',
    tools: [
      { id: 'even', route: '/calc/even', icon: UsersRound, colors: ['#4C7BF4', '#4A4FD8'], title: 'calc.tool.even', sub: 'calc.tool.evenSub' },
      {
        id: 'items',
        route: '/calc/items',
        icon: ReceiptText,
        colors: ['#A065F0', '#7140D6'],
        title: 'calc.tool.byItem',
        sub: 'calc.tool.byItemSub',
        plus: true,
        ai: true,
      },
      { id: 'deal', route: '/calc/deal', icon: Scale, colors: ['#1FB5A8', '#127F86'], title: 'calc.tool.unit', sub: 'calc.tool.unitSub' },
      { id: 'discount', route: '/calc/discount', icon: Tag, colors: ['#F0566A', '#C9356A'], title: 'calc.tool.discount', sub: 'calc.tool.discountSub' },
    ],
  },
  {
    title: 'calc.section.print',
    tools: [{ id: 'tag', route: '/calc/tag', icon: Luggage, colors: ['#FFB93C', '#F2862A'], title: 'calc.tool.tag', sub: 'calc.tool.tagSub' }],
  },
]
const TOOL_COUNT = SECTIONS.reduce((n, s) => n + s.tools.length, 0)

export default function UtilitiesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isFree } = usePlus()

  function open(tool: Tool) {
    // isFree, not !isPlus — must match the badge, or a paying user sees an
    // unlocked tile that still refuses while the entitlement resolves.
    if (tool.plus && isFree) {
      Alert.alert(t('calc.plusByItem'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.getPlus'), onPress: () => router.push('/paywall') },
      ])
      return
    }
    router.push(tool.route)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <ToolTopBar title="" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl }}>
        <Txt style={styles.bigTitle}>{t('calc.title')}</Txt>
        <Txt style={[styles.bigTitle, { color: c.textFaint }]}>{t('calc.toolsCount', { n: TOOL_COUNT })}</Txt>

        {/* the ask bar runs these too — say so where people come looking */}
        <View style={[styles.tip, { backgroundColor: c.card, borderColor: c.border }]}>
          <Sparkles size={16} color={c.accent} />
          <Txt variant="muted" style={{ flex: 1, fontSize: 13.5 }}>
            {t('calc.askTip')}
          </Txt>
        </View>

        {SECTIONS.map((sec) => (
          <View key={sec.title} style={{ marginTop: sp.xl }}>
            <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t(sec.title)}</Txt>
            <View style={styles.grid}>
              {sec.tools.map((tool) => (
                <ToolTile key={tool.id} tool={tool} locked={!!tool.plus && isFree} onPress={() => open(tool)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

function ToolTile({ tool, locked, onPress }: { tool: Tool; locked: boolean; onPress: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const Icon = tool.icon
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.tileTop}>
        <GradientBox colors={tool.colors} radius={16} style={styles.tileIcon}>
          <Icon size={24} color="#fff" strokeWidth={2} />
        </GradientBox>
        {tool.ai ? (
          <View style={[styles.aiBadge, { backgroundColor: c.accentSoft }]}>
            <Sparkles size={12} color={c.accent} />
            <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.accent }}>{t('calc.aiBadge')}</Txt>
          </View>
        ) : locked ? (
          <Sparkles size={16} color={c.accent} />
        ) : null}
      </View>
      <Txt style={{ fontFamily: fonts.display, color: c.text, fontSize: 17, lineHeight: 21 }} numberOfLines={2}>
        {t(tool.title)}
      </Txt>
      <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={3}>
        {t(tool.sub)}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    marginTop: sp.lg,
    paddingHorizontal: sp.md,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  tile: { width: '47.5%', flexGrow: 1, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: sp.lg, gap: 6, minHeight: 168 },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: sp.sm },
  tileIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
})
