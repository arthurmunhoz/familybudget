// Home-screen banner for an ACTIVE safety radius (mirrors NudgesBanner's slot
// and shape). A watch is easy to forget — it runs for hours and quietly keeps
// the watched members in live mode — so the Hub says who's being watched and
// how long is left. Tapping opens Whereabouts with the Safety Radius sheet
// already open (?safety=1), where it can be changed or stopped.
//
// Only the OWNER of a watch sees this: fetchMyWatch() is scoped to my email.
// Renders nothing when there's no live watch.
import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { ShieldCheck } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { shortName } from '@/lib/format'
import { fetchMyWatch } from '@/lib/safetyRadius'
import type { SafetyWatch } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

/** Re-check often enough that the countdown stays honest and the banner
 *  disappears promptly when the watch expires. */
const POLL_MS = 60_000

export default function SafetyBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profiles } = useAuth()
  const [watch, setWatch] = useState<SafetyWatch | null>(null)

  const load = useCallback(() => {
    fetchMyWatch()
      .then(setWatch)
      .catch(() => {
        /* offline — leave the last state */
      })
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  if (!watch || watch.watched.length === 0) return null

  const names = watch.watched
    .map((email) => shortName(profiles.find((p) => p.email === email)?.display_name ?? email))
    .join(', ')

  // Minutes for a short free watch, rounded hours for a long Plus one.
  const msLeft = new Date(watch.expires_at).getTime() - Date.now()
  const minsLeft = Math.max(0, Math.round(msLeft / 60_000))
  const left =
    minsLeft >= 90
      ? t('location.safety.bannerEndsHours', { hours: Math.round(minsLeft / 60) })
      : t('location.safety.bannerEnds', { mins: minsLeft })

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/location', params: { safety: '1' } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        backgroundColor: c.card,
        borderRadius: radius.md,
        borderLeftWidth: 3,
        borderLeftColor: c.accent,
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
          backgroundColor: c.accentSoft,
        }}
      >
        <ShieldCheck size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
          {t('location.safety.bannerTitle')}
        </Txt>
        <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
          {t('location.safety.bannerWho', { names })} · {left}
        </Txt>
      </View>
      <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 13 }}>
        {t('location.safety.bannerManage')}
      </Txt>
    </Pressable>
  )
}
