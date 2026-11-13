// Utilities hub (slug/route stays `calc` — it started life as "Calculator").
// 2026-11 (owner): EVERY tool visible without scrolling — people didn't find
// the ones below the fold. A fixed 2-column grid whose rows share the screen
// height (flex), so the tiles grow on tall phones and shrink to a floor on
// small ones (only below that floor does the page scroll). Icons are the
// tools' own two-tone line art (ToolArt) on the bare card — no coloured
// squares. A "Roof does this for you" card opens examples to ask Roof
// (components/RoofExamples) — tap one and Roof opens with it typed in.
// Each tool is its own route under app/calc/ (native back gesture).
//
// Order (owner, 2026-11): At home (photo frame) + Printables side by side on
// top, Bills & shopping below.
// Tools:
//   Bills & shopping — split evenly (wizard), split by item (photo scan,
//                      Plus), better deal (unit price), discount
//   Printables       — luggage tag (see apps/calc/printables: the reusable
//                      format for printable cards)
//   At home          — photo frame (apps/calc/frame): a spare tablet plays the
//                      family album (frame_photos, migration 100) or this
//                      device's own photos
// Only the photo frame touches the database; the other tools need none.
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, type Href } from 'expo-router'
import { Sparkles } from 'lucide-react-native'

import Animated, { Easing, FadeInDown } from 'react-native-reanimated'

import { Pressable } from '@/components/Pressable'
import { RoofExamples } from '@/components/RoofExamples'
import { Txt } from '@/components/ui'
import type { Gradient } from '@/components/home/palette'
import { TOOL_LOOK } from '@/apps/calc/look'
import { ToolArt, type ToolArtKind } from '@/apps/calc/ToolArt'
import { ToolTopBar } from '@/apps/calc/wizard'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { usePlus } from '@/lib/plus'
import { fonts, sp, useTheme } from '@/theme/theme'

interface Tool {
  id: ToolArtKind
  route: Href
  /** The tool's colour — its icon's ink and wash. */
  colors: Gradient
  title: TKey
  sub: TKey
  plus?: boolean
  /** Powered by AI — gets a "✨ AI" badge on the tile. */
  ai?: boolean
  /** Entrance order (the tiles rise in one after another). */
  order: number
}

const EVEN: Tool = { id: 'even', route: '/calc/even', colors: TOOL_LOOK.even.colors, title: 'calc.tool.even', sub: 'calc.tool.evenSub', order: 2 }
const ITEMS: Tool = {
  id: 'items',
  route: '/calc/items',
  colors: TOOL_LOOK.items.colors,
  order: 3,
  title: 'calc.tool.byItem',
  sub: 'calc.tool.byItemSub',
  plus: true,
  ai: true,
}
const DEAL: Tool = { id: 'deal', route: '/calc/deal', colors: TOOL_LOOK.deal.colors, title: 'calc.tool.unit', sub: 'calc.tool.unitSub', order: 4 }
const DISCOUNT: Tool = { id: 'discount', route: '/calc/discount', colors: TOOL_LOOK.discount.colors, title: 'calc.tool.discount', sub: 'calc.tool.discountSub', order: 5 }
const TAG: Tool = { id: 'tag', route: '/calc/tag', colors: TOOL_LOOK.tag.colors, title: 'calc.tool.tag', sub: 'calc.tool.tagSub', order: 1 }
const FRAME: Tool = { id: 'frame', route: '/calc/frame', colors: TOOL_LOOK.frame.colors, title: 'calc.tool.frame', sub: 'calc.tool.frameSub', order: 0 }
const TOOL_COUNT = 6

export default function UtilitiesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { isFree } = usePlus()
  const bottomGap = useBottomGap(sp.md)

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

  const tile = (tool: Tool) => <ToolTile key={tool.id} tool={tool} locked={!!tool.plus && isFree} onPress={() => open(tool)} />
  const label = (k: TKey) => (
    <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t(k)}</Txt>
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <ToolTopBar title="" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: sp.lg, paddingBottom: bottomGap }}>
        <Txt style={styles.bigTitle}>{t('calc.title')}</Txt>
        <Txt style={[styles.count, { color: c.textFaint }]}>{t('calc.toolsCount', { n: TOOL_COUNT })}</Txt>

        {/* Roof runs these too — say so where people come looking: a card
            that opens examples to ask (owner, 2026-11). */}
        <View style={{ marginTop: sp.md }}>
          <RoofExamples examples={['roofEx.calc.1', 'roofEx.calc.2', 'roofEx.calc.3', 'roofEx.calc.4']} />
        </View>

        <View style={styles.grid}>
          {/* one tool each: their labels sit side by side on the first row */}
          <View style={styles.row}>
            <View style={styles.col}>
              {label('calc.section.home')}
              {tile(FRAME)}
            </View>
            <View style={styles.col}>
              {label('calc.section.print')}
              {tile(TAG)}
            </View>
          </View>
          <View style={{ marginTop: sp.sm, marginBottom: -sp.md }}>{label('calc.section.bills')}</View>
          <View style={styles.row}>
            {tile(EVEN)}
            {tile(ITEMS)}
          </View>
          <View style={styles.row}>
            {tile(DEAL)}
            {tile(DISCOUNT)}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function ToolTile({ tool, locked, onPress }: { tool: Tool; locked: boolean; onPress: () => void }) {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  return (
    <Animated.View style={{ flex: 1 }} entering={FadeInDown.delay(60 * tool.order).duration(380).easing(Easing.bezier(0.2, 0, 0, 1))}>
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      {/* the tool's colour as a soft glow in the corner, behind its art —
          the frame's tiles carry their colour; a full fill was too loud */}
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: tool.colors[0] + (dark ? '2A' : '1E') }]} />
      <View style={styles.tileTop}>
        <ToolArt kind={tool.id} colors={tool.colors} dark={dark} size={50} />
        {tool.ai ? (
          <View style={[styles.aiBadge, { backgroundColor: c.accentSoft }]}>
            <Sparkles size={11} color={c.accent} />
            <Txt style={{ fontSize: 10.5, fontFamily: fonts.semibold, color: c.accent }}>{t('calc.aiBadge')}</Txt>
          </View>
        ) : locked ? (
          <Sparkles size={15} color={c.accent} />
        ) : null}
      </View>
      <View style={{ gap: 3 }}>
        <Txt style={{ fontFamily: fonts.display, color: c.text, fontSize: 16.5, lineHeight: 20 }} numberOfLines={2}>
          {t(tool.title)}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 12.5, lineHeight: 16 }} numberOfLines={2}>
          {t(tool.sub)}
        </Txt>
      </View>
    </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  count: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, marginTop: 2 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm },
  // The rows split whatever height is left; each has a floor so a small phone
  // still shows a readable tile (and only then scrolls).
  grid: { flex: 1, marginTop: sp.lg, gap: sp.md },
  row: { flex: 1, flexDirection: 'row', gap: sp.md, minHeight: 124, maxHeight: 190 },
  col: { flex: 1 },
  tile: { flex: 1, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 14, justifyContent: 'space-between', overflow: 'hidden' },
  glow: { position: 'absolute', top: -38, left: -38, width: 130, height: 130, borderRadius: 65 },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
})
