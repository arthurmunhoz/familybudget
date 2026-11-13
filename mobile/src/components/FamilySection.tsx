// Settings › Family — ONE card for everything about your family (owner,
// 2026-11: "My families" and the old members/code section repeated each
// other). Top to bottom:
//   · the active family: its name (no tile — the screen has enough colour) + "2 of 12 members"
//   · its members, one row each: "You" after your name, an Owner tag or (for
//     owners) a remove button on the right; the Plus nudge for free owners
//   · the invite code as a dashed "ticket", a full-width Share and a quiet
//     "New code" (members see who to ask instead)
//   · other families you belong to — tap to switch
//   · "Add another family" → /families (join / create and the rules live
//     there — owner, 2026-11: too much for Settings), then Leave this one
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
  const meta = t('household.memberCount', { count: members.length, max: limit })
  const me = profile?.email

  return (
    <View style={{ gap: sp.sm }}>
      <Txt style={[s.label, { color: c.textMuted }]}>{t('household.title')}</Txt>
      <Card style={{ padding: 0, overflow: 'hidden', ...(highlight ? { borderWidth: 2, borderColor: c.accent } : {}) }}>
        {/* the active family: name big, how full it is under it */}
        <View style={s.head}>
          <Txt numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: c.text }}>
            {title}
          </Txt>
          <Txt variant="faint" numberOfLines={1} style={{ fontSize: 13.5 }}>
            {meta}
          </Txt>
        </View>

        {/* members — one row each, role / remove on the right */}
        <View style={{ paddingHorizontal: sp.md, paddingBottom: sp.sm }}>
          {members.map((m, i) => (
            <View key={m.email} style={[s.member, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}>
              <Initials name={m.display_name} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, color: c.text }}>
                  {m.display_name}
                  {m.email === me ? <Txt style={{ fontFamily: fonts.body, color: c.textFaint }}>{'  ' + t('household.you')}</Txt> : null}
                </Txt>
                <Txt variant="faint" style={{ fontSize: 12 }} numberOfLines={1}>
                  {m.email}
                </Txt>
              </View>
              {m.role === 'owner' ? (
                <View style={[s.ownerTag, { backgroundColor: c.accentSoft }]}>
                  <Crown size={12} color={c.accent} />
                  <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 11.5 }}>{t('household.owner')}</Txt>
                </View>
              ) : isOwner ? (
                <Pressable
                  onPress={() => removeMember(m)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('household.removeMember')}
                  style={({ pressed }) => [s.remove, { backgroundColor: c.surface2, opacity: pressed ? 0.6 : 1 }]}
                >
                  <X size={15} color={c.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {/* The DB trigger is the real cap (migration 059); this is the pitch. */}
          {isOwner && isFree ? (
            <Pressable onPress={() => router.push('/paywall')} hitSlop={6} style={{ paddingTop: sp.xs, paddingBottom: sp.xs }}>
              <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('household.upgradeForMembers', { max: MEMBER_LIMIT_PLUS })}</Txt>
            </Pressable>
          ) : null}
        </View>

        {/* invite code: a ticket you hand out */}
        <View style={[s.block, { borderTopColor: c.border }]}>
          <Txt style={[s.label, { color: c.textMuted }]}>{t('household.inviteCode')}</Txt>
          {isOwner ? (
            <>
              <View style={[s.ticket, { borderColor: c.accent + '66', backgroundColor: c.accentSoft }]}>
                <Txt
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  selectable
                  style={{ fontSize: 28, letterSpacing: 6, fontFamily: fonts.semibold, color: c.text, textAlign: 'center' }}
                >
                  {shownCode ?? '· · · · · · · ·'}
                </Txt>
              </View>
              <Txt variant="faint" style={{ fontSize: 13.5, textAlign: 'center' }}>
                {t('household.inviteHintNamed', { name: title })}
              </Txt>
              <Pressable
                onPress={shareCode}
                disabled={!shownCode}
                accessibilityRole="button"
                style={({ pressed }) => [s.share, { backgroundColor: c.action, opacity: !shownCode ? 0.5 : pressed ? 0.85 : 1 }]}
              >
                <Share2 size={17} color={c.onAction} />
                <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 15.5 }}>{t('household.shareCode')}</Txt>
              </Pressable>
              <Pressable
                onPress={rotate}
                disabled={rotating}
                accessibilityRole="button"
                hitSlop={6}
                style={({ pressed }) => [s.rotate, { opacity: rotating ? 0.5 : pressed ? 0.55 : 1 }]}
              >
                {rotating ? <ActivityIndicator size="small" color={c.textMuted} /> : <RefreshCw size={14} color={c.textMuted} />}
                <Txt style={{ color: c.textMuted, fontFamily: fonts.semibold, fontSize: 13.5 }}>{t('household.newCode')}</Txt>
              </Pressable>
            </>
          ) : (
            <Txt variant="faint" style={{ fontSize: 14 }}>
              {t('household.notOwnerHint')}
            </Txt>
          )}
        </View>

        {/* other families (switch), "Add another family", leave */}
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
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.accent }}>{ini}</Txt>
    </View>
  )
}

const s = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', paddingHorizontal: 2 },
  head: { paddingHorizontal: sp.md, paddingTop: sp.lg, paddingBottom: sp.sm, gap: 2 },
  member: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 12 },
  ownerTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  remove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  block: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: sp.md, paddingTop: sp.md + 2, paddingBottom: sp.sm, gap: sp.md },
  ticket: { height: 68, justifyContent: 'center', paddingHorizontal: sp.lg, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed' },
  share: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.pill },
  rotate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4, alignSelf: 'center' },
})
