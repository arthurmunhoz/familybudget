// Home-screen banner for an ACTIVE safety radius. A watch is easy to forget —
// it runs for hours and quietly keeps the watched members in live mode — so
// the Hub says who's being watched and how long is left. Tapping opens
// Whereabouts with the Safety Radius sheet already open (?safety=1), where it
// can be changed or stopped.
//
// Look (2026-11): the Home card shape (GamesBanner) in the Safety feature's
// teal — the same gradient tile + shield as the Safety Radius sheet's head,
// and a "Manage" pill in that colour.
//
// Staying honest: the Hub stays MOUNTED under /location, so a mount-only fetch
// kept showing a watch the user had just stopped. It now re-reads on focus,
// on every start/stop made on this phone (onWatchChange), and every minute
// (countdown + expiry).
//
// Only the OWNER of a watch sees this: fetchMyWatch() is scoped to my email.
// Renders nothing when there's no live watch.
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { ChevronRight, ShieldCheck } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { shade } from '@/components/home/palette'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { shortName } from '@/lib/format'
import { fetchMyWatch, onWatchChange } from '@/lib/safetyRadius'
import type { SafetyWatch } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'
import { FEATURE } from './onCard'

/** Re-check often enough that the countdown stays honest and the banner
 *  disappears promptly when the watch expires. */
const POLL_MS = 60_000

const SAFETY = FEATURE.safety
const SAFETY_GRADIENT: [string, string] = [SAFETY, shade(SAFETY, -0.25)]

export default function SafetyBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profiles } = useAuth()
  const [watch, setWatch] = useState<SafetyWatch | null>(null)
  // The clock the countdown reads — set with each reload, not read in render.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    fetchMyWatch()
      .then((w) => {
        setWatch(w)
        setNow(Date.now())
      })
      .catch(() => {
        /* offline — leave the last state */
      })
  }, [])

  useEffect(() => {
    const id = setInterval(load, POLL_MS)
    const off = onWatchChange(load)
    return () => {
      clearInterval(id)
      off()
    }
  }, [load])

  // Back on the Home (e.g. after stopping the watch in Whereabouts).
  useFocusEffect(load)

  if (!watch || watch.watched.length === 0) return null
  const msLeft = new Date(watch.expires_at).getTime() - now
  if (msLeft <= 0) return null

  const names = watch.watched
    .map((email) => shortName(profiles.find((p) => p.email === email)?.display_name ?? email))
    .join(', ')

  // Minutes for a short free watch, rounded hours for a long Plus one.
  const minsLeft = Math.max(1, Math.round(msLeft / 60_000))
  const left =
    minsLeft >= 90
      ? t('location.safety.bannerEndsHours', { hours: Math.round(minsLeft / 60) })
      : t('location.safety.bannerEnds', { mins: minsLeft })

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/location', params: { safety: '1' } })}
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <GradientBox colors={SAFETY_GRADIENT} radius={14} style={styles.icon}>
        <ShieldCheck size={20} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 15 }} numberOfLines={1}>
          {t('location.safety.bannerTitle')}
        </Txt>
        <Txt variant="muted" style={{ fontSize: 13 }} numberOfLines={2}>
          {t('location.safety.bannerWho', { names })} · {left}
        </Txt>
      </View>
      <View style={[styles.pill, { backgroundColor: SAFETY }]}>
        <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 13 }}>{t('location.safety.bannerManage')}</Txt>
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
