// The Home (2026-11 "Comando" redesign). Top to bottom:
//  - TodaySection: date · weather · household, "Hi, Ana. 3 things for today.",
//    the ask-anything bar (→ AskSheet), and today's agenda as cards.
//  - The time-sensitive banners (birthday month, incoming nudges, a running
//    safety watch, the invite nudge for a household of one).
//  - The apps as a 4-column grid of colour icons, like a phone's home screen,
//    with the live "open shopping items" badge.
//  - A floating dock with the household's members (→ Family) and Settings.
// Light is the default appearance; every surface here reads from the theme,
// only the app icons and agenda cards carry their own fixed colours.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Settings } from 'lucide-react-native'

import { Txt } from './ui'
import SafetyBanner from '../apps/location/SafetyBanner'
import NudgesBanner from '../apps/pings/NudgesBanner'
import TodaySection, { SectionLabel } from './TodaySection'
import HomeBirthdays from './HomeBirthdays'
import InviteBanner from './InviteBanner'
import { AskSheet } from './home/AskSheet'
import { APP_GRADIENT } from './home/palette'
import { GradientBox } from './home/GradientBox'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useBottomGap } from '../hooks/useBottomGap'
import { ADMIN_APP, APPS, type HubApp } from '../lib/apps'
import { WHEREABOUTS_ENABLED } from '../lib/features'
import { useAuth } from '../lib/auth'
import { memberColor } from '../lib/calendar'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { fonts, sp, useTheme } from '../theme/theme'

const DOCK_H = 72

export default function Hub() {
  const { c } = useTheme()
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const [askKey, setAskKey] = useState(0)
  const [askListen, setAskListen] = useState(false)
  const dockGap = useBottomGap(sp.md)

  const { hiddenApps, appOrder } = useAppPrefs()
  // Hidden apps drop out; ordered ids come first (registry order for the rest);
  // Admin stays pinned last and is never hidden or reordered.
  const apps: HubApp[] = useMemo(() => {
    const pos = new Map(appOrder.map((id, i) => [id, i]))
    const rank = (a: HubApp) => pos.get(a.id) ?? appOrder.length + APPS.findIndex((x) => x.id === a.id)
    const visible = APPS.filter((a) => !hiddenApps.includes(a.id)).sort((a, b) => rank(a) - rank(b))
    return profile?.is_admin ? [...visible, ADMIN_APP] : visible
  }, [profile?.is_admin, hiddenApps, appOrder])

  // Open (unchecked) shopping items → count pill on the Shopping icon. Cached
  // (renders the last value instantly) + live via the same Realtime table the
  // list uses, so it updates while the other phone is shopping — and when the
  // ask bar adds items.
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

  // Household name for the header line. Cached so it renders the last value
  // instantly on return.
  const { data: householdName, revalidate: reloadName } = useCachedQuery<string | null>(
    'hub:householdName',
    async () => {
      if (!profile?.household_id) return null
      const { data } = await supabase
        .from('households')
        .select('name')
        .eq('id', profile.household_id)
        .maybeSingle()
      return (data as { name?: string } | null)?.name ?? null
    },
  )

  // The Hub never unmounts — every app is PUSHED on top of it — so refetch on
  // focus (a rename in Settings, items added on another screen).
  useFocusEffect(
    useCallback(() => {
      void reloadName()
      void reloadShopping()
    }, [reloadName, reloadShopping]),
  )

  const badges: Record<string, number> = { shopping: shoppingCount }
  const firstName = (profile?.display_name ?? '').split(' ')[0] || 'One Roof'
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  // Me first, then everyone else in the household.
  const members = useMemo(
    () => [...profiles].sort((a, b) => Number(b.email === profile?.email) - Number(a.email === profile?.email)),
    [profiles, profile?.email],
  )

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: DOCK_H + dockGap + sp.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <TodaySection
          name={firstName}
          household={householdName ?? null}
          onAsk={(listen) => {
            setAskKey((k) => k + 1)
            setAskListen(!!listen)
            setAsking(true)
          }}
          right={
            <Pressable
              accessibilityLabel="Settings"
              hitSlop={10}
              onPress={() => router.push('/settings')}
              style={[styles.round, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <Settings size={20} color={c.textMuted} />
            </Pressable>
          }
        />

        <View style={{ marginTop: sp.lg }}>
          {/* Someone's birthday later this month (or today) → their Birthday page. */}
          <HomeBirthdays />
          {/* Incoming nudges you can respond to — tap to jump to the Past tab. */}
          <NudgesBanner />
          {/* An active safety radius — tap to manage or stop it. */}
          {WHEREABOUTS_ENABLED && <SafetyBanner />}
          {/* Household of one — where to find the invite code. Last: a live
              nudge or a running safety watch is time-sensitive and should sit
              above a standing suggestion. */}
          <InviteBanner />
        </View>

        <SectionLabel text={t('home.apps')} />
        <View style={styles.grid}>
          {apps.map((app) => {
            const Icon = app.icon
            const name = t(`app.${app.id}.name` as TKey) || app.name
            return (
              <Pressable
                key={app.id}
                onPress={() => router.push(app.route as never)}
                accessibilityRole="button"
                accessibilityLabel={name}
                style={({ pressed }) => [styles.app, { opacity: pressed ? 0.7 : 1 }]}
              >
                <GradientBox colors={APP_GRADIENT[app.id] ?? APP_GRADIENT.admin} radius={20} style={styles.icon}>
                  <Icon size={28} color="#fff" strokeWidth={2} />
                </GradientBox>
                {badges[app.id] ? (
                  <View style={[styles.badge, { borderColor: c.sheet }]}>
                    <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>{badges[app.id]}</Txt>
                  </View>
                ) : null}
                <Txt numberOfLines={1} style={{ fontSize: 12.5, color: c.text, fontFamily: fonts.medium }}>
                  {name}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      {/* the household, always within reach */}
      <View pointerEvents="box-none" style={[styles.dockWrap, { bottom: dockGap }]}>
        <View style={[styles.dock, { backgroundColor: c.sheet, borderColor: c.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.dockRow}>
            {members.map((p) => {
              const tint = memberColor(p.email, memberEmails)
              const initial = (p.display_name || p.email).trim().charAt(0).toUpperCase()
              return (
                <Pressable
                  key={p.email}
                  accessibilityLabel={p.display_name}
                  onPress={() => router.push(`/family?email=${encodeURIComponent(p.email)}`)}
                  style={[styles.avatar, { backgroundColor: tint + '2E' }]}
                >
                  <Txt style={{ fontFamily: fonts.display, fontSize: 17, color: tint }}>{initial}</Txt>
                </Pressable>
              )
            })}
          </ScrollView>
          <Pressable
            onPress={() => router.push('/family')}
            style={[styles.familyBtn, { backgroundColor: c.surface }]}
          >
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{t('home.family')}</Txt>
          </Pressable>
        </View>
      </View>

      <AskSheet key={askKey} visible={asking} listen={askListen} onClose={() => setAsking(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: sp.lg },
  app: { width: '25%', alignItems: 'center', gap: 7 },
  icon: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -6,
    // Pinned to the icon's top-right corner, not the (wider) grid cell's.
    right: '50%',
    marginRight: -40,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FF4D5E',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockWrap: { position: 'absolute', left: sp.lg, right: sp.lg },
  dock: {
    height: DOCK_H,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  dockRow: { alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  familyBtn: { height: 44, borderRadius: 22, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
})
