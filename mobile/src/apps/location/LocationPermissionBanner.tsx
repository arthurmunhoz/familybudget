// Home banner for a sharing phone that lost its background permission
// (migration 120, 2026-11-17). iOS every so often asks "keep allowing One Roof
// to use your location in the background?" — answer "only while using" and
// sharing stays ON while the phone reports only with the app open and no
// place / leash geofence ever fires: the family sees you "at Home" for hours.
// useLocationSync re-checks on every foreground and feeds this through the
// store in lib/location; tapping opens the app's page in iOS Settings.
// Renders nothing while sharing is off or the permission is "Always".
import { useSyncExternalStore } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { MapPinOff } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { getBgPermissionSnapshot, subscribeBgPermission } from '@/lib/location'
import { radius, sp, useTheme } from '@/theme/theme'

export default function LocationPermissionBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const perm = useSyncExternalStore(subscribeBgPermission, getBgPermissionSnapshot)
  if (perm == null || perm === 'always') return null

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void Linking.openSettings().catch(() => {})}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        backgroundColor: c.card,
        borderRadius: radius.md,
        borderLeftWidth: 3,
        borderLeftColor: c.expense,
        paddingHorizontal: sp.md,
        paddingVertical: sp.md,
        marginBottom: sp.md,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surface,
        }}
      >
        <MapPinOff size={18} color={c.expense} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '700' }} numberOfLines={2}>
          {perm === 'denied' ? t('location.bgperm.offTitle') : t('location.bgperm.title')}
        </Txt>
        <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
          {t('location.bgperm.body')}
        </Txt>
      </View>
      <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 13 }}>{t('location.bgperm.action')}</Txt>
    </Pressable>
  )
}
