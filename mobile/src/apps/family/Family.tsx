// Family module: the household roster as a coverflow. The bottom carousel is a
// row of round member photos — the selected one centered at full opacity, its
// neighbors scaled down + fading into the background the further out they sit.
// Above it floats a card with the selected member's info (one icon per field).
// The card pager and the carousel share the same horizontal scroll offset, so
// swiping the photos slides the cards in sync. Only the info rows scroll; the
// header + carousel stay put. RLS scopes every read/write to my household.
import { useMemo, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { supabase } from '@/lib/supabase'
import { getSignedUrl } from '@/lib/signedUrls'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp, radius } from '@/theme/theme'
import { AppHeader, Btn, Txt, Loader, EmptyState } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { Avatar } from './Avatar'
import { MemberDetails } from './MemberDetail'
import { EditProfile } from './EditProfile'
import { type Member } from './familyShared'

const AV_BASE = 84 // rendered avatar size (scaled per position by the carousel)
const SLOT = 72 // horizontal slot width per avatar in the carousel
const CAROUSEL_H = 150

export default function Family() {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const { c } = useTheme()
  const { width } = useWindowDimensions()

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

  // Start focused on my own card. scrollX seeds to the same offset so the card
  // pager and carousel agree from the first frame (before any scroll fires).
  const myIndex = Math.max(
    0,
    members.findIndex((m) => m.email === profile?.email),
  )
  const scrollX = useRef(new Animated.Value(myIndex * SLOT)).current
  const scrollRef = useRef<ScrollView>(null)
  const [selected, setSelected] = useState(myIndex)

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

  // Card pager tracks the carousel: at scrollX = i*SLOT (avatar i centered) the
  // card row is translated to show card i.
  const cardTranslate = Animated.multiply(Animated.divide(scrollX, SLOT), -width)
  const sideInset = (width - SLOT) / 2 // lets the first/last avatar reach center

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {header}

      {/* Info-card pager — slides in sync with the carousel below. */}
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View
          style={{
            flex: 1,
            flexDirection: 'row',
            width: width * members.length,
            transform: [{ translateX: cardTranslate }],
          }}
        >
          {members.map((m) => {
            const p = byEmail[m.email]
            const isMe = m.email === profile?.email
            return (
              <View
                key={m.email}
                style={{ width, paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.md }}
              >
                <View
                  style={{
                    flex: 1,
                    backgroundColor: c.card,
                    borderRadius: radius.lg,
                    padding: sp.lg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.border,
                    // Float it: a deeper, softer shadow lifts the card off the page.
                    shadowColor: '#000',
                    shadowOpacity: 0.16,
                    shadowRadius: 20,
                    shadowOffset: { width: 0, height: 12 },
                    elevation: 12,
                  }}
                >
                  {/* Header (fixed) */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <Avatar name={m.display_name} avatarPath={p?.avatar_path} size={52} zoomable />
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                      <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {m.display_name}
                      </Txt>
                      {isMe ? (
                        <View
                          style={{
                            backgroundColor: c.accentSoft,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 999,
                          }}
                        >
                          <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 11 }}>
                            {t('family.you')}
                          </Txt>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ height: 1, backgroundColor: c.border, marginVertical: sp.md }} />

                  {/* Only the info rows scroll. */}
                  <ScrollView
                    style={{ flex: 1 }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: sp.xs }}
                  >
                    <MemberDetails member={m} profile={p} isMe={isMe} />
                  </ScrollView>

                  {/* Edit (fixed) — only on my own card. */}
                  {isMe ? (
                    <Btn
                      title={t('family.editMine')}
                      variant="secondary"
                      onPress={openEditMine}
                      style={{ marginTop: sp.md }}
                    />
                  ) : null}
                </View>
              </View>
            )
          })}
        </Animated.View>
      </View>

      {/* Bottom carousel — round member photos, coverflow. Drives the scroll. */}
      <View style={{ height: CAROUSEL_H }}>
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SLOT}
          decelerationRate="fast"
          contentOffset={{ x: myIndex * SLOT, y: 0 }}
          contentContainerStyle={{ paddingHorizontal: sideInset, alignItems: 'center' }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) =>
            setSelected(Math.round(e.nativeEvent.contentOffset.x / SLOT))
          }
          style={{ flex: 1 }}
        >
          {members.map((m, i) => {
            const p = byEmail[m.email]
            const input = [
              (i - 2) * SLOT,
              (i - 1) * SLOT,
              i * SLOT,
              (i + 1) * SLOT,
              (i + 2) * SLOT,
            ]
            const scale = scrollX.interpolate({
              inputRange: input,
              outputRange: [0.5, 0.62, 1, 0.62, 0.5],
              extrapolate: 'clamp',
            })
            const opacity = scrollX.interpolate({
              inputRange: input,
              outputRange: [0.22, 0.5, 1, 0.5, 0.22],
              extrapolate: 'clamp',
            })
            // Pull neighbours slightly toward the centered photo for overlap.
            const tx = scrollX.interpolate({
              inputRange: [(i - 1) * SLOT, i * SLOT, (i + 1) * SLOT],
              outputRange: [12, 0, -12],
              extrapolate: 'clamp',
            })
            return (
              <View
                key={m.email}
                style={{ width: SLOT, alignItems: 'center', justifyContent: 'center' }}
              >
                <Animated.View
                  style={{
                    opacity,
                    zIndex: members.length - Math.abs(i - selected),
                    transform: [{ translateX: tx }, { scale }],
                  }}
                >
                  <Pressable
                    onPress={() => scrollRef.current?.scrollTo({ x: i * SLOT, animated: true })}
                    accessibilityRole="button"
                    accessibilityLabel={m.display_name}
                  >
                    <Avatar name={m.display_name} avatarPath={p?.avatar_path} size={AV_BASE} />
                  </Pressable>
                </Animated.View>
              </View>
            )
          })}
        </Animated.ScrollView>
        <Txt
          numberOfLines={1}
          style={{ textAlign: 'center', fontWeight: '600', paddingBottom: sp.sm }}
        >
          {members[selected]?.display_name}
        </Txt>
      </View>

      {editing && profile ? (
        <EditProfile
          profile={profile}
          mine={byEmail[profile.email]}
          initialPhoto={initialPhoto}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}
