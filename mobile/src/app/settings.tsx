// Settings: language, appearance, notifications, One Roof Plus, sign out, and
// in-app account deletion (required by Apple Guideline 5.1.1(v)). Sections are
// separated by dividers; Plus shows a certificate badge + the included feature
// list when active, and notifications shows a live on/off status.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { router, useLocalSearchParams } from 'expo-router'
import {
  Award,
  Bell,
  BellRing,
  GripVertical,
  CalendarDays,
  Check,
  FolderLock,
  Lock,
  MapPin,
  ReceiptText,
  Sparkles,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react-native'

import { AppHeader, Btn, Card, Field, Screen, Txt } from '@/components/ui'
import { DraggableList } from '@/components/DraggableList'
import { useAppPrefs } from '@/hooks/useAppPrefs'
import { APPS } from '@/lib/apps'
import { useAuth } from '@/lib/auth'
import { usePlus, memberLimit, MEMBER_LIMIT_PLUS } from '@/lib/plus'
import { useI18n } from '@/hooks/useI18n'
import { LANGUAGES, type TKey } from '@/lib/i18n'
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
import { useThemePref, type ThemeMode } from '@/theme/theme-pref'
import { useSchemePref } from '@/theme/scheme-pref'
import { GLASS, SCHEMES, SCHEME_IDS, type SchemeId } from '@/theme/glass'
import { useTilePref, type TileStyle } from '@/hooks/useTilePref'

const PLUS_FEATURES: { icon: LucideIcon; key: TKey }[] = [
  { icon: Sparkles, key: 'settings.plusFeatureScans' },
  { icon: CalendarDays, key: 'settings.plusFeatureCalendar' },
  { icon: ReceiptText, key: 'settings.plusFeatureSplit' },
  { icon: Wallet, key: 'settings.plusFeatureBudgets' },
  { icon: Users, key: 'settings.plusFeatureMembers' },
  { icon: Lock, key: 'settings.plusFeaturePrivate' },
  { icon: FolderLock, key: 'settings.plusFeatureVault' },
]

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
function HouseholdSection() {
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
      <Txt variant="label">{t('household.title')}</Txt>
      <Card style={{ gap: sp.md }}>
        {name ? <Txt style={{ fontFamily: fonts.display, fontSize: 18 }}>{name}</Txt> : null}
        <View style={{ gap: sp.md }}>
          {members.map((m) => (
            <View key={m.email} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
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
        <Card style={{ gap: sp.md }}>
          <View style={{ gap: 2 }}>
            <Txt style={{ fontFamily: fonts.semibold }}>{t('household.inviteCode')}</Txt>
            <Txt variant="faint">{t('household.inviteHint')}</Txt>
          </View>
          <View style={{ alignItems: 'center', paddingVertical: sp.md, backgroundColor: c.surface, borderRadius: radius.md }}>
            <Txt style={{ fontSize: 26, letterSpacing: 4, fontFamily: fonts.semibold, color: c.text }}>
              {code ?? '········'}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <Btn title={t('household.share')} onPress={shareCode} disabled={!code} style={{ flex: 1 }} />
            <Btn title={t('household.rotate')} onPress={rotate} variant="secondary" loading={rotating} style={{ flex: 1 }} />
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
function SchemePreview({ id, dark }: { id: SchemeId; dark: boolean }) {
  const s = SCHEMES[id]
  const w = dark ? s.washDark : s.wash
  const accent = dark ? s.accentDark : s.accent
  // The real wash is three huge offscreen circles; at this size they'd just be
  // flat fills, so shrink them into the corners to keep the same read.
  const spots = [
    { top: -14, left: -14 },
    { top: -10, right: -12 },
    { bottom: -16, left: 18 },
  ]
  return (
    <View style={{ height: 74, borderRadius: 10, backgroundColor: w.base, padding: 8, overflow: 'hidden', justifyContent: 'flex-end' }}>
      {w.blobs.map((b, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            ...spots[i],
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: b.color,
            opacity: b.o,
          }}
        />
      ))}
      <View
        style={{
          height: 30,
          borderRadius: 8,
          backgroundColor: dark ? 'rgba(32,33,42,0.62)' : 'rgba(255,255,255,0.66)',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(60,45,38,0.12)',
          padding: 5,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
        <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: accent, opacity: 0.28 }} />
      </View>
    </View>
  )
}

// Mini preview of the home tile density (uses the active theme).
function TilePreview({ compact }: { compact: boolean }) {
  const { c } = useTheme()
  const cols = compact ? 3 : 2
  const tiles = cols * 2
  const tileW = compact ? 18 : 30
  const tileH = compact ? 18 : 24
  return (
    <View style={{ height: 74, borderRadius: 10, backgroundColor: c.bg, padding: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, width: cols * tileW + (cols - 1) * 5, justifyContent: 'center' }}>
        {Array.from({ length: tiles }).map((_, i) => (
          <View
            key={i}
            style={{
              width: tileW,
              height: tileH,
              borderRadius: 6,
              backgroundColor: c.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              padding: 3,
              justifyContent: 'space-between',
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: c.accent }} />
            {!compact ? <View style={{ width: 14, height: 2.5, borderRadius: 2, backgroundColor: c.textMuted }} /> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

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

export default function Settings() {
  // `dark` is aliased: this module also imports the Warm Hearth `dark` token set.
  const { c, dark: isDark } = useTheme()
  const { mode, setMode } = useThemePref()
  const { scheme, setScheme } = useSchemePref()
  const { tile, setTile } = useTilePref()
  const { hiddenApps, appOrder, toggleApp, setAppOrder } = useAppPrefs()
  // Every app (hidden ones dimmed), in the user's hub order — same ranking the
  // Hub applies, so what you see here is what the home screen does.
  const orderedApps = useMemo(() => {
    const pos = new Map(appOrder.map((id, i) => [id, i]))
    const rank = (id: string) => pos.get(id) ?? appOrder.length + APPS.findIndex((x) => x.id === id)
    return [...APPS].sort((a, b) => rank(a.id) - rank(b.id))
  }, [appOrder])
  const { profile, signOut } = useAuth()
  const { isPlus, restore } = usePlus()
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
            <Card style={{ gap: sp.md, overflow: 'hidden' }}>
              <PlusConfetti />
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

        <HouseholdSection />

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
            <OptionCard selected={mode === 'light'} onPress={() => setMode('light')} label={t('settings.light')}>
              <ThemePreview p={light} />
            </OptionCard>
            <OptionCard selected={mode === 'dark'} onPress={() => setMode('dark')} label={t('settings.dark')}>
              <ThemePreview p={dark} />
            </OptionCard>
          </View>
        </View>

        {/* Colour scheme — only meaningful under the glass skin, whose accent
            and background wash are what a scheme repaints. Warm Hearth has a
            single fixed accent, so this is hidden when GLASS is off. */}
        {GLASS ? (
          <>
            <Divider />
            <View style={{ gap: sp.sm }}>
              <Txt variant="label">{t('settings.colorScheme')}</Txt>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: sp.sm, paddingRight: sp.sm }}
              >
                {SCHEME_IDS.map((id) => (
                  <View key={id} style={{ width: 108 }}>
                    <OptionCard
                      selected={scheme === id}
                      onPress={() => setScheme(id)}
                      label={t(`settings.scheme.${id}` as TKey)}
                    >
                      <SchemePreview id={id} dark={isDark} />
                    </OptionCard>
                  </View>
                ))}
              </ScrollView>
            </View>
          </>
        ) : null}

        <Divider />

        {/* App cards (home screen tile density) */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.appCards')}</Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <OptionCard selected={tile === 'large'} onPress={() => setTile('large')} label={t('settings.large')}>
              <TilePreview compact={false} />
            </OptionCard>
            <OptionCard selected={tile === 'compact'} onPress={() => setTile('compact')} label={t('settings.compact')}>
              <TilePreview compact />
            </OptionCard>
          </View>
          <Txt variant="faint">{t('settings.compactHint')}</Txt>
        </View>

        <Divider />

        {/* Which apps show on the hub, and in what order */}
        <View style={{ gap: sp.sm }}>
          <Txt variant="label">{t('settings.apps')}</Txt>
          <GestureHandlerRootView>
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
                      <app.icon size={18} color={c.accent} />
                      <Txt style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>
                        {t(`app.${app.id}.name` as TKey)}
                      </Txt>
                      <Switch
                        value={!hidden}
                        onValueChange={() => toggleApp(app.id)}
                        trackColor={{ true: c.income, false: c.surface2 }}
                      />
                    </View>
                  )
                }}
              />
            </Card>
          </GestureHandlerRootView>
          <Txt variant="faint">{t('settings.appsHint')}</Txt>
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
                  height: 44,
                  width: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: homeLoc ? c.accentSoft : c.surface,
                }}
              >
                {homeLoc && preview ? (
                  (() => {
                    const WI = weatherIcon(preview.code)
                    return <WI size={22} color={c.accent} />
                  })()
                ) : (
                  <MapPin size={20} color={homeLoc ? c.accent : c.textMuted} />
                )}
              </View>
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
