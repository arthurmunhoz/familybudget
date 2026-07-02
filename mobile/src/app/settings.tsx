// Settings: language, notifications, sign out, and in-app account deletion
// (required by Apple Guideline 5.1.1(v)).
import { useState } from 'react'
import { Alert, Pressable, View } from 'react-native'

import { AppHeader, Btn, Card, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { LANGUAGES } from '@/lib/i18n'
import { registerForPush } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import { radius, sp, useTheme } from '@/theme/theme'

export default function Settings() {
  const { c } = useTheme()
  const { profile, signOut } = useAuth()
  const { lang, setLang } = useI18n()
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  async function enablePush() {
    const r = await registerForPush()
    setPushMsg(
      r.ok
        ? 'Notifications enabled on this device.'
        : r.reason === 'simulator'
          ? 'Push needs a real device.'
          : r.reason === 'no-project'
            ? 'Run `eas init` first (needs an EAS project id).'
            : r.reason === 'denied'
              ? 'Notifications permission was declined.'
              : 'Could not enable notifications.',
    )
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and your data. If you are the last member of your household, the whole household and its data are deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Revoke the Apple token first (Apple requirement for Sign in with
            // Apple). Best-effort — a no-op until the Apple env vars are set.
            const apiBase = process.env.EXPO_PUBLIC_API_BASE
            try {
              const { data: sess } = await supabase.auth.getSession()
              const accessToken = sess.session?.access_token
              if (apiBase && accessToken) {
                await fetch(`${apiBase}/api/apple-revoke`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}` },
                })
              }
            } catch {
              /* best-effort */
            }
            const { error } = await supabase.rpc('delete_my_account')
            if (error) {
              Alert.alert('Could not delete account', error.message)
              return
            }
            await signOut()
          },
        },
      ],
    )
  }

  return (
    <Screen scroll header={<AppHeader title="Settings" />}>
      <View style={{ gap: sp.lg }}>
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Language</Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {LANGUAGES.map((l) => {
              const active = l.id === lang
              return (
                <Pressable
                  key={l.id}
                  onPress={() => setLang(l.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: sp.md,
                    paddingVertical: sp.sm,
                    borderRadius: radius.md,
                    backgroundColor: active ? c.accentSoft : c.card,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                  }}
                >
                  <Txt>{l.flag}</Txt>
                  <Txt variant={active ? 'body' : 'muted'}>{l.label}</Txt>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Notifications</Txt>
          <Card>
            <Txt variant="muted" style={{ marginBottom: sp.sm }}>
              Reminders for pet care, calendar dates and family nudges.
            </Txt>
            <Btn title="Enable notifications" variant="secondary" onPress={enablePush} />
            {pushMsg ? (
              <Txt variant="faint" style={{ marginTop: sp.sm }}>
                {pushMsg}
              </Txt>
            ) : null}
          </Card>
        </View>

        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Account</Txt>
          <Card>
            <Txt variant="muted">{profile?.email ?? ''}</Txt>
          </Card>
          <Btn title="Sign out" variant="secondary" onPress={signOut} />
          <Pressable onPress={confirmDelete} style={{ paddingVertical: sp.md, alignItems: 'center' }}>
            <Txt style={{ color: c.expense, fontWeight: '600' }}>Delete account</Txt>
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}
