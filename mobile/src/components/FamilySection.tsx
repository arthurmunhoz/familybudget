// Settings › Family — ONE card for everything about your family (owner,
// 2026-11: "My families" and the old members/code section repeated each
// other). Top to bottom:
//   · the active family: its name (no tile — the screen has enough colour), "3 of 6 members · you're the owner"
//   · its members (owners can remove), with the Plus nudge for free owners
//   · the invite code (owners: share / new code; members: who to ask)
//   · other families you belong to — tap to switch
//   · a centred "Add a family" divider, then join another / leave this one
//     as plain centred text buttons (owner, 2026-11: no more coloured squares)
// Switching re-renders the whole card for the new family (AuthProvider moves
// profile.household_id first, see lib/households.ts).
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Share, StyleSheet, View } from 'react-native'
import { router } from 'expo-router'
import { Crown, RefreshCw, Share2, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { MEMBER_LIMIT_PLUS, memberLimit, usePlus } from '@/lib/plus'
import { supabase } from '@/lib/supabase'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { FamilySwitcher } from './MyHouseholds'

interface Member {
  email: string
  display_name: string
  role: string
}

export function FamilySection({ highlight = false }: { highlight?: boolean }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()
  const { isPlus, isFree } = usePlus()
  const limit = memberLimit(isPlus)
  const isOwner = profile?.role === 'owner'
  const hid = profile?.household_id ?? null
  const [name, setName] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  const load = useCallback(async () => {
    if (!hid) return
    // Members come from household_members (migration 099): someone whose
    // ACTIVE household is another one still belongs here.
    const [h, m] = await Promise.all([
      supabase.from('households').select('name').eq('id', hid).maybeSingle(),
      supabase.from('household_members').select('email, display_name, role').eq('household_id', hid).order('display_name'),
    ])
    let rows = (m.data as { email: string; display_name: string | null; role: string }[] | null) ?? []
    if (m.error) {
      const legacy = await supabase.from('allowed_users').select('email, display_name, role').eq('household_id', hid).order('display_name')
      rows = (legacy.data as typeof rows | null) ?? []
    }
    setName((h.data as { name?: string } | null)?.name ?? null)
    setMembers(rows.map((r) => ({ ...r, display_name: r.display_name || r.email.split('@')[0] })))
  }, [hid])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    void load()
  }, [load])

  // `hid` too: switching between two families you own needs the other code.
  useEffect(() => {
    if (!isOwner) return
    void supabase.rpc('get_join_code').then(({ data }) => setCode(typeof data === 'string' ? data : null))
  }, [isOwner, hid])
  const shownCode = isOwner ? code : null

  async function shareCode() {
    if (!shownCode) return
    try {
      await Share.share({ message: t('household.shareMessage', { code: shownCode }) })
    } catch {
      /* dismissed */
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

  function removeMember(m: Member) {
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

  const title = name ?? t('household.title')
  const meta = [t('household.memberCount', { count: members.length, max: limit }), isOwner ? t('households.owner') : null].filter(Boolean).join(' · ')

  return (
    <View style={{ gap: sp.sm }}>
      <Txt style={[s.label, { color: c.textMuted }]}>{t('household.title')}</Txt>
      <Card style={{ padding: 0, overflow: 'hidden', ...(highlight ? { borderWidth: 2, borderColor: c.accent } : {}) }}>
        {/* the active family */}
        <View style={s.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: c.text, flexShrink: 1 }}>
                {title}
              </Txt>
              {isOwner ? <Crown size={15} color={c.accent} /> : null}
            </View>
            <Txt variant="faint" numberOfLines={1} style={{ fontSize: 13 }}>
              {meta}
            </Txt>
          </View>
        </View>

        {/* members */}
        <View style={{ paddingHorizontal: sp.md, paddingBottom: sp.md, gap: sp.md }}>
          {members.map((m) => (
            <View key={m.email} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <Initials name={m.display_name} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, flexShrink: 1 }}>
                    {m.display_name}
                  </Txt>
                  {m.role === 'owner' ? (
                    <View style={{ backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
                      <Txt style={{ color: c.accent, fontWeight: '700', fontSize: 10 }}>{t('household.owner').toUpperCase()}</Txt>
                    </View>
                  ) : null}
                </View>
                <Txt variant="faint" style={{ fontSize: 11 }} numberOfLines={1}>
                  {m.email}
                </Txt>
              </View>
              {isOwner && m.role !== 'owner' ? (
                <Pressable onPress={() => removeMember(m)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('household.removeMember')}>
                  <X size={18} color={c.textFaint} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {/* The DB trigger is the real cap (migration 059); this is the pitch. */}
          {isOwner && isFree ? (
            <Pressable onPress={() => router.push('/paywall')} hitSlop={6}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13 }}>{t('household.upgradeForMembers', { max: MEMBER_LIMIT_PLUS })}</Txt>
            </Pressable>
          ) : null}
        </View>

        {/* invite code */}
        <View style={[s.block, { borderTopColor: c.border }]}>
          <View style={{ gap: 2 }}>
            <Txt style={{ fontFamily: fonts.semibold }}>{t('household.inviteCode')}</Txt>
            <Txt variant="faint">{isOwner ? t('household.inviteHint') : t('household.notOwnerHint')}</Txt>
          </View>
          {isOwner ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <View style={[s.code, { backgroundColor: c.surface }]}>
                <Txt numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 20, letterSpacing: 3, fontFamily: fonts.semibold, color: c.text }}>
                  {shownCode ?? '········'}
                </Txt>
              </View>
              <Pressable
                onPress={shareCode}
                disabled={!shownCode}
                accessibilityRole="button"
                style={({ pressed }) => [s.share, { backgroundColor: c.action, opacity: !shownCode ? 0.5 : pressed ? 0.85 : 1 }]}
              >
                <Share2 size={16} color={c.onAction} />
                <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 15 }}>{t('household.share')}</Txt>
              </Pressable>
              <Pressable
                onPress={rotate}
                disabled={rotating}
                accessibilityRole="button"
                accessibilityLabel={t('household.rotate')}
                style={({ pressed }) => [s.rotate, { backgroundColor: c.surface, opacity: rotating ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                {rotating ? <ActivityIndicator size="small" color={c.textMuted} /> : <RefreshCw size={18} color={c.textMuted} />}
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* other families + join / leave */}
        <FamilySwitcher />
      </Card>
    </View>
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

const s = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', paddingHorizontal: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md },
  block: { borderTopWidth: StyleSheet.hairlineWidth, padding: sp.md, gap: sp.md },
  code: { flex: 1, height: 48, justifyContent: 'center', paddingHorizontal: sp.md, borderRadius: radius.md },
  share: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: sp.md, borderRadius: radius.md },
  rotate: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
})
