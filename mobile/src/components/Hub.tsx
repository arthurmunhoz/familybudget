// The launcher — a grid of the family apps, mirroring the PWA hub.
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { LogOut, Settings } from 'lucide-react-native'

import { Card, Txt } from './ui'
import { ADMIN_APP, APPS, type HubApp } from '../lib/apps'
import { useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { radius, sp, useTheme } from '../theme/theme'

export default function Hub() {
  const { c } = useTheme()
  const { profile, signOut } = useAuth()
  const { t } = useI18n()

  const apps: HubApp[] = profile?.is_admin ? [...APPS, ADMIN_APP] : APPS

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: sp.lg, paddingBottom: sp.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: sp.lg }}>
          <View>
            <Txt variant="display">One Roof</Txt>
            {profile?.display_name ? <Txt variant="muted">Hi, {profile.display_name}</Txt> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: sp.md }}>
            <Pressable accessibilityLabel="Settings" hitSlop={10} onPress={() => router.push('/settings')} style={{ padding: 6 }}>
              <Settings size={22} color={c.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel="Sign out" hitSlop={10} onPress={signOut} style={{ padding: 6 }}>
              <LogOut size={22} color={c.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
          {apps.map((app) => {
            const Icon = app.icon
            const name = t(`app.${app.id}.name` as TKey) || app.name
            const desc = t(`app.${app.id}.desc` as TKey) || app.description
            return (
              <Card
                key={app.id}
                onPress={() => router.push(app.route as never)}
                style={{ width: '47.5%', gap: 10, minHeight: 120, justifyContent: 'space-between' }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.md,
                    backgroundColor: c.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={24} color={c.accent} />
                </View>
                <View style={{ gap: 2 }}>
                  <Txt variant="h2">{name}</Txt>
                  <Txt variant="faint" numberOfLines={2}>
                    {desc}
                  </Txt>
                </View>
              </Card>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
