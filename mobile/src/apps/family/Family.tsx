// Family module: the household roster. Top: the selected member's photo,
// full-bleed (components/PhotoHero, shared with Pet Care) with their name on it
// — swipe it or tap the side arrows to change member. Below: a card with that
// member's info only (one icon per field); the name lives on the photo now, so
// the card doesn't repeat it. Scrolling the info shrinks the photo. Replaced
// the coverflow of round photos + synced card pager (2026-11). RLS scopes
// every read/write to my household.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Cake, Droplet, Pencil, Phone, Ruler, UserRound, type LucideIcon } from 'lucide-react-native'
import { Animated, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { supabase } from '@/lib/supabase'
import { getSignedUrl, getSignedUrls } from '@/lib/signedUrls'
import { useAuth } from '@/lib/auth'
import { memberColor } from '@/lib/calendar'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useTheme, sp, radius, fonts } from '@/theme/theme'
import { AppHeader, Txt, Loader, EmptyState } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { HERO_OPEN, HERO_SHUT, PhotoHero, type HeroItem } from '@/components/PhotoHero'
import type { MemberProfile } from '@/lib/types'
import { MemberDetails } from './MemberDetail'
import { MemberToday } from './MemberToday'
import { EditProfile } from './EditProfile'
import { ConvertSheet } from './ConvertSheet'
import { hasDetails, initial, type Member } from './familyShared'
import { type ConvertKind } from './units'

/** A member with nothing filled in (2026-11): one card in the Home's language
 *  — the Family gradient tile, a display title, what you could add as faint
 *  chips and the docked-style gradient button — instead of a grey paragraph
 *  and a plain button. Someone else's empty card gets the same frame minus
 *  the chips and the button (only you can fill in your own). */
function EmptyProfile({ isMe, name, onAdd }: { isMe: boolean; name: string; onAdd: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [g0, g1] = APP_GRADIENT.family
  const chips: [LucideIcon, string][] = [
    [Cake, t('family.birthday')],
    [Phone, t('family.phone')],
    [Droplet, t('family.bloodType')],
    [Ruler, t('family.section.sizes')],
    [AlertTriangle, t('family.allergies')],
  ]
  return (
    <View
      style={{
        backgroundColor: Platform.OS === 'android' ? c.sheet : c.card,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        padding: sp.lg,
        gap: sp.md,
      }}
    >
      <GradientBox colors={[g0, g1]} radius={18} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
        <UserRound size={26} color="#fff" />
      </GradientBox>
      <View style={{ gap: 6 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 27, color: c.text }}>
          {isMe ? t('family.emptyMineTitle') : t('family.emptyOther', { name })}
        </Txt>
        <Txt variant="muted" style={{ lineHeight: 21 }}>
          {isMe ? t('family.emptyMine') : t('family.emptyOtherBody')}
        </Txt>
      </View>
      {isMe ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
            {chips.map(([Icon, label]) => (
              <View
                key={label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  paddingHorizontal: 12,
                  borderRadius: radius.pill,
                  backgroundColor: g1 + '17',
                }}
              >
                <Icon size={14} strokeWidth={2.2} color={g1} />
                <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: g1 }}>{label}</Txt>
              </View>
            ))}
          </View>
          <TintButton tint={g1} title={t('family.addMyInfo')} onPress={onAdd} inline />
        </>
      ) : null}
    </View>
  )
}

export default function Family({ initialEmail }: { initialEmail?: string } = {}) {
  const { profile, profiles, refreshProfile } = useAuth()
  const { t } = useI18n()
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const insets = useSafeAreaInsets()

  const [editing, setEditing] = useState(false)
  const [initialPhoto, setInitialPhoto] = useState<string | null>(null)

  // Members come from useAuth().profiles (already scoped to MY household). Do
  // NOT query allowed_users directly — its RLS lets an admin read every
  // household, which would leak other households into this list.
  const members: Member[] = useMemo(
    () =>
      [...profiles]
        .map((p) => ({ email: p.email, display_name: p.display_name, is_admin: p.is_admin }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [profiles],
  )

  const {
    data: byEmail = {},
    loading,
    revalidate: load,
  } = useCachedQuery<Record<string, MemberProfile>>('family:profiles', async () => {
    const { data: rowsData } = await supabase.from('member_profiles').select('*')
    const rows = (rowsData ?? []) as MemberProfile[]
    return Object.fromEntries(rows.map((p) => [p.email, p]))
  })

  // Start on the member we were opened for (the Home's family dock passes
  // ?email=), else on my own card. Tracked by email, not index: the roster is
  // sorted by name, so an index would point at someone else after a rename.
  const [selectedEmail, setSelectedEmail] = useState<string | null>(initialEmail ?? profile?.email ?? null)
  const selected = members.find((m) => m.email === selectedEmail) ?? members[0]

  // Signed photo URLs for the hero (cached + batched by signedUrls).
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const avatarKey = members.map((m) => byEmail[m.email]?.avatar_path ?? '').join('|')
  useEffect(() => {
    let active = true
    const paths = members.map((m) => byEmail[m.email]?.avatar_path).filter(Boolean) as string[]
    if (!paths.length) return
    getSignedUrls(paths)
      .then((byPath) => {
        if (!active) return
        const out: Record<string, string> = {}
        for (const m of members) {
          const path = byEmail[m.email]?.avatar_path
          if (path && byPath[path]) out[m.email] = byPath[path]
        }
        setPhotoUrls(out)
      })
      .catch(() => {})
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the avatar paths
  }, [avatarKey])

  // Scrolling the info rows shrinks the photo. Reset when the member changes:
  // the new card's scroll starts at the top, so the photo should be open again.
  const scrollY = useRef(new Animated.Value(0)).current
  // The hero FLOATS over the page (absolute) and the list scrolls under it
  // with a top pad of the open hero's height. It used to sit ABOVE the list in
  // the layout, so shrinking it moved and resized the scroll view every frame
  // of the scroll, the platform re-clamped the offset, and the card shook
  // (owner, 2026-11). Collapse over exactly the height it loses, so the card's
  // top stays glued to the hero's bottom until it's shut.
  const collapse = scrollY.interpolate({ inputRange: [0, HERO_OPEN - HERO_SHUT], outputRange: [0, 1], extrapolate: 'clamp' })
  const heroTop = insets.top + HERO_OPEN
  useEffect(() => {
    scrollY.setValue(0)
  }, [selected?.email, scrollY])

  // A field's "?" → conversion / blood-compatibility sheet.
  const [convert, setConvert] = useState<{
    kind: ConvertKind
    raw: string
    label: string
  } | null>(null)

  async function openEditMine() {
    if (!profile) return
    const mine = byEmail[profile.email]
    setInitialPhoto(mine?.avatar_path ? await getSignedUrl(mine.avatar_path) : null)
    setEditing(true)
  }

  const pad = { paddingHorizontal: sp.lg }
  const header = (
    <View style={pad}>
      <AppHeader title={t('family.title')} />
    </View>
  )

  if (loading || profiles.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
        {header}
        <Loader />
      </SafeAreaView>
    )
  }
  if (members.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
        {header}
        <EmptyState title={t('family.title')} subtitle={t('family.empty')} />
      </SafeAreaView>
    )
  }

  const emails = members.map((m) => m.email)
  const heroItems: HeroItem[] = members.map((m) => ({
    id: m.email,
    name: m.display_name,
    photo: photoUrls[m.email],
    color: memberColor(m.email, emails),
    glyph: initial(m.display_name),
    badge:
      m.email === profile?.email ? (
        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.88)',
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
          }}
        >
          <Txt style={{ color: '#241F1B', fontWeight: '700', fontSize: 11 }}>{t('family.you')}</Txt>
        </View>
      ) : null,
  }))

  const m = selected
  const p = m ? byEmail[m.email] : undefined
  const isMe = m?.email === profile?.email
  const openBirthday = m ? () => router.push(`/family/birthday?email=${encodeURIComponent(m.email)}`) : undefined

  return (
    // No top edge: the photo runs under the status bar (PhotoHero pads itself).
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['left', 'right']}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }} pointerEvents="box-none">
      <PhotoHero
        items={heroItems}
        selectedId={m?.email ?? null}
        onSelect={setSelectedEmail}
        collapse={collapse}
        // Edit lives on the photo, always on screen: under a long card it
        // fell behind Android's navigation bar and looked impossible (2026-11).
        action={
          isMe && hasDetails(p)
            ? { icon: <Pencil size={15} strokeWidth={2.4} color="#fff" />, text: t('family.edit'), onPress: openEditMine }
            : undefined
        }
      />
      </View>

      <View style={{ flex: 1, paddingHorizontal: sp.lg, paddingBottom: bottomGap }}>
        {!m ? null : !hasDetails(p) ? (
          <ScrollView
            key={m.email}
            style={{ flex: 1, marginHorizontal: -sp.lg }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingTop: heroTop + sp.md, paddingBottom: sp.md, gap: sp.md }}
            showsVerticalScrollIndicator={false}
          >
            <EmptyProfile
              isMe={isMe}
              name={m.display_name}
              onAdd={openEditMine}
            />
            {/* Their day still shows with an empty profile. */}
            <MemberToday email={m.email} firstName={m.display_name.trim().split(/\s+/)[0]} />
          </ScrollView>
        ) : (
          // The info sits straight on the page (no wrapping card, 2026-11 —
          // MemberDetails draws its own tiles in the Home's language).
          // Scrolling a long one shrinks the photo, which floats above it —
          // the scroll view itself never moves or resizes.
          <Animated.ScrollView
            key={m.email}
            style={{ flex: 1, marginHorizontal: -sp.lg }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingTop: heroTop + sp.md, paddingBottom: sp.md, gap: sp.md }}
            showsVerticalScrollIndicator={false}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
              useNativeDriver: false,
            })}
            scrollEventThrottle={16}
          >
            {/* Info only — the name is on the photo above. */}
            <MemberDetails
              member={m}
              profile={p}
              isMe={isMe}
              onConvert={(kind, raw, label) => setConvert({ kind, raw, label })}
              onBirthday={openBirthday}
            />
          </Animated.ScrollView>
        )}
      </View>

      {convert ? (
        <ConvertSheet
          kind={convert.kind}
          raw={convert.raw}
          label={convert.label}
          onClose={() => setConvert(null)}
        />
      ) : null}

      {editing && profile ? (
        <EditProfile
          profile={profile}
          mine={byEmail[profile.email]}
          initialPhoto={initialPhoto}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
            // The name lives on allowed_users (useAuth's profiles), not in the
            // member_profiles cache `load()` revalidates.
            void refreshProfile()
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}
