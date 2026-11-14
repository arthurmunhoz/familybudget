// After a scanned receipt is SAVED as an expense: the open list items the scan
// matched (api/scan-receipt `matchedItems`), grouped by list, each pre-ticked.
// "Remove from lists" ticks the chosen ones off — the host does the write
// (checkItemIds) and offers Undo; nothing is written without that tap.
// 2026-11 sheet look: FormSheet head with the Lists gradient tile, kicker,
// display title, rows of a list on ONE rounded card, docked TintButton.
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Check, ListChecks } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { Txt } from '@/components/ui'
import { APP_GRADIENT } from '@/components/home/palette'
import { GradientBox } from '@/components/home/GradientBox'
import { useI18n } from '@/hooks/useI18n'
import type { MatchGroup } from '@/lib/receiptMatches'
import { fonts, sp, useTheme } from '@/theme/theme'
import StoreLogo from '../shopping/StoreLogo'
import { FormSheet } from './FormSheet'

const LOOK = APP_GRADIENT.shopping

export default function ReceiptListsSheet({
  groups,
  busy,
  onConfirm,
  onClose,
}: {
  groups: MatchGroup[]
  busy?: boolean
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  // Every match starts ticked; the user unticks what they didn't buy.
  const [off, setOff] = useState<Set<string>>(() => new Set())
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const chosen = groups.flatMap((g) => g.items.filter((i) => !off.has(i.id)).map((i) => i.id))

  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <FormSheet
      icon={ListChecks}
      colors={LOOK}
      kicker={t('receiptLists.kicker')}
      title={total === 1 ? t('receiptLists.titleOne') : t('receiptLists.title', { count: total })}
      onClose={onClose}
      onBackdropPress={onClose}
      maxShare={0.86}
      titleLines={2}
      footer={
        <>
          <Pressable
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [s.secondary, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.textMuted }}>{t('receiptLists.notNow')}</Txt>
          </Pressable>
          <TintButton
            tint={LOOK[1]}
            colors={LOOK}
            title={t('receiptLists.confirm')}
            disabled={busy || chosen.length === 0}
            onPress={() => onConfirm(chosen)}
          />
        </>
      }
    >
      <Txt style={{ fontSize: 15, lineHeight: 21, color: c.textMuted }}>{t('receiptLists.body')}</Txt>
      {groups.map((g) => {
        const name = g.store?.name ?? t('shopping.anywhere')
        return (
          <View key={g.store?.id ?? 'anywhere'} style={{ gap: sp.sm }}>
            <View style={s.label}>
              {g.store ? (
                <StoreLogo slug={g.store.slug} name={g.store.name} color={g.store.color} size={20} />
              ) : null}
              <Txt style={[s.labelText, { color: c.textMuted }]} numberOfLines={1}>
                {name}
              </Txt>
            </View>
            <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {g.items.map((item, idx) => {
                const on = !off.has(item.id)
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [
                      s.row,
                      idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                      pressed && { backgroundColor: c.cardActive },
                    ]}
                  >
                    <CheckDot on={on} ring={c.textFaint} />
                    <Txt
                      numberOfLines={2}
                      style={{ flex: 1, fontFamily: fonts.medium, fontSize: 16, color: on ? c.text : c.textMuted }}
                    >
                      {item.label}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
    </FormSheet>
  )
}

/** The Lists-gradient tick, settling in/out with a short timing curve. */
function CheckDot({ on, ring }: { on: boolean; ring: string }) {
  const v = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, { duration: 180, easing: Easing.bezier(0.2, 0, 0, 1) }))
  }, [on, v])
  const fill = useAnimatedStyle(() => ({ opacity: v.get(), transform: [{ scale: 0.7 + 0.3 * v.get() }] }))
  return (
    <View style={[s.dot, { borderColor: ring }]}>
      <Animated.View style={[StyleSheet.absoluteFill, fill]}>
        <GradientBox colors={LOOK} radius={13} style={s.dotFill}>
          <Check size={15} strokeWidth={3} color="#fff" />
        </GradientBox>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: 4 },
  labelText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', flexShrink: 1 },
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, minHeight: 52, paddingVertical: 10 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5 },
  dotFill: { width: 26, height: 26, margin: -1.5, alignItems: 'center', justifyContent: 'center' },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
})
