// Map style for Whereabouts — plain map, satellite or terrain.
//
// Lives here rather than in lib/ because it touches @rnmapbox/maps, which the
// lib layer deliberately doesn't import (see lib/location.ts).
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, Map, Mountain, Satellite, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import type { MapMode } from './mapMode'

const MODES: { mode: MapMode; label: TKey; icon: (color: string) => React.ReactNode }[] = [
  { mode: 'standard', label: 'location.mapMode.standard', icon: (c) => <Map size={19} color={c} /> },
  { mode: 'satellite', label: 'location.mapMode.satellite', icon: (c) => <Satellite size={19} color={c} /> },
  { mode: 'terrain', label: 'location.mapMode.terrain', icon: (c) => <Mountain size={19} color={c} /> },
]

export function MapModePicker({
  mode,
  onPick,
  onClose,
}: {
  mode: MapMode
  onPick: (mode: MapMode) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            backgroundColor: c.sheet,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.lg,
            gap: sp.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <Txt style={{ flex: 1, fontFamily: fonts.displaySemi, fontSize: 20, color: c.text }} numberOfLines={1}>
              {t('location.mapMode.title')}
            </Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <X size={20} color={c.textMuted} />
            </Pressable>
          </View>

          {MODES.map((m) => {
            const on = m.mode === mode
            return (
              <Pressable
                key={m.mode}
                onPress={() => {
                  onPick(m.mode)
                  onClose()
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.md,
                    backgroundColor: c.surface,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? c.accent : 'transparent',
                    padding: sp.md,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                {m.icon(on ? c.accent : c.text)}
                <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: c.text }} numberOfLines={1}>
                  {t(m.label)}
                </Txt>
                {on ? <Check size={18} color={c.accent} /> : null}
              </Pressable>
            )
          })}
        </View>
      </View>
    </Modal>
  )
}
