// Home banner for a sharing phone that lost its background permission
// (migration 120, 2026-11-17). iOS every so often asks "keep allowing One Roof
// to use your location in the background?" — answer "only while using" and
// sharing stays ON while the phone reports only with the app open and no
// place / leash geofence ever fires: the family sees you "at Home" for hours.
// useLocationSync re-checks on every foreground and feeds this through the
// store in lib/location; tapping opens the app's page in iOS Settings.
// Renders nothing while sharing is off or the permission is "Always".
// Look (2026-11): the Home card shape (GamesBanner / SafetyBanner) with the
// Location app's own gradient tile — it used to be the old flat row with a
// red left edge.
import { useSyncExternalStore } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight, MapPinOff } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, shade } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { getBgPermissionSnapshot, subscribeBgPermission } from '@/lib/location'
import { fonts, sp, useTheme } from '@/theme/theme'

const GRADIENT = APP_GRADIENT.location
/** The gradient's deep end, darkened until white text reads on it. */
const SOLID = shade(GRADIENT[1], -0.2)

export default function LocationPermissionBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const perm = useSyncExternalStore(subscribeBgPermission, getBgPermissionSnapshot)
  if (perm == null || perm === 'always') return null

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void Linking.openSettings().catch(() => {})}
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <GradientBox colors={GRADIENT} radius={14} style={styles.icon}>
        <MapPinOff size={20} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={2}>
          {perm === 'denied' ? t('location.bgperm.offTitle') : t('location.bgperm.title')}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={2}>
          {t('location.bgperm.body')}
        </Txt>
      </View>
      <View style={[styles.pill, { backgroundColor: SOLID }]}>
        <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 13 }}>{t('location.bgperm.action')}</Txt>
        <ChevronRight size={14} color="#fff" />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    padding: sp.md,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: sp.sm,
  },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
})
