// Home-screen nudge for a household of ONE: the whole app is built around
// sharing a list, a calendar and a map with other people, and none of that
// means anything until somebody else joins. The invite code that makes it
// possible is several screens away, at the bottom of Settings, so a household
// created and then left alone has no way of discovering it.
//
// Shares NudgesBanner's slot and its received-nudge card shape (gradient card,
// icon tile, title + subtitle, one action pill), in the Family app's colours —
// an invitation, not a warning. Tapping deep-links to Settings' invite card and outlines it
// (?highlight=invite), so the code is on screen at the end of one tap instead
// of somewhere on a long page.
//
// Renders nothing unless the household really is just you AND you can act on
// it — see the guards in the component.
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Share2, UserPlus, X } from 'lucide-react-native'

import { Pressable } from './Pressable'
import { Txt } from './ui'
import { GradientBox } from './home/GradientBox'
import { APP_GRADIENT } from './home/palette'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp } from '@/theme/theme'

/** Dismissed per DEVICE and per account, like NudgesBanner's dismissed set —
 *  a household that is deliberately one person shouldn't be nagged forever. */
const dismissKeyFor = (email: string) => `invite-banner-dismissed:${email}`

export default function InviteBanner() {
  const { t } = useI18n()
  const { profile, profiles, profileLoaded } = useAuth()
  // `undefined` = not read yet. Starting at `false` would flash the banner for
  // a frame on every Hub mount before AsyncStorage answers.
  const [dismissed, setDismissed] = useState<boolean | undefined>(undefined)

  const email = profile?.email
  useEffect(() => {
    if (!email) return
    let active = true
    AsyncStorage.getItem(dismissKeyFor(email))
      .then((v) => {
        if (active) setDismissed(v === '1')
      })
      .catch(() => {
        if (active) setDismissed(false)
      })
    return () => {
      active = false
    }
  }, [email])

  const dismiss = useCallback(() => {
    setDismissed(true)
    if (email) void AsyncStorage.setItem(dismissKeyFor(email), '1').catch(() => {})
  }, [email])

  // Wait for the members list to resolve: `profiles` is empty while it loads,
  // so acting on its length early would show this to every household for a
  // moment, including full ones.
  if (!profileLoaded || !profile) return null
  if (profiles.length !== 1) return null
  // Only the OWNER can read a join code (get_join_code returns null to everyone
  // else), so for anyone else this would open Settings to a card that isn't
  // there. A lone member is normally the owner; this is for the exception.
  if (profile.role !== 'owner') return null
  if (dismissed !== false) return null

  const colors = APP_GRADIENT.family
  return (
    // The Home's card language (2026-11): a gradient card in the Family app's
    // colours, like a received nudge — icon tile, display title, one white
    // action pill — instead of the old accent-edged row.
    <GradientBox colors={colors} radius={24} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.tile}>
          <UserPlus size={22} strokeWidth={2.2} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={styles.title}>{t('home.invite.title')}</Txt>
          <Txt style={styles.body}>{t('home.invite.body')}</Txt>
        </View>
        {/* Its own Pressable so dismissing doesn't also open Settings. */}
        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('home.invite.dismiss')}
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.7 : 1 }]}
        >
          <X size={15} strokeWidth={2.5} color="#fff" />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/settings', params: { highlight: 'invite' } })}
        style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Share2 size={15} strokeWidth={2.5} color={colors[1]} />
        <Txt style={[styles.pillTxt, { color: colors[1] }]}>{t('home.invite.cta')}</Txt>
      </Pressable>
    </GradientBox>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: sp.md, gap: sp.md, marginBottom: sp.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  tile: { width: 46, height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: '#fff' },
  body: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.88)', marginTop: 2 },
  close: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  pill: { height: 42, borderRadius: radius.pill, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillTxt: { fontWeight: '700', fontSize: 14 },
})
