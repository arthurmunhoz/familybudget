// The launcher — a grid of the family apps, mirroring the PWA hub (including
// the live "open shopping items" badge on the Shopping tile).
import { useEffect, useMemo } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Settings } from 'lucide-react-native'

import { Card, Txt } from './ui'
import NudgesBanner from '../apps/pings/NudgesBanner'
import TodaySection from './TodaySection'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { ADMIN_APP, APPS, type HubApp } from '../lib/apps'
import { useAuth } from '../lib/auth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { useTilePref } from '../hooks/useTilePref'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { radius, sp, useTheme } from '../theme/theme'

export default function Hub() {
  const { c } = useTheme()
  const { profile } = useAuth()
  const { t } = useI18n()
  const { tile } = useTilePref()
  const compact = tile === 'compact'

  const { hiddenApps, appOrder } = useAppPrefs()
  // Hidden apps drop out; ordered ids come first (registry order for the rest);
  // Admin stays pinned last and is never hidden or reordered.
  const apps: HubApp[] = useMemo(() => {
    const pos = new Map(appOrder.map((id, i) => [id, i]))
    const rank = (a: HubApp) => pos.get(a.id) ?? appOrder.length + APPS.findIndex((x) => x.id === a.id)
    const visible = APPS.filter((a) => !hiddenApps.includes(a.id)).sort((a, b) => rank(a) - rank(b))
    return profile?.is_admin ? [...visible, ADMIN_APP] : visible
  }, [profile?.is_admin, hiddenApps, appOrder])

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

  // Household name for the header (mirrors the PWA hub). Cached so it renders the
  // last value instantly on return and doesn't flash the "One Roof" fallback.
  const { data: householdName } = useCachedQuery<string | null>('hub:householdName', async () => {
    if (!profile?.household_id) return null
    const { data } = await supabase
      .from('households')
      .select('name')
      .eq('id', profile.household_id)
      .maybeSingle()
    return (data as { name?: string } | null)?.name ?? null
  })

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
          <Txt variant="display">{householdName ?? 'One Roof'}</Txt>
          {profile?.display_name ? (
            <Txt variant="muted">{t('home.greeting', { name: profile.display_name })}</Txt>
          ) : null}
        </View>
        <Pressable accessibilityLabel="Settings" hitSlop={10} onPress={() => router.push('/settings')} style={{ padding: 6 }}>
          <Settings size={22} color={c.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.xxl }}>
        {/* Today: weather + agenda (calendar + pet care due). */}
        <TodaySection />
        {/* Incoming nudges you can respond to — tap to jump to the Past tab. */}
        <NudgesBanner />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? sp.sm : sp.md }}>
          {apps.map((app) => {
            const Icon = app.icon
            const name = t(`app.${app.id}.name` as TKey) || app.name
            const desc = t(`app.${app.id}.desc` as TKey) || app.description
            return (
              <Card
                key={app.id}
                onPress={() => router.push(app.route as never)}
                style={
                  compact
                    ? { width: '31%', gap: 8, minHeight: 96, alignItems: 'center', justifyContent: 'center', paddingVertical: sp.md }
                    : { width: '47.5%', gap: 10, minHeight: 120, justifyContent: 'space-between' }
                }
              >
                {badges[app.id] ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      minWidth: 20,
                      height: 20,
                      borderRadius: 10,
                      paddingHorizontal: 5,
                      backgroundColor: c.accent,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt style={{ color: c.onAccent, fontSize: 11, fontWeight: '700' }}>
                      {badges[app.id]}
                    </Txt>
                  </View>
                ) : null}
                <View
                  style={{
                    width: compact ? 40 : 44,
                    height: compact ? 40 : 44,
                    borderRadius: radius.md,
                    backgroundColor: c.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={compact ? 22 : 24} color={c.accent} />
                </View>
                {compact ? (
                  <Txt variant="h2" numberOfLines={1} style={{ fontSize: 13, textAlign: 'center' }}>
                    {name}
                  </Txt>
                ) : (
                  <View style={{ gap: 2 }}>
                    <Txt variant="h2">{name}</Txt>
                    <Txt variant="faint" numberOfLines={2}>
                      {desc}
                    </Txt>
                  </View>
                )}
              </Card>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
