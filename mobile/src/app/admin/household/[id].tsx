// Admin-only: one household's members + management. RN port of the PWA's
// AdminHousehold page. Reuses admin_user_activity (30d) and the admin RLS
// exception on allowed_users/households.
import { useState } from 'react'
import { Alert, Pressable, Switch, TextInput, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { Award, Trash2, X } from 'lucide-react-native'

import { AppHeader, Card, Loader, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
// memberLimit mirrors the DB trigger (migration 059): free 4, Plus 12.
import { memberLimit } from '@/lib/plus'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { track } from '@/lib/analytics'
import { buildFeed, type EventRow } from '@/lib/activityFeed'
import { formatDay, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Household, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { KEYBOARD_DONE_ID } from '@/components/keyboardDoneId'

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
  const { c } = useTheme()
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
      supabase
        .from('allowed_users')
        .select('email, display_name, household_id, is_admin, role')
        .eq('household_id', id)
        .order('display_name'),
      supabase.rpc('admin_user_activity', { days: 30 }),
      supabase.rpc('admin_household_is_plus', { p_household: id }),
      supabase.rpc('admin_household_events', { p_household: id, lim: 40 }),
    ])
    return {
      household: (h.data as Household) ?? null,
      members: (u.data ?? []) as Profile[],
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
            const { error } = await supabase.from('allowed_users').delete().eq('email', user.email)
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
            router.back()
          },
        },
      ],
    )
  }

  const inputStyle = {
    backgroundColor: c.card,
    borderRadius: radius.md,
    paddingHorizontal: sp.md,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text,
  } as const

  return (
    <Screen scroll header={<AppHeader title={household?.name ?? 'Household'} />}>
      {loading ? (
        <Loader />
      ) : !household ? (
        <Txt variant="faint" style={{ textAlign: 'center', marginTop: sp.xl }}>
          Household not found.
        </Txt>
      ) : (
        <View style={{ gap: sp.md }}>
          <Txt variant="muted">
            {members.length}/{maxMembers} members · created {formatDay(household.created_at.slice(0, 10))}
          </Txt>

          {/* Comp this household to One Roof Plus for free (admin-only). */}
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <View
                style={{
                  height: 40,
                  width: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isPlus ? c.accentSoft : c.surface,
                }}
              >
                <Award size={20} color={isPlus ? c.accent : c.textMuted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontWeight: '700' }}>One Roof Plus</Txt>
                <Txt variant="faint" style={{ fontSize: 11 }}>
                  {isPlus
                    ? 'Comped to Plus (free) · unlimited scans, unlimited budgets'
                    : 'Free plan · turn on to comp this household to Plus'}
                  {planBusy ? ' · updating…' : ''}
                </Txt>
              </View>
              <Switch
                value={isPlus}
                onValueChange={setPlan}
                disabled={planBusy}
                trackColor={{ true: c.accent }}
              />
            </View>
          </Card>

          {members.length > 0 && !hasOwner ? (
            <View
              style={{
                backgroundColor: c.expense + '18',
                borderRadius: radius.md,
                padding: sp.md,
              }}
            >
              <Txt style={{ color: c.expense, fontWeight: '600', fontSize: 13 }}>
                {t('admin.noOwnerWarning')}
              </Txt>
            </View>
          ) : null}

          <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Members
          </Txt>
          {members.length === 0 ? (
            <Card>
              <Txt variant="muted">No members yet — add the first one below.</Txt>
            </Card>
          ) : (
            members.map((u) => (
              <Card key={u.email}>
                <View style={{ gap: sp.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                        <Txt style={{ fontWeight: '600' }} numberOfLines={1}>
                          {u.display_name}
                        </Txt>
                        {u.role === 'owner' ? (
                          <View style={{ backgroundColor: c.income + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                            <Txt style={{ color: c.income, fontWeight: '700', fontSize: 10 }}>
                              {t('admin.owner').toUpperCase()}
                            </Txt>
                          </View>
                        ) : null}
                        {u.is_admin ? (
                          <View style={{ backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                            <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 10 }}>ADMIN</Txt>
                          </View>
                        ) : null}
                      </View>
                      <Txt variant="faint" style={{ fontSize: 11 }} numberOfLines={1}>
                        {u.email}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 11 }}>
                        {activity[u.email]
                          ? `Active ${timeAgo(activity[u.email].last_seen)} · ${activity[u.email].events} events / 30d`
                          : 'Never accessed'}
                      </Txt>
                    </View>
                    {!u.is_admin ? (
                      <Pressable onPress={() => removeMember(u)} hitSlop={8} accessibilityLabel={`Remove ${u.display_name}`}>
                        <X size={18} color={c.textFaint} />
                      </Pressable>
                    ) : null}
                  </View>
                  {u.role !== 'owner' ? (
                    <Pressable
                      onPress={() => setOwner(u)}
                      style={{
                        alignSelf: 'flex-start',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: radius.md,
                        backgroundColor: c.surface,
                      }}
                    >
                      <Award size={14} color={c.accent} />
                      <Txt style={{ color: c.accent, fontWeight: '600', fontSize: 12 }}>
                        {t('admin.makeOwner')}
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            ))
          )}

          <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginTop: sp.sm }}>
            Add member
          </Txt>
          {atLimit ? (
            <Card>
              <Txt variant="muted">This household is full ({maxMembers} members max).</Txt>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <TextInput
                inputAccessoryViewID={KEYBOARD_DONE_ID}
                value={mName}
                onChangeText={setMName}
                placeholder={t('admin.memberName')}
                placeholderTextColor={c.textFaint}
                style={[inputStyle, { width: 90 }]}
              />
              <TextInput
                inputAccessoryViewID={KEYBOARD_DONE_ID}
                value={mEmail}
                onChangeText={setMEmail}
                placeholder={t('admin.memberEmail')}
                placeholderTextColor={c.textFaint}
                autoCapitalize="none"
                keyboardType="email-address"
                style={[inputStyle, { flex: 1, minWidth: 0 }]}
              />
              <Pressable
                onPress={addMember}
                disabled={!mName.trim() || !mEmail.trim() || busy}
                style={{
                  paddingHorizontal: sp.md,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.accent,
                  opacity: !mName.trim() || !mEmail.trim() || busy ? 0.5 : 1,
                }}
              >
                <Txt style={{ color: '#fff', fontWeight: '700' }}>Add</Txt>
              </Pressable>
            </View>
          )}

          <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginTop: sp.sm }}>
            Recent activity
          </Txt>
          {feed.length === 0 ? (
            <Card>
              <Txt variant="muted">No activity recorded yet.</Txt>
            </Card>
          ) : (
            <View style={{ gap: sp.sm }}>
              {feed.map((f) => (
                <View key={f.id} style={{ flexDirection: 'row', gap: sp.md, alignItems: 'flex-start' }}>
                  <View
                    style={{
                      height: 32,
                      width: 32,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: f.isError ? c.accentSoft : c.surface,
                    }}
                  >
                    <f.icon size={15} color={f.isError ? c.expense : c.accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Txt style={{ fontSize: 13 }}>
                      <Txt style={{ fontSize: 13, fontWeight: '700' }}>{nameFor(f.user_email)}</Txt>
                      {' '}
                      {f.predicate}
                    </Txt>
                    <Txt variant="faint" style={{ fontSize: 11 }}>
                      {[f.app, timeAgo(f.created_at)].filter(Boolean).join(' · ')}
                    </Txt>
                    {f.detail ? (
                      <Txt style={{ color: c.expense, fontSize: 11 }}>{f.detail}</Txt>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={removeHousehold}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: sp.sm,
              backgroundColor: c.card,
              borderRadius: radius.md,
              paddingVertical: 14,
              marginTop: sp.lg,
            }}
          >
            <Trash2 size={18} color={c.expense} />
            <Txt style={{ color: c.expense, fontWeight: '600' }}>Delete household</Txt>
          </Pressable>
        </View>
      )}
    </Screen>
  )
}
