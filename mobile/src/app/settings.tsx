// Settings: language, appearance, notifications, One Roof Plus, sign out, and
// in-app account deletion (required by Apple Guideline 5.1.1(v)). Sections are
// separated by dividers; Plus shows a certificate badge + the included feature
// list when active, and notifications shows a live on/off status.
import { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import {
  Award,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  FolderLock,
  MapPin,
  ReceiptText,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native'

import { AppHeader, Btn, Card, Field, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import { LANGUAGES, type TKey } from '@/lib/i18n'
import { getPushEnabled, registerForPush } from '@/lib/notifications'
import { geocodeCity, loadHomeLocation, saveHomeLocation, type HomeLocation } from '@/lib/weather'
import { supabase } from '@/lib/supabase'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { useThemePref, type ThemeMode } from '@/theme/theme-pref'
import { useTilePref, type TileStyle } from '@/hooks/useTilePref'

const APPEARANCE: { id: ThemeMode; key: TKey }[] = [
  { id: 'light', key: 'settings.light' },
  { id: 'dark', key: 'settings.dark' },
]

const TILES: { id: TileStyle; key: TKey }[] = [
  { id: 'large', key: 'settings.large' },
  { id: 'compact', key: 'settings.compact' },
]

const PLUS_FEATURES: { icon: LucideIcon; key: TKey }[] = [
  { icon: Sparkles, key: 'settings.plusFeatureScans' },
  { icon: CalendarDays, key: 'settings.plusFeatureCalendar' },
  { icon: ReceiptText, key: 'settings.plusFeatureSplit' },
  { icon: Wallet, key: 'settings.plusFeatureBudgets' },
  { icon: FolderLock, key: 'settings.plusFeatureVault' },
]

export default function Settings() {
  const { c } = useTheme()
  const { mode, setMode } = useThemePref()
  const { tile, setTile } = useTilePref()
  const { profile, signOut } = useAuth()
  const { isPlus, restore } = usePlus()
  const { t, lang, setLang } = useI18n()
  const [pushMsg, setPushMsg] = useState<TKey | null>(null)
  const [pushOn, setPushOn] = useState<boolean | null>(null)

  const [homeLoc, setHomeLoc] = useState<HomeLocation | null>(null)
  const [cityInput, setCityInput] = useState('')
  const [savingCity, setSavingCity] = useState(false)
  const [cityMsg, setCityMsg] = useState<TKey | null>(null)

  // Deep-link from the Hub's "Set city" button (?highlight=weather): scroll to
  // the Weather section and briefly outline it.
  const params = useLocalSearchParams<{ highlight?: string }>()
  const scrollRef = useRef<ScrollView>(null)
  const [weatherY, setWeatherY] = useState<number | null>(null)
  const [highlightWeather, setHighlightWeather] = useState(false)
  const handledHighlight = useRef(false)

  useEffect(() => {
    if (params.highlight !== 'weather' || weatherY == null || handledHighlight.current) return
    // Don't lock in `handledHighlight` until the scroll actually fires — the
    // Plus and Notifications cards above this section resolve async state
    // (isPlus, pushOn) shortly after mount and can change height, re-firing
    // this section's onLayout with a corrected y. Locking too early meant the
    // scroll used a stale pre-settle offset and landed short of the card.
    const id = setTimeout(() => {
      handledHighlight.current = true
      scrollRef.current?.scrollTo({ y: Math.max(0, weatherY - 12), animated: true })
      setHighlightWeather(true)
      setTimeout(() => setHighlightWeather(false), 2400)
    }, 350)
    return () => clearTimeout(id)
  }, [params.highlight, weatherY])

  // Reflect the current OS permission from the start (no prompt).
  useEffect(() => {
    let active = true
    getPushEnabled().then((on) => {
      if (active) setPushOn(on)
    })
    loadHomeLocation().then((loc) => {
      if (active) setHomeLoc(loc)
    })
    return () => {
      active = false
    }
  }, [])

  async function saveCity() {
    const q = cityInput.trim()
    if (!q) return
    setSavingCity(true)
    setCityMsg(null)
    const loc = await geocodeCity(q)
    setSavingCity(false)
    if (!loc) {
      setCityMsg('settings.cityNotFound')
      return
    }
    await saveHomeLocation(loc)
    setHomeLoc(loc)
    setCityInput('')
  }

  async function clearCity() {
    await saveHomeLocation(null)
    setHomeLoc(null)
    setCityMsg(null)
  }

  async function doRestore() {
    try {
      const ok = await restore()
      Alert.alert(
        ok ? t('settings.restoredTitle') : t('settings.nothingRestoreTitle'),
        ok ? t('settings.restoredBody') : t('settings.nothingRestoreBody'),
      )
    } catch {
      Alert.alert(t('settings.restoreFailedTitle'), t('settings.restoreFailedBody'))
    }
  }

  async function enablePush() {
    const r = await registerForPush()
    setPushOn(r.ok ? true : await getPushEnabled())
    setPushMsg(
      r.ok
        ? 'settings.pushEnabled'
        : r.reason === 'simulator'
          ? 'settings.pushSimulator'
          : r.reason === 'no-project'
            ? 'settings.pushNoProject'
            : r.reason === 'denied'
              ? 'settings.pushDenied'
              : 'settings.pushFailed',
    )
  }

  async function doSignOut() {
    await signOut()
    // The session is gone, but Settings is still on top of the stack. Unwind any
    // pushed screens back to the root route ("/"), which gates on session and now
    // renders the Login screen.
    if (router.canDismiss()) router.dismissAll()
    router.replace('/')
  }

  function confirmDelete() {
    Alert.alert(
      t('settings.deleteAccount'),
      t('settings.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
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
              Alert.alert(t('settings.deleteFailedTitle'), error.message)
              return
            }
            await doSignOut()
          },
        },
      ],
    )
  }

  return (
    <Screen scroll scrollRef={scrollRef} header={<AppHeader title={t('settings.title')} />}>
      <View style={{ gap: sp.xl }}>
        {/* One Roof Plus */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.plus')}</Txt>
          {isPlus ? (
            <Card style={{ gap: sp.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                <View
                  style={{
                    height: 48,
                    width: 48,
                    borderRadius: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: c.accentSoft,
                  }}
                >
                  <Award size={26} color={c.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{t('settings.plus')}</Txt>
                  <Txt variant="faint">{t('settings.plusActive')}</Txt>
                </View>
                <StatusPill on label={t('settings.active')} />
              </View>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
              <View style={{ gap: sp.sm }}>
                {PLUS_FEATURES.map((f) => (
                  <FeatureRow key={f.key} icon={f.icon} label={t(f.key)} included />
                ))}
              </View>
            </Card>
          ) : (
            <Card style={{ gap: sp.md }}>
              <Txt variant="muted">{t('settings.plusUnlock')}</Txt>
              <View style={{ gap: sp.sm }}>
                {PLUS_FEATURES.map((f) => (
                  <FeatureRow key={f.key} icon={f.icon} label={t(f.key)} />
                ))}
              </View>
            </Card>
          )}

          {isPlus ? (
            <Btn
              title={t('settings.manageSubscription')}
              variant="secondary"
              onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
            />
          ) : (
            <>
              <Btn title={t('settings.getPlus')} onPress={() => router.push('/paywall')} />
              <Pressable onPress={doRestore} style={{ paddingVertical: sp.sm, alignItems: 'center' }}>
                <Txt style={{ color: c.accent, fontWeight: '600' }}>
                  {t('settings.restorePurchases')}
                </Txt>
              </Pressable>
            </>
          )}
        </View>

        <Divider />

        {/* Language */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.language')}</Txt>
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

        <Divider />

        {/* Appearance */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.appearance')}</Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {APPEARANCE.map((a) => {
              const active = a.id === mode
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setMode(a.id)}
                  style={{
                    paddingHorizontal: sp.md,
                    paddingVertical: sp.sm,
                    borderRadius: radius.md,
                    backgroundColor: active ? c.accentSoft : c.card,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                  }}
                >
                  <Txt variant={active ? 'body' : 'muted'}>{t(a.key)}</Txt>
                </Pressable>
              )
            })}
          </View>
        </View>

        <Divider />

        {/* App cards (home screen tile density) */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.appCards')}</Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {TILES.map((tl) => {
              const active = tl.id === tile
              return (
                <Pressable
                  key={tl.id}
                  onPress={() => setTile(tl.id)}
                  style={{
                    paddingHorizontal: sp.md,
                    paddingVertical: sp.sm,
                    borderRadius: radius.md,
                    backgroundColor: active ? c.accentSoft : c.card,
                    borderWidth: 1,
                    borderColor: active ? c.accent : c.border,
                  }}
                >
                  <Txt variant={active ? 'body' : 'muted'}>{t(tl.key)}</Txt>
                </Pressable>
              )
            })}
          </View>
          <Txt variant="faint">{t('settings.compactHint')}</Txt>
        </View>

        <Divider />

        {/* Notifications */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.notifications')}</Txt>
          <Card style={{ gap: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View
                style={{
                  height: 40,
                  width: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pushOn ? c.accentSoft : c.surface,
                }}
              >
                {pushOn ? (
                  <BellRing size={20} color={c.accent} />
                ) : (
                  <Bell size={20} color={c.textMuted} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold }}>{t('settings.pushReminders')}</Txt>
                <Txt variant="faint">{t('settings.pushRemindersHint')}</Txt>
              </View>
              <StatusPill on={!!pushOn} label={pushOn ? t('common.on') : t('common.off')} />
            </View>

            {pushOn ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Txt style={{ color: c.accent, fontFamily: fonts.semibold }}>
                  {t('settings.manageInIos')}
                </Txt>
              </Pressable>
            ) : (
              <Btn
                title={t('settings.enableNotifications')}
                variant="secondary"
                onPress={enablePush}
              />
            )}
            {pushMsg ? <Txt variant="faint">{t(pushMsg)}</Txt> : null}
          </Card>
        </View>

        <Divider />

        {/* Weather / home city (drives the Today section on the home screen) */}
        <View
          style={{ gap: sp.sm }}
          onLayout={(e) => setWeatherY(e.nativeEvent.layout.y)}
        >
          <Txt variant="label">{t('settings.weather')}</Txt>
          <Card
            style={{
              gap: sp.md,
              ...(highlightWeather ? { borderWidth: 2, borderColor: c.accent } : {}),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View
                style={{
                  height: 40,
                  width: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: homeLoc ? c.accentSoft : c.surface,
                }}
              >
                <MapPin size={20} color={homeLoc ? c.accent : c.textMuted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold }}>{t('settings.homeCity')}</Txt>
                <Txt variant="faint" numberOfLines={1}>
                  {homeLoc ? homeLoc.city : t('settings.homeCityHint')}
                </Txt>
              </View>
              {homeLoc ? (
                <Pressable onPress={clearCity} hitSlop={8}>
                  <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 13 }}>
                    {t('common.remove')}
                  </Txt>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  value={cityInput}
                  onChangeText={setCityInput}
                  placeholder={t('settings.cityPlaceholder')}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={saveCity}
                />
              </View>
              <Btn
                title={t('settings.set')}
                onPress={saveCity}
                loading={savingCity}
                disabled={!cityInput.trim()}
              />
            </View>
            {cityMsg ? <Txt variant="faint">{t(cityMsg)}</Txt> : null}
          </Card>
        </View>

        <Divider />

        {/* Account */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.account')}</Txt>
          <Card>
            <Txt variant="muted">{profile?.email ?? ''}</Txt>
          </Card>
          <Btn title={t('settings.signOut')} variant="secondary" onPress={doSignOut} />
          <Pressable onPress={confirmDelete} style={{ paddingVertical: sp.md, alignItems: 'center' }}>
            <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('settings.deleteAccount')}</Txt>
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}

function Divider() {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
}

function StatusPill({ on, label }: { on: boolean; label?: string }) {
  const { c } = useTheme()
  const text = label ?? (on ? 'ON' : 'OFF')
  return (
    <View
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: on ? c.accentSoft : c.surface,
      }}
    >
      <Txt
        style={{
          fontSize: 11,
          fontFamily: fonts.semibold,
          letterSpacing: 0.5,
          color: on ? c.accent : c.textMuted,
        }}
      >
        {text}
      </Txt>
    </View>
  )
}

function FeatureRow({
  icon: Icon,
  label,
  included,
}: {
  icon: LucideIcon
  label: string
  included?: boolean
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
      <View
        style={{
          height: 28,
          width: 28,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surface,
        }}
      >
        <Icon size={16} color={c.accent} />
      </View>
      <Txt style={{ flex: 1, minWidth: 0 }}>{label}</Txt>
      {included ? <Check size={16} color={c.income} strokeWidth={2.5} /> : null}
    </View>
  )
}
