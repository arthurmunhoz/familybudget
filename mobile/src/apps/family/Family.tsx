// Family module: the household roster. Top: the selected member's photo,
// full-bleed (components/PhotoHero, shared with Pet Care) with their name on it
// — swipe it or tap the side arrows to change member. Below: a card with that
// member's info only (one icon per field); the name lives on the photo now, so
// the card doesn't repeat it. Scrolling the info shrinks the photo. Replaced
// the coverflow of round photos + synced card pager (2026-11). RLS scopes
// every read/write to my household.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Platform, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/lib/supabase'
import { getSignedUrl, getSignedUrls } from '@/lib/signedUrls'
import { useAuth } from '@/lib/auth'
import { memberColor } from '@/lib/calendar'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useTheme, sp, radius } from '@/theme/theme'
import { AppHeader, Btn, Txt, Loader, EmptyState } from '@/components/ui'
import { PhotoHero, type HeroItem } from '@/components/PhotoHero'
import type { MemberProfile } from '@/lib/types'
import { MemberDetails } from './MemberDetail'
import { EditProfile } from './EditProfile'
import { ConvertSheet } from './ConvertSheet'
import { hasDetails, initial, type Member } from './familyShared'
import { type ConvertKind } from './units'

export default function Family({ initialEmail }: { initialEmail?: string } = {}) {
  const { profile, profiles, refreshProfile } = useAuth()
  const { t } = useI18n()
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)

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
  const collapse = scrollY.interpolate({ inputRange: [0, 140], outputRange: [0, 1], extrapolate: 'clamp' })
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
      <PhotoHero
        items={heroItems}
        selectedId={m?.email ?? null}
        onSelect={setSelectedEmail}
        collapse={collapse}
      />

      <View style={{ flex: 1, paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: bottomGap }}>
        {!m ? null : !hasDetails(p) ? (
          // Nothing filled in yet → no card at all. A full-height card around
          // one line of grey text read as a loading failure.
          <View style={{ flex: 1, paddingHorizontal: sp.md, justifyContent: 'center', alignItems: 'center', gap: sp.lg }}>
            <Txt variant="muted" style={{ textAlign: 'center', lineHeight: 22 }}>
              {isMe ? t('family.emptyMine') : t('family.emptyOther', { name: m.display_name })}
            </Txt>
            {isMe ? (
              // Bounded rather than edge-to-edge: a lone button stretched
              // across a phone reads as a form footer, not an invitation.
              <View style={{ width: '100%', maxWidth: 320 }}>
                <Btn title={t('family.addMyInfo')} onPress={openEditMine} />
              </View>
            ) : null}
          </View>
        ) : (
          // The PAGE scrolls, not the inside of the card: the card is only as
          // tall as its rows, so a short profile is a compact card instead of
          // a few rows stranded at the top of a full-height box (2026-11).
          // Scrolling a long one shrinks the photo above.
          <Animated.ScrollView
            key={m.email}
            style={{ flex: 1, marginHorizontal: -sp.lg }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.md }}
            showsVerticalScrollIndicator={false}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
              useNativeDriver: false,
            })}
            scrollEventThrottle={16}
          >
            <View
              style={{
                // Opaque on Android: `elevation` paints its shadow BEHIND the
                // view, and through the glass skin's translucent c.card it
                // showed as a grey band framing the card's contents.
                backgroundColor: Platform.OS === 'android' ? c.sheet : c.card,
                borderRadius: radius.lg,
                paddingHorizontal: sp.lg,
                paddingVertical: sp.xs,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                shadowColor: '#000',
                shadowOpacity: 0.08,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              {/* Info only — the name is on the photo above. */}
              <MemberDetails
                member={m}
                profile={p}
                isMe={isMe}
                onConvert={(kind, raw, label) => setConvert({ kind, raw, label })}
                onBirthday={openBirthday}
              />
            </View>

            {/* Edit — only on my own card, right under it. */}
            {isMe ? <Btn title={t('family.editMine')} variant="secondary" onPress={openEditMine} /> : null}
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
