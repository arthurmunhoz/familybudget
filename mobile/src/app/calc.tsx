// Utilities hub (slug/route stays `calc` — it started life as "Calculator").
// A grid of small tools, grouped by what they're for, so new ones slot in
// without the screen turning into a long list. Each tool is its own route
// under app/calc/, which gives it the native back gesture and a real stack
// entry instead of the in-screen tool switch this used to be.
//
// Tools:
//   Bills & shopping — split evenly (wizard), split by item (photo scan,
//                      Plus), better deal (unit price), discount
//   Printables       — luggage tag (see apps/calc/printables: the reusable
//                      format for printable cards)
// No database is used by this module.
import { Alert, StyleSheet, View } from 'react-native'
import { router, type Href } from 'expo-router'
import { Luggage, ReceiptText, Scale, Sparkles, Tag, UsersRound, type LucideIcon } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { AppHeader, Screen, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { usePlus } from '@/lib/plus'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

interface Tool {
  id: string
  route: Href
  icon: LucideIcon
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
      { id: 'even', route: '/calc/even', icon: UsersRound, title: 'calc.tool.even', sub: 'calc.tool.evenSub' },
      { id: 'items', route: '/calc/items', icon: ReceiptText, title: 'calc.tool.byItem', sub: 'calc.tool.byItemSub', plus: true, ai: true },
      { id: 'deal', route: '/calc/deal', icon: Scale, title: 'calc.tool.unit', sub: 'calc.tool.unitSub' },
      { id: 'discount', route: '/calc/discount', icon: Tag, title: 'calc.tool.discount', sub: 'calc.tool.discountSub' },
    ],
  },
  {
    title: 'calc.section.print',
    tools: [{ id: 'tag', route: '/calc/tag', icon: Luggage, title: 'calc.tool.tag', sub: 'calc.tool.tagSub' }],
  },
]

export default function UtilitiesScreen() {
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
    <Screen scroll header={<AppHeader title={t('calc.title')} />}>
      {SECTIONS.map((sec) => (
        <View key={sec.title} style={{ marginTop: sp.lg }}>
          <Txt variant="label" style={styles.sectionLabel}>
            {t(sec.title)}
          </Txt>
          <View style={styles.grid}>
            {sec.tools.map((tool) => (
              <ToolTile key={tool.id} tool={tool} locked={!!tool.plus && isFree} onPress={() => open(tool)} />
            ))}
          </View>
        </View>
      ))}
    </Screen>
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
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: pressed ? c.cardActive : c.card, borderColor: c.border },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: c.accentSoft }]}>
          <Icon size={24} color={c.accent} strokeWidth={2} />
        </View>
        {tool.ai ? (
          <View style={[styles.aiBadge, { backgroundColor: c.accentSoft }]}>
            <Sparkles size={12} color={c.accent} />
            <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, color: c.accent }}>{t('calc.aiBadge')}</Txt>
          </View>
        ) : locked ? (
          <Sparkles size={16} color={c.accent} />
        ) : null}
      </View>
      <Txt style={{ fontFamily: fonts.semibold, color: c.text, fontSize: 16 }} numberOfLines={2}>
        {t(tool.title)}
      </Txt>
      <Txt variant="faint" numberOfLines={3}>
        {t(tool.sub)}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: sp.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.md },
  tile: {
    width: '47.5%',
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: sp.lg,
    gap: 6,
    minHeight: 150,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: sp.sm },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
