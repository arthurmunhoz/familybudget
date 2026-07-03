// The launcher — a grid of the family apps, mirroring the PWA hub (including
// the live "open shopping items" badge on the Shopping tile).
import { useEffect } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Settings } from 'lucide-react-native'

import { Card, Txt } from './ui'
import NudgesBanner from '../apps/pings/NudgesBanner'
import { ADMIN_APP, APPS, type HubApp } from '../lib/apps'
import { useAuth } from '../lib/auth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { radius, sp, useTheme } from '../theme/theme'

export default function Hub() {
  const { c } = useTheme()
  const { profile } = useAuth()
  const { t } = useI18n()

  const apps: HubApp[] = profile?.is_admin ? [...APPS, ADMIN_APP] : APPS

  // Open (unchecked) shopping items → count pill on the Shopping tile. Cached
  // (renders the last value instantly) + live via the same Realtime table the
  // list uses, so it updates while the other phone is shopping.
  const { data: shoppingCount = 0, revalidate: reloadShopping } = useCachedQuery<number>(
    'hub:shoppingCount',
    async () => {
      const { count } = await supabase
        .from('shopping_items')
        .select('id', { count: 'exact', head: true })
        .eq('checked', false)
      return count ?? 0
    },
  )
  useEffect(() => {
    const channel = supabase
      .channel('hub_shopping_badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items' }, () =>
        reloadShopping(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reloadShopping])

  const badges: Record<string, number> = { shopping: shoppingCount }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {/* Fixed header — stays put while the app grid scrolls. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingHorizontal: sp.lg,
          paddingTop: sp.lg,
          paddingBottom: sp.md,
        }}
      >
        <View>
          <Txt variant="display">One Roof</Txt>
          {profile?.display_name ? <Txt variant="muted">Hi, {profile.display_name}</Txt> : null}
        </View>
        <Pressable accessibilityLabel="Settings" hitSlop={10} onPress={() => router.push('/settings')} style={{ padding: 6 }}>
          <Settings size={22} color={c.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl }}>
        {/* Incoming nudges you can respond to — tap to jump to the Past tab. */}
        <NudgesBanner />
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
                {badges[app.id] ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      minWidth: 22,
                      height: 22,
                      borderRadius: 11,
                      paddingHorizontal: 6,
                      backgroundColor: c.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>
                      {badges[app.id]}
                    </Txt>
                  </View>
                ) : null}
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
