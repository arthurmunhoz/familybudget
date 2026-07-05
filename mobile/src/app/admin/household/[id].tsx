// Admin-only: one household's members + management. RN port of the PWA's
// AdminHousehold page. Reuses admin_user_activity (30d) and the admin RLS
// exception on allowed_users/households.
import { useState } from 'react'
import { Alert, Pressable, Switch, TextInput, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { Award, Trash2, X } from 'lucide-react-native'

import { AppHeader, Card, Loader, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { formatDay, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Household, Profile } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

/** Mirrors the database trigger (migration 016) — keep in sync. */
const MAX_MEMBERS = 6

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
}

export default function AdminHousehold() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [mName, setMName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)

  const {
    data = { household: null, members: [], activity: {}, isPlus: false },
    loading,
    revalidate: load,
  } = useCachedQuery<DetailData>(`admin:household:${id}`, async () => {
    const [h, u, act, plus] = await Promise.all([
      supabase.from('households').select('*').eq('id', id).single(),
      supabase
        .from('allowed_users')
        .select('email, display_name, household_id, is_admin')
        .eq('household_id', id)
        .order('display_name'),
      supabase.rpc('admin_user_activity', { days: 30 }),
      supabase.rpc('admin_household_is_plus', { p_household: id }),
    ])
    return {
      household: (h.data as Household) ?? null,
      members: (u.data ?? []) as Profile[],
      activity: Object.fromEntries(
        ((act.data ?? []) as UserActivity[]).map((a) => [a.user_email, a]),
      ),
      isPlus: plus.data === true,
    }
  })
  const { household, members, activity, isPlus } = data
  const atLimit = members.length >= MAX_MEMBERS

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
    load()
  }

  if (profile && !profile.is_admin) return <Redirect href="/" />

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
            ? t('admin.householdFull', { max: MAX_MEMBERS })
            : t('admin.addMemberError'),
      )
      return
    }
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

  function removeHousehold() {
    if (!household) return
    if (members.length > 0) {
      Alert.alert(t('admin.removeAllMembers'))
      return
    }
    Alert.alert(t('admin.deleteHousehold'), t('admin.deleteConfirm', { name: household.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('households').delete().eq('id', household.id)
          if (error) {
            Alert.alert(t('admin.deleteError'))
            return
          }
          router.back()
        },
      },
    ])
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
            {members.length}/{MAX_MEMBERS} members · created {formatDay(household.created_at.slice(0, 10))}
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
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                      <Txt style={{ fontWeight: '600' }} numberOfLines={1}>
                        {u.display_name}
                      </Txt>
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
              </Card>
            ))
          )}

          <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginTop: sp.sm }}>
            Add member
          </Txt>
          {atLimit ? (
            <Card>
              <Txt variant="muted">This household is full ({MAX_MEMBERS} members max).</Txt>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <TextInput
                value={mName}
                onChangeText={setMName}
                placeholder={t('admin.memberName')}
                placeholderTextColor={c.textFaint}
                style={[inputStyle, { width: 90 }]}
              />
              <TextInput
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

          {members.length === 0 ? (
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
          ) : null}
        </View>
      )}
    </Screen>
  )
}
