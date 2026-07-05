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
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native'

import { AppHeader, Btn, Card, Field, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import { LANGUAGES } from '@/lib/i18n'
import { getPushEnabled, registerForPush } from '@/lib/notifications'
import { geocodeCity, loadHomeLocation, saveHomeLocation, type HomeLocation } from '@/lib/weather'
import { supabase } from '@/lib/supabase'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { useThemePref, type ThemeMode } from '@/theme/theme-pref'
import { useTilePref, type TileStyle } from '@/hooks/useTilePref'

const APPEARANCE: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const TILES: { id: TileStyle; label: string }[] = [
  { id: 'large', label: 'Large' },
  { id: 'compact', label: 'Compact' },
]

const PLUS_FEATURES: { icon: LucideIcon; label: string }[] = [
  { icon: Sparkles, label: 'Unlimited AI receipt & bill scans' },
  { icon: FolderLock, label: 'Document Vault with Face ID lock' },
  { icon: CalendarDays, label: 'Google Calendar two-way sync' },
]

export default function Settings() {
  const { c } = useTheme()
  const { mode, setMode } = useThemePref()
  const { tile, setTile } = useTilePref()
  const { profile, signOut } = useAuth()
  const { isPlus, restore } = usePlus()
  const { lang, setLang } = useI18n()
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [pushOn, setPushOn] = useState<boolean | null>(null)

  const [homeLoc, setHomeLoc] = useState<HomeLocation | null>(null)
  const [cityInput, setCityInput] = useState('')
  const [savingCity, setSavingCity] = useState(false)
  const [cityMsg, setCityMsg] = useState<string | null>(null)

  // Deep-link from the Hub's "Set city" button (?highlight=weather): scroll to
  // the Weather section and briefly outline it.
  const params = useLocalSearchParams<{ highlight?: string }>()
  const scrollRef = useRef<ScrollView>(null)
  const [weatherY, setWeatherY] = useState<number | null>(null)
  const [highlightWeather, setHighlightWeather] = useState(false)
  const handledHighlight = useRef(false)

  useEffect(() => {
    if (params.highlight !== 'weather' || weatherY == null || handledHighlight.current) return
    handledHighlight.current = true
    const id = setTimeout(() => {
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
      setCityMsg("Couldn't find that city. Try a different spelling.")
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
        ok ? 'Purchases restored' : 'Nothing to restore',
        ok ? "You're on One Roof Plus." : 'No previous purchase was found for this Apple ID.',
      )
    } catch {
      Alert.alert('Restore failed', 'Please try again.')
    }
  }

  async function enablePush() {
    const r = await registerForPush()
    setPushOn(r.ok ? true : await getPushEnabled())
    setPushMsg(
      r.ok
        ? 'Notifications enabled on this device.'
        : r.reason === 'simulator'
          ? 'Push needs a real device.'
          : r.reason === 'no-project'
            ? 'Run `eas init` first (needs an EAS project id).'
            : r.reason === 'denied'
              ? 'Notifications are off in iOS Settings — turn them on there.'
              : 'Could not enable notifications.',
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
            await doSignOut()
          },
        },
      ],
    )
  }

  return (
    <Screen scroll scrollRef={scrollRef} header={<AppHeader title="Settings" />}>
      <View style={{ gap: sp.xl }}>
        {/* One Roof Plus */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">One Roof Plus</Txt>
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
                  <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>One Roof Plus</Txt>
                  <Txt variant="faint">Active · your whole household</Txt>
                </View>
                <StatusPill on label="ACTIVE" />
              </View>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
              <View style={{ gap: sp.sm }}>
                {PLUS_FEATURES.map((f) => (
                  <FeatureRow key={f.label} icon={f.icon} label={f.label} included />
                ))}
              </View>
            </Card>
          ) : (
            <Card style={{ gap: sp.md }}>
              <Txt variant="muted">Unlock the whole household with One Roof Plus:</Txt>
              <View style={{ gap: sp.sm }}>
                {PLUS_FEATURES.map((f) => (
                  <FeatureRow key={f.label} icon={f.icon} label={f.label} />
                ))}
              </View>
            </Card>
          )}

          {isPlus ? (
            <Btn
              title="Manage subscription"
              variant="secondary"
              onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')}
            />
          ) : (
            <>
              <Btn title="Get One Roof Plus" onPress={() => router.push('/paywall')} />
              <Pressable onPress={doRestore} style={{ paddingVertical: sp.sm, alignItems: 'center' }}>
                <Txt style={{ color: c.accent, fontWeight: '600' }}>Restore purchases</Txt>
              </Pressable>
            </>
          )}
        </View>

        <Divider />

        {/* Language */}
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

        <Divider />

        {/* Appearance */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Appearance</Txt>
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
                  <Txt variant={active ? 'body' : 'muted'}>{a.label}</Txt>
                </Pressable>
              )
            })}
          </View>
        </View>

        <Divider />

        {/* App cards (home screen tile density) */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">App cards</Txt>
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
                  <Txt variant={active ? 'body' : 'muted'}>{tl.label}</Txt>
                </Pressable>
              )
            })}
          </View>
          <Txt variant="faint">
            Compact fits more apps per row on the home screen (icon + name only).
          </Txt>
        </View>

        <Divider />

        {/* Notifications */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Notifications</Txt>
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
                <Txt style={{ fontFamily: fonts.semibold }}>Push reminders</Txt>
                <Txt variant="faint">Pet care, calendar dates and family nudges</Txt>
              </View>
              <StatusPill on={!!pushOn} />
            </View>

            {pushOn ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Txt style={{ color: c.accent, fontFamily: fonts.semibold }}>
                  Manage in iOS Settings
                </Txt>
              </Pressable>
            ) : (
              <Btn title="Enable notifications" variant="secondary" onPress={enablePush} />
            )}
            {pushMsg ? (
              <Txt variant="faint">{pushMsg}</Txt>
            ) : null}
          </Card>
        </View>

        <Divider />

        {/* Weather / home city (drives the Today section on the home screen) */}
        <View
          style={{ gap: sp.sm }}
          onLayout={(e) => setWeatherY(e.nativeEvent.layout.y)}
        >
          <Txt variant="label">Weather</Txt>
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
                <Txt style={{ fontFamily: fonts.semibold }}>Home city</Txt>
                <Txt variant="faint" numberOfLines={1}>
                  {homeLoc ? homeLoc.city : "Set your city for today's weather at home"}
                </Txt>
              </View>
              {homeLoc ? (
                <Pressable onPress={clearCity} hitSlop={8}>
                  <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 13 }}>
                    Remove
                  </Txt>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  value={cityInput}
                  onChangeText={setCityInput}
                  placeholder="e.g. Austin"
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={saveCity}
                />
              </View>
              <Btn
                title="Set"
                onPress={saveCity}
                loading={savingCity}
                disabled={!cityInput.trim()}
              />
            </View>
            {cityMsg ? <Txt variant="faint">{cityMsg}</Txt> : null}
          </Card>
        </View>

        <Divider />

        {/* Account */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">Account</Txt>
          <Card>
            <Txt variant="muted">{profile?.email ?? ''}</Txt>
          </Card>
          <Btn title="Sign out" variant="secondary" onPress={doSignOut} />
          <Pressable onPress={confirmDelete} style={{ paddingVertical: sp.md, alignItems: 'center' }}>
            <Txt style={{ color: c.expense, fontWeight: '600' }}>Delete account</Txt>
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
