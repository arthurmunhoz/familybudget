// Settings: language, appearance, notifications, One Roof Plus, sign out, and
// in-app account deletion (required by Apple Guideline 5.1.1(v)). Sections are
// separated by dividers; Plus shows a certificate badge + the included feature
// list when active, and notifications shows a live on/off status.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import { Toggle } from '@/components/Toggle'
import { Pressable as SafePressable } from '@/components/Pressable'
import { router, useLocalSearchParams } from 'expo-router'
import {
  Award,
  Bell,
  BellRing,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  LogOut,
  Mail,
  Trash2,
  CalendarDays,
  Check,
  FolderLock,
  Lock,
  MapPin,
  ReceiptText,
  RefreshCw,
  Share2,
  Sparkles,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react-native'

import { Btn, Card, Field, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, type Gradient } from '@/components/home/palette'
import { DraggableList } from '@/components/DraggableList'
import { useAppPrefs } from '@/hooks/useAppPrefs'
import { APPS } from '@/lib/apps'
import { useAuth } from '@/lib/auth'
import { usePlus, memberLimit, MEMBER_LIMIT_PLUS } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import { LANGUAGES, platformKey, type TKey } from '@/lib/i18n'
import { getPushEnabled, registerForPush } from '@/lib/notifications'
import {
  fetchCurrentWeather,
  loadHomeLocation,
  saveHomeLocation,
  searchCities,
  weatherIcon,
  type CurrentWeather,
  type HomeLocation,
} from '@/lib/weather'
import { supabase } from '@/lib/supabase'
import { dark, fonts, light, radius, sp, useTheme } from '@/theme/theme'
import { useThemePref } from '@/theme/theme-pref'

const PLUS_FEATURES: { icon: LucideIcon; key: TKey }[] = [
  { icon: Sparkles, key: 'settings.plusFeatureScans' },
  { icon: CalendarDays, key: 'settings.plusFeatureCalendar' },
  { icon: ReceiptText, key: 'settings.plusFeatureSplit' },
  { icon: Wallet, key: 'settings.plusFeatureBudgets' },
  { icon: Users, key: 'settings.plusFeatureMembers' },
  { icon: Lock, key: 'settings.plusFeaturePrivate' },
  { icon: FolderLock, key: 'settings.plusFeatureVault' },
]

// Where "Manage subscription" goes when RevenueCat has no `managementUrl` for
// us (see below) — this device's own store. A paid plan is managed by the STORE
// that sold it, and the Apple URL is a dead end on Android: it opens a browser
// page the user has no account on. Play's deep link needs no package/sku to
// land on the user's subscription list.
const DEVICE_STORE_SUBSCRIPTIONS_URL =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions'

// Warm golden tones for the Plus card confetti.
const CONFETTI_GOLDS = ['#F4C95D', '#E7B24A', '#D99E3B', '#F8DE93']

type ConfettiPiece = {
  left: number // % across the card
  size: number
  color: string
  delay: number // ms stagger
  duration: number // ms fall
  drift: number // px horizontal
  spin: 1 | 2 | -1 | -2
}

function makeConfetti(count: number): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => ({
    left: Math.random() * 100,
    size: 5 + Math.random() * 5,
    color: CONFETTI_GOLDS[i % CONFETTI_GOLDS.length],
    delay: Math.random() * 450,
    duration: 1500 + Math.random() * 1000,
    drift: (Math.random() - 0.5) * 44,
    spin: ((Math.random() < 0.5 ? -1 : 1) * (1 + Math.round(Math.random()))) as 1 | 2 | -1 | -2,
  }))
}

// One-shot golden confetti that rains once inside the Plus card when it mounts
// (i.e. when a Plus member opens Settings), then unmounts itself — no persistent
// animation. Sizes itself to the card via the absolute-fill container's onLayout,
// and is skipped entirely when the OS "Reduce Motion" setting is on.
function PlusConfetti() {
  const pieces = useRef(makeConfetti(18)).current
  const progress = useRef(pieces.map(() => new Animated.Value(0))).current
  const [height, setHeight] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce && !cancelled) setDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (height <= 0 || done) return
    const anims = pieces.map((p, i) =>
      Animated.timing(progress[i], {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        easing: Easing.in(Easing.quad), // accelerate downward, like gravity
        useNativeDriver: true,
      }),
    )
    Animated.parallel(anims).start(({ finished }) => {
      if (finished) setDone(true)
    })
  }, [height, done, pieces, progress])

  if (done) return null

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {height > 0 &&
        pieces.map((p, i) => {
          const t = progress[i]
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 0.62,
                borderRadius: 1.5,
                backgroundColor: p.color,
                opacity: t.interpolate({
                  inputRange: [0, 0.08, 0.72, 1],
                  outputRange: [0, 0.85, 0.85, 0],
                }),
                transform: [
                  { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-14, height + 14] }) },
                  { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
                  { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin * 180}deg`] }) },
                ],
              }}
            />
          )
        })}
    </View>
  )
}

// Household members + (owner-only) invite code. Fetches its own data so it can
// refresh after a member is removed. Uses the migration-051 owner RPCs.
function HouseholdSection({ highlight = false }: { highlight?: boolean }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { isPlus, isFree } = usePlus()
  const limit = memberLimit(isPlus)
  const isOwner = profile?.role === 'owner'
  const hid = profile?.household_id ?? null
  const [name, setName] = useState<string | null>(null)
  const [members, setMembers] = useState<{ email: string; display_name: string; role: string }[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  const load = useCallback(async () => {
    if (!hid) return
    const [h, m] = await Promise.all([
      supabase.from('households').select('name').eq('id', hid).maybeSingle(),
      supabase
        .from('allowed_users')
        .select('email, display_name, role')
        .eq('household_id', hid)
        .order('display_name'),
    ])
    setName((h.data as { name?: string } | null)?.name ?? null)
    setMembers((m.data as { email: string; display_name: string; role: string }[]) ?? [])
  }, [hid])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isOwner) {
      setCode(null)
      return
    }
    supabase.rpc('get_join_code').then(({ data }) => setCode(typeof data === 'string' ? data : null))
  }, [isOwner])

  async function shareCode() {
    if (!code) return
    try {
      await Share.share({ message: t('household.shareMessage', { code }) })
    } catch {
      /* user dismissed the share sheet */
    }
  }

  function rotate() {
    Alert.alert(t('household.rotateTitle'), t('household.rotateConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('household.rotate'),
        style: 'destructive',
        onPress: async () => {
          setRotating(true)
          const { data, error } = await supabase.rpc('rotate_join_code')
          setRotating(false)
          if (error || typeof data !== 'string') {
            Alert.alert(t('household.rotateError'))
            return
          }
          setCode(data)
        },
      },
    ])
  }

  function removeMember(m: { email: string; display_name: string }) {
    Alert.alert(t('household.removeMember'), t('household.removeConfirm', { name: m.display_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('remove_member', { p_email: m.email })
          if (error) {
            Alert.alert(t('household.removeError'))
            return
          }
          void load()
        },
      },
    ])
  }

  return (
    <View style={{ gap: sp.sm }}>
      <SectionLabel>{t('household.title')}</SectionLabel>
      <Card style={{ gap: sp.md }}>
        {name ? <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 25 }}>{name}</Txt> : null}
        <View style={{ gap: sp.md }}>
          {members.map((m) => (
            <View key={m.email} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <Initials name={m.display_name} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
                    {m.display_name}
                  </Txt>
                  {m.role === 'owner' ? (
                    <View style={{ backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 10 }}>
                        {t('household.owner').toUpperCase()}
                      </Txt>
                    </View>
                  ) : null}
                </View>
                <Txt variant="faint" style={{ fontSize: 11 }} numberOfLines={1}>
                  {m.email}
                </Txt>
              </View>
              {isOwner && m.role !== 'owner' ? (
                <Pressable onPress={() => removeMember(m)} hitSlop={8} accessibilityLabel={t('household.removeMember')}>
                  <X size={18} color={c.textFaint} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>

        {/* Member count + (free owners only) a nudge to Plus for more room. The
            DB trigger is the real cap (migration 059); this is just the pitch. */}
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: sp.md, gap: 4 }}>
          <Txt variant="faint">{t('household.memberCount', { count: members.length, max: limit })}</Txt>
          {isOwner && isFree ? (
            <Pressable onPress={() => router.push('/paywall')} hitSlop={6}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13 }}>
                {t('household.upgradeForMembers', { max: MEMBER_LIMIT_PLUS })}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Card>

      {isOwner ? (
        <Card style={{ gap: sp.md, ...(highlight ? { borderWidth: 2, borderColor: c.accent } : {}) }}>
          <View style={{ gap: 2 }}>
            <Txt style={{ fontFamily: fonts.semibold }}>{t('household.inviteCode')}</Txt>
            <Txt variant="faint">{t('household.inviteHint')}</Txt>
          </View>
          {/* Code and its two actions on one row (2026-11): the old layout
              stacked a full-width code box over two full-width buttons and
              read as empty. Share is the action; reset is a quiet icon. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
            <View
              style={{
                flex: 1,
                height: 48,
                justifyContent: 'center',
                paddingHorizontal: sp.md,
                backgroundColor: c.surface,
                borderRadius: radius.md,
              }}
            >
              <Txt
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontSize: 20, letterSpacing: 3, fontFamily: fonts.semibold, color: c.text }}
              >
                {code ?? '········'}
              </Txt>
            </View>
            <SafePressable
              onPress={shareCode}
              disabled={!code}
              accessibilityRole="button"
              style={({ pressed }) => ({
                height: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: sp.md,
                borderRadius: radius.md,
                backgroundColor: c.action,
                opacity: !code ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Share2 size={16} color={c.onAction} />
              <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 15 }}>{t('household.share')}</Txt>
            </SafePressable>
            <SafePressable
              onPress={rotate}
              disabled={rotating}
              accessibilityRole="button"
              accessibilityLabel={t('household.rotate')}
              style={({ pressed }) => ({
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                backgroundColor: c.surface,
                opacity: rotating ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              {rotating ? <ActivityIndicator size="small" color={c.textMuted} /> : <RefreshCw size={18} color={c.textMuted} />}
            </SafePressable>
          </View>
        </Card>
      ) : (
        <Txt variant="faint">{t('household.notOwnerHint')}</Txt>
      )}
    </View>
  )
}

// Palette-accurate mini preview of the app (used by the Appearance picker). Takes
// the light OR dark token set so each option always shows its own theme,
// regardless of the theme currently active.
function ThemePreview({ p }: { p: typeof light }) {
  return (
    <View style={{ height: 74, borderRadius: 10, backgroundColor: p.bg, padding: 8, gap: 6, overflow: 'hidden' }}>
      <View style={{ gap: 3 }}>
        <View style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: p.text }} />
        <View style={{ width: 26, height: 4, borderRadius: 2, backgroundColor: p.textMuted }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 26,
              borderRadius: 7,
              backgroundColor: p.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: p.border,
              padding: 5,
              justifyContent: 'space-between',
            }}
          >
            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: p.accent }} />
            <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: p.textMuted }} />
          </View>
        ))}
      </View>
    </View>
  )
}

// Mini preview of a COLOUR SCHEME: the wash it paints behind everything, plus a
// glass card and the accent on top. Rendered in the currently-active light/dark
// mode, since a scheme defines both and you only ever see one at a time.
// A selectable option: a preview thumbnail + label, with a selected ring + check.
function OptionCard({
  selected,
  onPress,
  label,
  children,
}: {
  selected: boolean
  onPress: () => void
  label: string
  children: ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        gap: 6,
        padding: 6,
        borderRadius: radius.md + 2,
        borderWidth: 2,
        borderColor: selected ? c.accent : c.border,
        backgroundColor: c.card,
      }}
    >
      {children}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        {selected ? <Check size={14} color={c.accent} strokeWidth={3} /> : null}
        <Txt
          variant={selected ? 'body' : 'muted'}
          style={{ fontSize: 13, fontFamily: selected ? fonts.semibold : fonts.body }}
        >
          {label}
        </Txt>
      </View>
    </Pressable>
  )
}

const PLUS_GRADIENT: Gradient = ['#8E6CF0', '#C2468E']

const s_ = StyleSheet.create({
  plusBtn: { height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
})

export default function Settings() {
  // `dark` is aliased: this module also imports the Warm Hearth `dark` token set.
  const { c } = useTheme()
  const { mode, setMode } = useThemePref()
  const { hiddenApps, appOrder, toggleApp, setAppOrder } = useAppPrefs()
  // Every app (hidden ones dimmed), in the user's hub order — same ranking the
  // Hub applies, so what you see here is what the home screen does.
  const orderedApps = useMemo(() => {
    const pos = new Map(appOrder.map((id, i) => [id, i]))
    const rank = (id: string) => pos.get(id) ?? appOrder.length + APPS.findIndex((x) => x.id === id)
    return [...APPS].sort((a, b) => rank(a.id) - rank(b.id))
  }, [appOrder])
  const { profile, signOut } = useAuth()
  const { isPlus, restore, isTrial, trialDaysLeft, trialExpired, managementUrl } = usePlus()
  const { t, lang, setLang } = useI18n()
  const [pushMsg, setPushMsg] = useState<TKey | null>(null)
  const [pushOn, setPushOn] = useState<boolean | null>(null)

  const [homeLoc, setHomeLoc] = useState<HomeLocation | null>(null)
  const [cityInput, setCityInput] = useState('')
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([])
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState<CurrentWeather | null>(null)
  const [cityMsg, setCityMsg] = useState<TKey | null>(null)
  const unit = lang === 'en' ? 'fahrenheit' : 'celsius'

  // Deep-link to a section and briefly outline it — from the Hub's "Set city"
  // button (?highlight=weather) and its invite banner (?highlight=invite).
  // Each target registers its own y via onLayout under the same key.
  const params = useLocalSearchParams<{ highlight?: string }>()
  const scrollRef = useRef<ScrollView>(null)
  const [sectionY, setSectionY] = useState<Record<string, number>>({})
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const handledHighlight = useRef(false)
  const registerSection = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      const { y } = e.nativeEvent.layout
      setSectionY((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }))
    },
    [],
  )

  const target = params.highlight
  const targetY = target ? sectionY[target] : undefined
  useEffect(() => {
    if (!target || targetY == null || handledHighlight.current) return
    // Don't lock in `handledHighlight` until the scroll actually fires — the
    // Plus and Notifications cards above resolve async state (isPlus, pushOn)
    // shortly after mount and can change height, re-firing a section's onLayout
    // with a corrected y. Locking too early meant the scroll used a stale
    // pre-settle offset and landed short of the card.
    const id = setTimeout(() => {
      handledHighlight.current = true
      scrollRef.current?.scrollTo({ y: Math.max(0, targetY - 12), animated: true })
      setHighlighted(target)
      setTimeout(() => setHighlighted(null), 2400)
    }, 350)
    return () => clearTimeout(id)
  }, [target, targetY])

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

  // Live city autocomplete (debounced) — replaces the old geocode-on-submit.
  useEffect(() => {
    const q = cityInput.trim()
    if (q.length < 2) {
      setSuggestions([])
      setSearching(false)
      return
    }
    setSearching(true)
    let active = true
    const id = setTimeout(async () => {
      const results = await searchCities(q)
      if (active) {
        setSuggestions(results)
        setSearching(false)
        setCityMsg(results.length === 0 ? 'settings.cityNotFound' : null)
      }
    }, 300)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [cityInput])

  // Current conditions for the saved city → shown in the card.
  useEffect(() => {
    if (!homeLoc) {
      setPreview(null)
      return
    }
    let active = true
    fetchCurrentWeather(homeLoc.lat, homeLoc.lon, unit).then((w) => {
      if (active) setPreview(w)
    })
    return () => {
      active = false
    }
  }, [homeLoc, unit])

  async function pickCity(loc: HomeLocation) {
    await saveHomeLocation(loc)
    setHomeLoc(loc)
    setCityInput('')
    setSuggestions([])
    setCityMsg(null)
  }

  async function clearCity() {
    await saveHomeLocation(null)
    setHomeLoc(null)
    setPreview(null)
    setCityMsg(null)
  }

  async function doRestore() {
    try {
      const ok = await restore()
      Alert.alert(
        ok ? t('settings.restoredTitle') : t('settings.nothingRestoreTitle'),
        ok
          ? t('settings.restoredBody')
          : t(platformKey('settings.nothingRestoreBody')),
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
              ? platformKey('settings.pushDenied')
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
    <Screen
      scroll
      scrollRef={scrollRef}
      header={
        // Home-style top bar: a round back button; the title sits big in the page.
        <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: c.card,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ChevronLeft size={22} color={c.text} />
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: sp.xl }}>
        {/* Big title, who you are faded under it — the Home's voice. */}
        <View>
          <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
            {t('settings.title')}
          </Txt>
          {profile?.display_name ? (
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }} numberOfLines={1}>
              {profile.display_name}
            </Txt>
          ) : null}
        </View>

        {/* One Roof Plus — a gradient card, like the Home's (2026-11): status,
            what's included and the one action all inside it. */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.plus')}</SectionLabel>
          <GradientBox colors={PLUS_GRADIENT} radius={24} style={{ padding: sp.lg, gap: sp.md, overflow: 'hidden' }}>
            {isPlus ? <PlusConfetti /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Award size={26} color="#fff" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: '#fff' }}>{t('settings.plus')}</Txt>
                {/* On the signup trial everything is unlocked, but "active" would
                    imply a subscription they don't have — say how long is left. */}
                <Txt style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)' }}>
                  {isPlus
                    ? isTrial
                      ? trialDaysLeft === 0
                        ? t('settings.trialEndsToday')
                        : t('settings.trialDaysLeft', { count: trialDaysLeft ?? 0 })
                      : t('settings.plusActive')
                    : trialExpired
                      ? t('settings.trialEnded')
                      : t('settings.plusUnlock')}
                </Txt>
              </View>
              {isPlus ? (
                <View style={{ borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.22)' }}>
                  <Txt style={{ fontSize: 11, fontFamily: fonts.semibold, letterSpacing: 0.5, color: '#fff' }}>
                    {(isTrial ? t('settings.trial') : t('settings.active')).toUpperCase()}
                  </Txt>
                </View>
              ) : null}
            </View>
            <View style={{ gap: 9 }}>
              {PLUS_FEATURES.map((f) => (
                <FeatureRow key={f.key} icon={f.icon} label={t(platformKey(f.key))} included={isPlus} />
              ))}
            </View>
            {isPlus && !isTrial ? (
              // RevenueCat's managementUrl points at the store that SOLD this
              // subscription — the only right answer once the app is on two stores.
              <Pressable
                onPress={() => Linking.openURL(managementUrl ?? DEVICE_STORE_SUBSCRIPTIONS_URL)}
                accessibilityRole="button"
                style={({ pressed }) => [s_.plusBtn, { backgroundColor: 'rgba(255,255,255,0.2)', opacity: pressed ? 0.7 : 1 }]}
              >
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: '#fff' }}>{t('settings.manageSubscription')}</Txt>
              </Pressable>
            ) : (
              // A trial is granted by our server — no store subscription to manage;
              // the useful action is to convert. Same button for a free household.
              <Pressable
                onPress={() => router.push('/paywall')}
                accessibilityRole="button"
                style={({ pressed }) => [s_.plusBtn, { backgroundColor: '#fff', opacity: pressed ? 0.85 : 1 }]}
              >
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: PLUS_GRADIENT[1] }}>
                  {isPlus ? t('settings.keepPlus') : t('settings.getPlus')}
                </Txt>
              </Pressable>
            )}
          </GradientBox>
          {!isPlus ? (
            <Pressable onPress={doRestore} style={{ paddingVertical: sp.xs, alignItems: 'center' }}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold }}>{t('settings.restorePurchases')}</Txt>
            </Pressable>
          ) : null}
        </View>

        <View onLayout={registerSection('invite')}>
          <HouseholdSection highlight={highlighted === 'invite'} />
        </View>


        {/* Language */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.language')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            {LANGUAGES.map((l) => {
              const active = l.id === lang
              return (
                <Pressable
                  key={l.id}
                  onPress={() => setLang(l.id)}
                  style={{
                    // Three languages, three equal thirds of the row.
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 46,
                    paddingHorizontal: sp.sm,
                    borderRadius: 16,
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


        {/* Appearance */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.appearance')}</SectionLabel>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <OptionCard selected={mode === 'light'} onPress={() => setMode('light')} label={t('settings.light')}>
              <ThemePreview p={light} />
            </OptionCard>
            <OptionCard selected={mode === 'dark'} onPress={() => setMode('dark')} label={t('settings.dark')}>
              <ThemePreview p={dark} />
            </OptionCard>
          </View>
        </View>



        {/* Which apps show on the hub, and in what order */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.apps')}</SectionLabel>
          <Card>
            <DraggableList
              data={orderedApps}
              rowHeight={52}
              onReorder={setAppOrder}
              renderItem={(app) => {
                const hidden = hiddenApps.includes(app.id)
                return (
                  <View
                    style={{
                      height: 52,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.md,
                      paddingHorizontal: sp.xs,
                      opacity: hidden ? 0.45 : 1,
                    }}
                  >
                    <GripVertical size={16} color={c.textFaint} />
                    <IconTile colors={APP_GRADIENT[app.id] ?? APP_GRADIENT.admin} size={32}>
                      <app.icon size={16} color="#fff" />
                    </IconTile>
                    <Txt style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>
                      {t(`app.${app.id}.name` as TKey)}
                    </Txt>
                    <Toggle
                      value={!hidden}
                      onValueChange={() => toggleApp(app.id)}
                    />
                  </View>
                )
              }}
            />
          </Card>
          <Txt variant="faint">{t('settings.appsHint')}</Txt>
        </View>


        {/* Notifications */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.notifications')}</SectionLabel>
          <Card style={{ gap: sp.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <IconTile colors={pushOn ? ['#F25C7A', '#C93D63'] : ['#9AA0AA', '#737985']}>
                {pushOn ? <BellRing size={20} color="#fff" /> : <Bell size={20} color="#fff" />}
              </IconTile>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold }}>{t('settings.pushReminders')}</Txt>
                <Txt variant="faint">{t('settings.pushRemindersHint')}</Txt>
              </View>
              <StatusPill on={!!pushOn} label={pushOn ? t('common.on') : t('common.off')} />
            </View>

            {pushOn ? (
              <Pressable onPress={() => Linking.openSettings()}>
                <Txt style={{ color: c.accent, fontFamily: fonts.semibold }}>
                  {t(platformKey('settings.manageInIos'))}
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


        {/* Weather / home city (drives the Today section on the home screen) */}
        <View
          style={{ gap: sp.sm }}
          onLayout={registerSection('weather')}
        >
          <SectionLabel>{t('settings.weather')}</SectionLabel>
          <Card
            style={{
              gap: sp.md,
              ...(highlighted === 'weather' ? { borderWidth: 2, borderColor: c.accent } : {}),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <IconTile colors={homeLoc ? ['#4FA3F7', '#3567D6'] : ['#9AA0AA', '#737985']}>
                {homeLoc && preview ? (
                  (() => {
                    const WI = weatherIcon(preview.code)
                    return <WI size={21} color="#fff" />
                  })()
                ) : (
                  <MapPin size={20} color="#fff" />
                )}
              </IconTile>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
                  {homeLoc ? homeLoc.city.split(',')[0] : t('settings.homeCity')}
                </Txt>
                <Txt variant="faint" numberOfLines={1}>
                  {homeLoc
                    ? preview
                      ? `${preview.temperature}${preview.unit}`
                      : homeLoc.city
                    : t('settings.homeCityHint')}
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

            <Field
              value={cityInput}
              onChangeText={setCityInput}
              placeholder={t('settings.cityPlaceholder')}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (suggestions[0]) void pickCity(suggestions[0])
              }}
            />

            {suggestions.length > 0 ? (
              <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' }}>
                {suggestions.map((s, i) => (
                  <Pressable
                    key={`${s.lat},${s.lon}`}
                    onPress={() => void pickCity(s)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.sm,
                      paddingHorizontal: sp.md,
                      paddingVertical: 10,
                      backgroundColor: pressed ? c.cardActive : c.card,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: c.border,
                    })}
                  >
                    <MapPin size={14} color={c.textMuted} />
                    <Txt numberOfLines={1} style={{ flex: 1 }}>
                      {s.city}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            ) : searching ? (
              <Txt variant="faint">{t('settings.searchingCity')}</Txt>
            ) : cityMsg ? (
              <Txt variant="faint">{t(cityMsg)}</Txt>
            ) : null}
          </Card>
        </View>


        {/* Account — one card: who you're signed in as, then the two ways out. */}
        <View style={{ gap: sp.sm }}>
          <SectionLabel>{t('settings.account')}</SectionLabel>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <AccountRow
              first
              icon={<IconTile colors={['#9AA0AA', '#737985']} size={32}><Mail size={16} color="#fff" /></IconTile>}
              label={profile?.email ?? ''}
            />
            <AccountRow
              icon={<IconTile colors={['#6E7BF2', '#4B57C9']} size={32}><LogOut size={16} color="#fff" /></IconTile>}
              label={t('settings.signOut')}
              onPress={doSignOut}
            />
            <AccountRow
              icon={<IconTile colors={['#F0766A', '#D2483C']} size={32}><Trash2 size={16} color="#fff" /></IconTile>}
              label={t('settings.deleteAccount')}
              color={c.expense}
              onPress={confirmDelete}
            />
          </Card>
        </View>
      </View>
    </Screen>
  )
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
  // Sits on the Plus gradient: white glyph on a translucent tile, white text.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
      <View style={{ height: 28, width: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
        <Icon size={15} color="#fff" />
      </View>
      <Txt style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: '#fff' }}>{label}</Txt>
      {included ? <Check size={16} color="#fff" strokeWidth={2.6} /> : null}
    </View>
  )
}

/** Home-style section label: uppercase, tracked, outside the card. */
function SectionLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  return (
    <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', color: c.textMuted, paddingHorizontal: 2 }}>
      {children}
    </Txt>
  )
}

/** A white glyph on a small gradient tile — the Home's app-icon look. */
function IconTile({ colors, children, size = 40 }: { colors: Gradient; children: ReactNode; size?: number }) {
  return (
    <GradientBox colors={colors} radius={size * 0.3} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </GradientBox>
  )
}

/** One row of the Account card: a tinted icon, a label, an optional chevron. */
function AccountRow({
  icon,
  label,
  color,
  onPress,
  first,
}: {
  icon: ReactNode
  label: string
  color?: string
  onPress?: () => void
  first?: boolean
}) {
  const { c } = useTheme()
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        paddingHorizontal: sp.md,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: c.border,
      }}
    >
      {icon}
      <Txt style={{ flex: 1, fontSize: 15.5, fontFamily: onPress ? fonts.semibold : fonts.body, color: color ?? c.text }} numberOfLines={1}>
        {label}
      </Txt>
      {onPress ? <ChevronRight size={17} color={c.textFaint} /> : null}
    </View>
  )
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  ) : (
    body
  )
}

/** Initials on a soft accent circle, for the member list. */
function Initials({ name }: { name: string }) {
  const { c } = useTheme()
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const ini = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
  return (
    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.accent }}>{ini}</Txt>
    </View>
  )
}
