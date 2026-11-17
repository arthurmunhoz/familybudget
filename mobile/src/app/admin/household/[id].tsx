// Admin-only: one household's members + management. RN port of the PWA's
// AdminHousehold page. Reuses admin_user_activity (30d) and the admin RLS
// exception on allowed_users/households.
import { useState } from 'react'
import { Alert, StyleSheet, TextInput, View } from 'react-native'
import { Toggle } from '@/components/Toggle'
import { Pressable } from '@/components/Pressable'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { Award, ChevronLeft, Home, Mail, Trash2, UserRound } from 'lucide-react-native'

import { Loader, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { ADMIN_LOOK } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { useAuth } from '@/lib/auth'
// memberLimit mirrors the DB trigger (migration 059): free 4, Plus 12.
import { memberLimit } from '@/lib/plus'
import { invalidateCache, useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { track } from '@/lib/analytics'
import { buildFeed, type EventRow } from '@/lib/activityFeed'
import { formatDay, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Household, Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

const TINT = ADMIN_LOOK.tint

interface UserActivity {
  user_email: string
  last_seen: string
  events: number
}

type DetailData = {
  household: Household | null
  members: Profile[]
  activity: Record<string, UserActivity>
  isPlus: boolean
  events: EventRow[]
}

export default function AdminHousehold() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { profile, profileLoaded } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)

  const {
    data = { household: null, members: [], activity: {}, isPlus: false, events: [] },
    loading,
    revalidate: load,
  } = useCachedQuery<DetailData>(`admin:household:${id}`, async () => {
    const [h, u, act, plus, ev] = await Promise.all([
      supabase.from('households').select('*').eq('id', id).single(),
      // Memberships (migration 099): someone whose ACTIVE household is another
      // one is still a member here.
      supabase
        .from('household_members')
        .select('email, display_name, household_id, role')
        .eq('household_id', id)
        .order('display_name'),
      supabase.rpc('admin_user_activity', { days: 30 }),
      supabase.rpc('admin_household_is_plus', { p_household: id }),
      supabase.rpc('admin_household_events', { p_household: id, lim: 200 }),
    ])
    const rows = (u.data ?? []) as (Omit<Profile, 'is_admin' | 'display_name'> & { display_name: string | null })[]
    const { data: admins } = rows.length
      ? await supabase.from('allowed_users').select('email').eq('is_admin', true).in('email', rows.map((m) => m.email))
      : { data: [] }
    const adminSet = new Set(((admins ?? []) as { email: string }[]).map((a) => a.email))
    return {
      household: (h.data as Household) ?? null,
      members: rows.map((m) => ({
        ...m,
        display_name: m.display_name || m.email.split('@')[0],
        is_admin: adminSet.has(m.email),
      })),
      activity: Object.fromEntries(
        ((act.data ?? []) as UserActivity[]).map((a) => [a.user_email, a]),
      ),
      isPlus: plus.data === true,
      events: (ev.data ?? []) as EventRow[],
    }
  })
  const { household, members, activity, isPlus, events } = data
  const feed = buildFeed(events)
  const maxMembers = memberLimit(isPlus)
  const atLimit = members.length >= maxMembers
  const hasOwner = members.some((u) => u.role === 'owner')
  const nameFor = (email: string) =>
    members.find((m) => m.email === email)?.display_name ?? email.split('@')[0]

  // Comp this household to Plus for free (or revoke). Admin-only RPC.
  async function setPlan(next: boolean) {
    if (planBusy || !id) return
    setPlanBusy(true)
    const { error } = await supabase.rpc('admin_set_household_plan', {
      p_household: id,
      p_plan: next ? 'plus' : 'free',
    })
    setPlanBusy(false)
    if (error) {
      Alert.alert(t('admin.planError'))
      return
    }
    track('plan.changed', { plan: next ? 'plus' : 'free', scope: 'household', household: id })
    load()
  }

  // Same guard as /admin — decide only once the profile lookup has resolved,
  // never while `profile` is still null and in flight.
  if (!profileLoaded) return <Loader />
  if (!profile?.is_admin) return <Redirect href="/" />

  async function addMember() {
    const email = mEmail.trim().toLowerCase()
    const name = mName.trim()
    if (!email || !name || busy || !id) return
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      Alert.alert(t('admin.invalidEmail'))
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('allowed_users')
      .insert({ email, display_name: name, household_id: id })
    setBusy(false)
    if (error) {
      Alert.alert(
        error.code === '23505'
          ? t('admin.emailExists')
          : error.message.includes('household_member_limit')
            ? t('admin.householdFull', { max: maxMembers })
            : t('admin.addMemberError'),
      )
      return
    }
    track('member.added', { email, name })
    setMName('')
    setMEmail('')
    load()
  }

  function removeMember(user: Profile) {
    if (user.email === profile?.email) {
      Alert.alert(t('admin.cantRemoveSelf'))
      return
    }
    Alert.alert(
      t('admin.removeMember'),
      t('admin.removeConfirm', { name: user.display_name, email: user.email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.remove'),
          style: 'destructive',
          onPress: async () => {
            // Only from THIS household — their other households are untouched
            // (the 099 delete trigger moves them, or ends the account if this
            // was their last one, as the old allowed_users delete did).
            const { error } = await supabase
              .from('household_members')
              .delete()
              .eq('email', user.email)
              .eq('household_id', id)
            if (error) {
              Alert.alert(t('admin.removeError'))
              return
            }
            load()
          },
        },
      ],
    )
  }

  // Global-admin assigns a household owner (atomic single-owner swap via RPC).
  function setOwner(user: Profile) {
    if (!id) return
    Alert.alert(t('admin.makeOwner'), t('admin.makeOwnerConfirm', { name: user.display_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.makeOwner'),
        onPress: async () => {
          const { error } = await supabase.rpc('admin_set_owner', { p_household: id, p_email: user.email })
          if (error) {
            Alert.alert(t('admin.setOwnerError'))
            return
          }
          load()
        },
      },
    ])
  }

  // Cascade-delete the whole household + all its data (admin RPC, migration 053).
  // Works even when the household still has members/data — the plain delete
  // couldn't (FK-blocked), which is why this exists.
  function removeHousehold() {
    if (!household) return
    Alert.alert(
      t('admin.deleteHousehold'),
      t('admin.deleteConfirmAll', { name: household.name, count: String(members.length) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('admin_delete_household', { p_household: household.id })
            if (error) {
              Alert.alert(t('admin.deleteError'))
              return
            }
            // Drop this household's own cache entry AND the list's, so the row
            // is gone the instant we land back on /admin rather than lingering
            // for the length of that screen's focus refetch.
            invalidateCache(`admin:household:${household.id}`)
            invalidateCache('admin:base')
            router.back()
          },
        },
      ],
    )
  }

  const soft = TINT + (dark ? '2E' : '1A')
  const tile = { backgroundColor: c.card, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, overflow: 'hidden' as const }
  const canAdd = !!mName.trim() && !!mEmail.trim() && !busy

  return (
    <Screen
      scroll
      header={
        <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))}
            hitSlop={8}
            style={({ pressed }) => [st.round, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <ChevronLeft size={22} color={c.text} />
          </Pressable>
        </View>
      }
    >
      {loading && !household ? (
        <Loader />
      ) : !household ? (
        <Txt variant="faint" style={{ textAlign: 'center', marginTop: sp.xl }}>
          {t('admin.notFound')}
        </Txt>
      ) : (
        <View style={{ gap: sp.lg }}>
          {/* Head: gradient tile + the family's name, like the Home's sheets. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            <GradientBox colors={ADMIN_LOOK.colors} radius={18} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
              <Home size={26} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={[st.kicker, { color: c.textMuted }]}>{t('admin.household')}</Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 33, color: c.text }} numberOfLines={2}>
                {household.name}
              </Txt>
            </View>
          </View>
          <Txt variant="muted" style={{ marginTop: -sp.sm }}>
            {t('admin.memberCount', { n: members.length, max: maxMembers, date: formatDay(household.created_at.slice(0, 10)) })}
          </Txt>

          {/* Plus comp — one switch row; the whole row toggles. */}
          <Pressable
            onPress={() => setPlan(!isPlus)}
            disabled={planBusy}
            accessibilityRole="switch"
            accessibilityState={{ checked: isPlus }}
            style={[tile, st.row]}
          >
            <View style={[st.tileIcon, { backgroundColor: isPlus ? soft : c.surface }]}>
              <Award size={18} color={isPlus ? TINT : c.textMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, color: c.text }}>One Roof Plus</Txt>
              <Txt variant="faint" style={{ fontSize: 12.5 }}>
                {planBusy ? t('admin.updating') : isPlus ? t('admin.plusComped') : t('admin.plusFree')}
              </Txt>
            </View>
            <Toggle tint={TINT} value={isPlus} onValueChange={setPlan} disabled={planBusy} />
          </Pressable>

          {members.length > 0 && !hasOwner ? (
            <View style={{ backgroundColor: c.expense + '18', borderRadius: 18, padding: sp.md }}>
              <Txt style={{ color: c.expense, fontFamily: fonts.semibold, fontSize: 13 }}>{t('admin.noOwnerWarning')}</Txt>
            </View>
          ) : null}

          {/* Members */}
          <View>
            <Txt style={[st.label, { color: c.textMuted }]}>{t('admin.membersLabel')}</Txt>
            <View style={tile}>
              {members.length === 0 ? (
                <View style={{ padding: sp.lg }}>
                  <Txt variant="faint">{t('admin.noMembers')}</Txt>
                </View>
              ) : (
                members.map((u, i) => (
                  <View key={u.email} style={[st.row, { alignItems: 'flex-start', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                    <View style={[st.tileIcon, { borderRadius: 19, backgroundColor: soft }]}>
                      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: TINT }}>{initials(u.display_name)}</Txt>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: c.text }} numberOfLines={1}>
                          {u.display_name}
                        </Txt>
                        {u.role === 'owner' ? <Badge label={t('admin.owner')} color={c.income} /> : null}
                        {u.is_admin ? <Badge label="Admin" color={TINT} /> : null}
                      </View>
                      <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
                        {u.email}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 12.5 }}>
                        {activity[u.email]
                          ? t('admin.activeAgo', { ago: timeAgo(activity[u.email].last_seen), n: activity[u.email].events })
                          : t('admin.neverAccessed')}
                      </Txt>
                      {u.role !== 'owner' ? (
                        <Pressable
                          onPress={() => setOwner(u)}
                          accessibilityRole="button"
                          style={({ pressed }) => [st.pill, { backgroundColor: soft, opacity: pressed ? 0.7 : 1 }]}
                        >
                          <Award size={14} color={TINT} />
                          <Txt style={{ color: TINT, fontFamily: fonts.semibold, fontSize: 12.5 }}>{t('admin.makeOwner')}</Txt>
                        </Pressable>
                      ) : null}
                    </View>
                    {!u.is_admin ? (
                      <Pressable
                        onPress={() => removeMember(u)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('admin.remove')} ${u.display_name}`}
                        style={({ pressed }) => [st.trash, { backgroundColor: c.expense + '14', opacity: pressed ? 0.6 : 1 }]}
                      >
                        <Trash2 size={15} color={c.expense} />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </View>

          {/* Add member */}
          <View>
            <Txt style={[st.label, { color: c.textMuted }]}>{t('admin.addMember')}</Txt>
            {atLimit ? (
              <View style={[tile, { padding: sp.lg }]}>
                <Txt variant="faint">{t('admin.householdFull', { max: maxMembers })}</Txt>
              </View>
            ) : (
              <View style={tile}>
                <View style={st.row}>
                  <View style={[st.tileIcon, { backgroundColor: soft }]}>
                    <UserRound size={17} color={TINT} />
                  </View>
                  <TextInput
                    value={mName}
                    onChangeText={setMName}
                    placeholder={t('admin.memberName')}
                    placeholderTextColor={c.textFaint}
                    style={[st.input, { color: c.text }]}
                  />
                </View>
                <View style={[st.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                  <View style={[st.tileIcon, { backgroundColor: soft }]}>
                    <Mail size={17} color={TINT} />
                  </View>
                  <TextInput
                    value={mEmail}
                    onChangeText={setMEmail}
                    placeholder={t('admin.memberEmail')}
                    placeholderTextColor={c.textFaint}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onSubmitEditing={addMember}
                    style={[st.input, { color: c.text }]}
                  />
                </View>
                <View style={{ padding: sp.md, paddingTop: 0 }}>
                  <TintButton tint={TINT} colors={ADMIN_LOOK.colors} title={t('admin.addMember')} onPress={addMember} disabled={!canAdd} inline />
                </View>
              </View>
            )}
          </View>

          {/* Recent activity */}
          <View>
            <Txt style={[st.label, { color: c.textMuted }]}>{t('admin.recentActivity')}</Txt>
            <View style={tile}>
              {feed.length === 0 ? (
                <View style={{ padding: sp.lg }}>
                  <Txt variant="faint">{t('admin.noActivityYet')}</Txt>
                </View>
              ) : (
                feed.map((f, i) => (
                  <View key={f.id} style={[st.row, { alignItems: 'flex-start', borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border }]}>
                    <View style={[st.tileIcon, { backgroundColor: f.isError ? c.expense + '1F' : c.surface }]}>
                      <f.icon size={16} color={f.isError ? c.expense : c.text} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Txt style={{ fontSize: 14, color: c.text }}>
                        <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: c.text }}>{nameFor(f.user_email)}</Txt> {f.predicate}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 12 }}>
                        {[f.app, timeAgo(f.created_at)].filter(Boolean).join(' · ')}
                      </Txt>
                      {f.detail ? <Txt style={{ color: f.isError ? c.expense : c.textMuted, fontSize: 12 }}>{f.detail}</Txt> : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>

          {/* Danger zone */}
          <View>
            <Txt style={[st.label, { color: c.textMuted }]}>{t('admin.dangerZone')}</Txt>
            <Pressable onPress={removeHousehold} accessibilityRole="button" style={({ pressed }) => [tile, st.row, { opacity: pressed ? 0.7 : 1 }]}>
              <View style={[st.tileIcon, { backgroundColor: c.expense + '1F' }]}>
                <Trash2 size={17} color={c.expense} />
              </View>
              <Txt style={{ flex: 1, color: c.expense, fontFamily: fonts.semibold, fontSize: 15 }}>{t('admin.deleteHousehold')}</Txt>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + '1F', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
      <Txt style={{ color, fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Txt>
    </View>
  )
}

const st = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.sm, paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 12 },
  tileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  trash: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 8 },
})
