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
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Settings } from 'lucide-react-native'

import { Txt } from './ui'
import SafetyBanner from '../apps/location/SafetyBanner'
import NudgesBanner from '../apps/pings/NudgesBanner'
import GamesBanner from '../apps/games/GamesBanner'
import TodaySection, { SectionLabel } from './TodaySection'
import HomeBirthdays from './HomeBirthdays'
import InviteBanner from './InviteBanner'
import { AskSheet } from './home/AskSheet'
import { RoofDock, ROOF_DOCK_H } from './home/RoofDock'
import { FamilyStrip } from './home/FamilyStrip'
import { useRoofPrefs, useRoofPrefsReady } from '../lib/roof'
import { turnOnRoofWake, useRoofWake } from '../lib/roofWake'
import { CHIME_MS, playChime, voiceSupported } from '../lib/voice'
import { usePlus } from '../lib/plus'
import { APP_GRADIENT } from './home/palette'
import { GradientBox } from './home/GradientBox'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { useBottomGap } from '../hooks/useBottomGap'
import { useScreenCorner } from '../hooks/useScreenCorner'
import { ADMIN_APP, APPS, type HubApp } from '../lib/apps'
import { WHEREABOUTS_ENABLED } from '../lib/features'
import { useAuth } from '../lib/auth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import type { TKey } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { channelName } from '@/lib/realtime'
import { fonts, sp, useTheme } from '../theme/theme'

export default function Hub() {
  const { c } = useTheme()
  const { profile, profiles } = useAuth()
  const { t, lang } = useI18n()
  const [asking, setAsking] = useState(false)
  const [askKey, setAskKey] = useState(0)
  const [askListen, setAskListen] = useState(false)
  // "Ei Roof, …" — what came after the wake phrase, sent as soon as the sheet opens.
  const [askSeed, setAskSeed] = useState<string | undefined>(undefined)
  const [askVoice, setAskVoice] = useState(false)
  // Opened from the dock's arrow: talk or type (keyboard up too).
  const [askType, setAskType] = useState(false)
  // Roof listens only while the Home is the screen in front, the sheet is
  // closed, the family turned it on and has Plus (lib/roofWake).
  const roof = useRoofPrefs()
  const { isPlus, loading: plusLoading } = usePlus()
  const roofReady = useRoofPrefsReady()
  const [homeFocused, setHomeFocused] = useState(true)
  const [roofPaused, setRoofPaused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setHomeFocused(true)
      return () => setHomeFocused(false)
    }, []),
  )
  // A wake opens the sheet at once, already "listening": the wake recogniser
  // keeps capturing (one chime) and streams what it hears into the sheet.
  // Remounting the sheet (new key) is safe for that capture: the old sheet's
  // useVoice only aborts a session IT started (mic owner token, lib/voice).
  const [wakeCapture, setWakeCapture] = useState(false)
  const [wakeHeard, setWakeHeard] = useState('')
  const [wakeEpoch, setWakeEpoch] = useState(0)
  const [askContinue, setAskContinue] = useState(0)
  const [wakeHold, setWakeHold] = useState(false)
  const wakeHandlers = useMemo(
    () => ({
      onWake: () => {
        setAskKey((k) => k + 1)
        setAskSeed(undefined)
        setAskListen(false)
        setAskVoice(true)
        setAskType(false)
        setWakeHeard('')
        setWakeCapture(true)
        setAsking(true)
      },
      onHeard: setWakeHeard,
      onDone: (request: string, handOff: boolean) => {
        setWakeCapture(false)
        if (request) setAskSeed(request)
        // Just the call and the recogniser ended: the sheet listens with its
        // own mic — "one moment", then its chime when it's really live.
        else if (handOff) setAskContinue((n) => n + 1)
      },
    }),
    [],
  )
  const wake = useRoofWake(
    roof.wake && isPlus && homeFocused && !roofPaused && !wakeHold && (!asking || wakeCapture),
    lang,
    wakeHandlers,
    wakeEpoch,
  )
  // On a Face ID iPhone the dock takes the bottom button's geometry
  // (useScreenCorner); Android keeps the plain floating bar.
  const corner = useScreenCorner()
  const bottomGap = useBottomGap(sp.md)
  const dockGap = corner ? corner.bottom : bottomGap

  const { hiddenApps, appOrder } = useAppPrefs()
  // Hidden apps drop out; ordered ids come first (registry order for the rest);
  // Admin stays pinned last and is never hidden or reordered.
  const apps: HubApp[] = useMemo(() => {
    const pos = new Map(appOrder.map((id, i) => [id, i]))
    const rank = (a: HubApp) => pos.get(a.id) ?? appOrder.length + APPS.findIndex((x) => x.id === a.id)
    // Family isn't a tile: the strip under the greeting is its way in (owner, 2026-11).
    const visible = APPS.filter((a) => a.id !== 'family' && !hiddenApps.includes(a.id)).sort((a, b) => rank(a) - rank(b))
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
      .channel(channelName('hub_shopping_badge'))
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

  const insets = useSafeAreaInsets()
  const openAsk = (listen: boolean, type = false) => {
    setAskKey((k) => k + 1)
    setAskSeed(undefined)
    setAskListen(listen)
    setAskVoice(listen)
    setAskType(type)
    setAsking(true)
  }
  const badges: Record<string, number> = { shopping: shoppingCount }
  const firstName = (profile?.display_name ?? '').split(' ')[0] || 'One Roof'
  const memberEmails = useMemo(() => profiles.map((p) => p.email), [profiles])
  // Me first, then everyone else in the household.
  const members = useMemo(
    () => [...profiles].sort((a, b) => Number(b.email === profile?.email) - Number(a.email === profile?.email)),
    [profiles, profile?.email],
  )

  return (
    // No TOP safe-area edge: the scroll starts at the very top so the header's
    // weather sky (TodaySection → WeatherScene) can run up behind the status
    // bar; the inset is padding inside the scroll instead.
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: sp.lg, paddingTop: insets.top, paddingBottom: ROOF_DOCK_H + dockGap + sp.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <TodaySection
          name={firstName}
          household={householdName ?? null}
          below={<FamilyStrip members={members} emails={memberEmails} me={profile?.email} />}
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
          {/* An open game room — right under the ask bar, so the family sees it
              even with game notifications off (apps/games/GamesBanner). */}
          <GamesBanner />
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
                  // A ring (page colour) with the red pill INSIDE it — not a
                  // borderWidth: iOS paints the fill under the border's
                  // antialiased edge, so the red bled past the dark ring.
                  <View style={[styles.badge, { backgroundColor: c.sheet }]}>
                    <View style={styles.badgeFill}>
                      <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>{badges[app.id]}</Txt>
                    </View>
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

      {/* Roof, by the thumb (owner, 2026-11): tap to type, the big button to
          talk; with "Ei Roof" on, a breathing dot and a pause button. The
          family moved up under the greeting (FamilyStrip). */}
      <View
        pointerEvents="box-none"
        style={[styles.dockWrap, { bottom: dockGap }, corner ? { left: corner.side, right: corner.side } : null]}
      >
        <RoofDock
          wake={!isPlus ? 'needsPlus' : !roof.wake ? 'off' : roofPaused ? 'paused' : wake}
          onOpen={() => openAsk(voiceSupported(), true)}
          onWakeTap={() => {
            if (roof.wake) {
              setRoofPaused((p) => !p)
              return
            }
            void turnOnRoofWake().then((r) => {
              if (r === 'unsupported') Alert.alert(t('settings.roofWake'), t('settings.roofNoDevice'))
              else if (r === 'ok') setRoofPaused(false)
            })
          }}
          shape={corner ? { radius: corner.radius } : null}
          loading={plusLoading || !roofReady}
        />
      </View>

      <AskSheet
        key={askKey}
        visible={asking}
        listen={askListen}
        autoSend={askSeed}
        spoken={askVoice}
        typeToo={askType}
        continueListening={askContinue}
        wakeHeard={wakeCapture ? wakeHeard : undefined}
        onWakeStop={() => {
          // Stop tapped while the wake capture runs: send what was heard.
          setWakeCapture(false)
          if (wakeHeard.trim()) setAskSeed(wakeHeard.trim())
        }}
        onClose={() => {
          // Closed while "Ei Roof" was still capturing: say it stopped.
          if (wakeCapture) playChime('stop')
          setAsking(false)
          setWakeCapture(false)
          // Wait for the closing chime before the wake listener takes the mic
          // again — restarting it mid-chime cut the chime off.
          setWakeHold(true)
          setTimeout(() => {
            setWakeHold(false)
            setWakeEpoch((e) => e + 1)
          }, CHIME_MS + 120)
        }}
      />
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
    top: -8.5,
    // Pinned to the icon's top-right corner, not the (wider) grid cell's.
    right: '50%',
    marginRight: -42.5,
    padding: 2.5,
    borderRadius: 15,
  },
  badgeFill: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FF4D5E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockWrap: { position: 'absolute', left: sp.lg, right: sp.lg },
})
