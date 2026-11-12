// Settings → Notifications → "Pet reminders": per-member opt-in for the
// routine reminders ("Nobody has marked 'Morning food' yet") —
// user_settings.notify_pets, migration 098, default on. Someone who doesn't
// look after the pets turns it off; their phones then cancel every scheduled
// reminder on the next sync (lib/petReminders.ts), which this triggers.
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { PawPrint } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Toggle } from '@/components/Toggle'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { ensureReminderPermission, syncPetReminders } from '@/lib/petReminders'
import { supabase } from '@/lib/supabase'
import { fonts, sp, useTheme } from '@/theme/theme'

export function PetRemindersToggle() {
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
      .select('notify_pets')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data && typeof data.notify_pets === 'boolean') setOn(data.notify_pets)
      })
    return () => {
      active = false
    }
  }, [email])

  function set(v: boolean) {
    setOn(v)
    if (!email) return
    void (async () => {
      const { error } = await supabase
        .from('user_settings')
        .upsert({ email, notify_pets: v, updated_at: new Date().toISOString() })
      if (error) {
        setOn(!v)
        return
      }
      if (v) await ensureReminderPermission()
      await syncPetReminders()
    })()
  }

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={() => set(!on)}
      style={[styles.row, { borderTopColor: c.border }]}
    >
      <GradientBox colors={on ? APP_GRADIENT.pets : ['#9AA0AA', '#737985']} radius={12} style={styles.icon}>
        <PawPrint size={19} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold }}>{t('settings.petReminders')}</Txt>
        <Txt variant="faint">{t('settings.petRemindersHint')}</Txt>
      </View>
      <Toggle value={on} onValueChange={set} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
})
