// Home-screen nudge for a household of ONE: the whole app is built around
// sharing a list, a calendar and a map with other people, and none of that
// means anything until somebody else joins. The invite code that makes it
// possible is several screens away, at the bottom of Settings, so a household
// created and then left alone has no way of discovering it.
//
// Shares NudgesBanner/SafetyBanner's slot and shape (accent-edged row, icon,
// title + subtitle) rather than an alarm styling — this is an invitation, not
// a warning. Tapping deep-links to Settings' invite card and outlines it
// (?highlight=invite), so the code is on screen at the end of one tap instead
// of somewhere on a long page.
//
// Renders nothing unless the household really is just you AND you can act on
// it — see the guards in the component.
import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { UserPlus, X } from 'lucide-react-native'

import { Txt } from './ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { radius, sp, useTheme } from '@/theme/theme'

/** Dismissed per DEVICE and per account, like NudgesBanner's dismissed set —
 *  a household that is deliberately one person shouldn't be nagged forever. */
const dismissKeyFor = (email: string) => `invite-banner-dismissed:${email}`

export default function InviteBanner() {
  const { c } = useTheme()
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

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/settings', params: { highlight: 'invite' } })}
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
        <UserPlus size={18} color={c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
          {t('home.invite.title')}
        </Txt>
        <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={2}>
          {t('home.invite.body')}
        </Txt>
      </View>
      {/* Its own Pressable so dismissing doesn't also open Settings. */}
      <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel={t('home.invite.dismiss')}>
        <X size={16} color={c.textFaint} />
      </Pressable>
    </Pressable>
  )
}
