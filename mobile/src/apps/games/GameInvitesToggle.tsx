// Settings → Notifications → "Game invites": per-member opt-out for the
// "X opened a room" push (user_settings.notify_games, migration 091). Off still
// shows open rooms on the Home — only the notification stops.
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gamepad2 } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Toggle } from '@/components/Toggle'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { fonts, sp, useTheme } from '@/theme/theme'
import { GAMES_GRADIENT } from './look'

export function GameInvitesToggle() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { session } = useAuth()
  const email = session?.user.email
  const [on, setOn] = useState(true)

  useEffect(() => {
    if (!email) return
    let active = true
    void supabase
      .from('user_settings')
      .select('notify_games')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data && typeof data.notify_games === 'boolean') setOn(data.notify_games)
      })
    return () => {
      active = false
    }
  }, [email])

  function set(v: boolean) {
    setOn(v)
    if (!email) return
    void supabase
      .from('user_settings')
      .upsert({ email, notify_games: v, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) setOn(!v)
      })
  }

  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={() => set(!on)} style={[styles.row, { borderTopColor: c.border }]}>
      <GradientBox colors={on ? GAMES_GRADIENT : ['#9AA0AA', '#737985']} radius={12} style={styles.icon}>
        <Gamepad2 size={19} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold }}>{t('settings.gameInvites')}</Txt>
        <Txt variant="faint">{t('settings.gameInvitesHint')}</Txt>
      </View>
      <Toggle value={on} onValueChange={set} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
})
