// Choose which map app to navigate with. This replaced three tiny icon buttons
// crammed into the member card: at that size the glyphs carried the whole
// meaning and were, per review, hard to read. One clearly labelled "Navigate"
// opening a proper list is a tap slower and much easier to aim at.
//
// All three destinations are always offered because `navUrl` builds universal
// HTTPS links — each opens the native app when it's installed and the web map
// when it isn't, so there's no such thing as an option that doesn't work here.
import { SheetHead } from './sheetParts'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight, Map, MapPin, Navigation } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { openNavigation, type NavApp } from '@/lib/location'
import type { TKey } from '@/lib/i18n'
import type { Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

/** Each carries its service's brand colour so they're told apart at a glance
 *  (we don't ship their actual trademarked logos). */
const APPS: { app: NavApp; label: TKey; color: string }[] = [
  { app: 'apple', label: 'location.maps.apple', color: '#007AFF' },
  { app: 'google', label: 'location.maps.google', color: '#34A853' },
  { app: 'waze', label: 'location.maps.waze', color: '#05C8F7' },
]

function Glyph({ app, color }: { app: NavApp; color: string }) {
  if (app === 'apple') return <Map size={19} color={color} />
  if (app === 'google') return <MapPin size={19} color={color} />
  return <Navigation size={19} color={color} />
}

export function NavPicker({
  profile,
  to,
  onClose,
}: {
  profile: Profile
  to: { lat: number; lng: number }
  onClose: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()

  const go = (app: NavApp) => {
    void openNavigation(app, to, profile.display_name)
    onClose()
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <View
          style={{
            // c.sheet, never c.card — the glass skin makes card translucent.
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: sp.lg,
            paddingBottom: insets.bottom + sp.md,
            gap: sp.md,
          }}
        >
          <SheetHead title={t('location.navigateTitle', { name: profile.display_name })} onClose={onClose} />

          <View style={{ borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }}>
            {APPS.map(({ app, label, color }, i) => (
              <Pressable
                key={app}
                onPress={() => go(app)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: sp.md,
                    paddingHorizontal: sp.md,
                    paddingVertical: 13,
                    borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                    borderColor: c.border,
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                  <Glyph app={app} color={color} />
                </View>
                <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 17, color: c.text }} numberOfLines={1}>
                  {t(label)}
                </Txt>
                <ChevronRight size={18} color={c.textFaint} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
}
