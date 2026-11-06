// The frame of the Google / Apple calendar sync screens (2026-11, the Home's
// look): a round back button, the provider's logo on a big tile, its name as a
// display title with the connection state faded under it, the facts as rows of
// one card, then the one action (gradient, in the Calendar's red) and — when
// connected — a quiet Disconnect. Each screen supplies only its data.
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Screen, Txt } from '@/components/ui'
import { TintButton } from '@/components/TintButton'
import { APP_GRADIENT } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { fonts, sp, useTheme } from '@/theme/theme'

export interface SyncFact {
  icon: ReactNode
  text: string
  tone?: 'normal' | 'faint' | 'error'
}

export function SyncScreen({
  logo,
  title,
  state,
  facts,
  loading,
  action,
  onAction,
  busy,
  onDisconnect,
  disconnectLabel,
}: {
  logo: ReactNode
  title: string
  /** "Connected" / "Not connected" — the faded line under the title. */
  state: string
  facts: SyncFact[]
  loading?: boolean
  action?: string
  onAction?: () => void
  busy?: boolean
  /** Present when connected. */
  onDisconnect?: () => void
  disconnectLabel?: string
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const red = APP_GRADIENT.calendar as [string, string]
  return (
    <Screen
      scroll
      header={
        <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/calendar'))}
            hitSlop={8}
            style={({ pressed }) => [s.round, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <ChevronLeft size={22} color={c.text} />
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: sp.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <View style={[s.logo, { backgroundColor: c.card, borderColor: c.border }]}>{logo}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: c.text }}>{title}</Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: c.textFaint }}>{state}</Txt>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color={c.textMuted} />
        ) : (
          <>
            <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {facts.map((f, i) => (
                <View key={i} style={[s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                  <View style={[s.factIcon, { backgroundColor: f.tone === 'error' ? c.expense + '1F' : red[1] + '17' }]}>{f.icon}</View>
                  <Txt
                    style={{
                      flex: 1,
                      fontSize: 14.5,
                      lineHeight: 20,
                      color: f.tone === 'error' ? c.expense : f.tone === 'faint' ? c.textMuted : c.text,
                    }}
                  >
                    {f.text}
                  </Txt>
                </View>
              ))}
            </View>

            <View style={{ gap: sp.sm }}>
              {action && onAction ? (
                <TintButton tint={red[0]} title={busy ? t('calendar.syncing') : action} onPress={onAction} disabled={busy} />
              ) : null}
              {onDisconnect ? (
                <Pressable onPress={onDisconnect} disabled={busy} style={{ paddingVertical: sp.md, alignItems: 'center' }}>
                  <Txt style={{ color: c.expense, fontFamily: fonts.semibold }}>{disconnectLabel}</Txt>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 64, height: 64, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 13 },
  factIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
