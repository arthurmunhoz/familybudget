// Nudges screen — two tabs:
//   • Send new  — the composer (presets + recipient picker + AI box).
//   • Past nudges — the household nudge history (All / Sent / Received), showing
//     who sent each, when, and who acknowledged; active nudges to me stay
//     actionable (Got it / Call). A badge on the tab counts unacked incoming.
//
// This screen owns the ping data + a single Supabase Realtime subscription
// (pings + ping_acks) and hands it to the history tab; the composer inserts
// directly and the subscription reflects it. RLS scopes everything to the
// household; ack inserts get user_email stamped server-side.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'

import { AppHeader, Screen, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { PING_PRESETS } from '@/lib/pings'
import { supabase } from '@/lib/supabase'
import { syncNudgeWidget } from '@/lib/widget'
import type { Ping, PingAck } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import PingComposer from '@/apps/pings/PingComposer'
import PingsHistory, { type PingWithAcks } from '@/apps/pings/PingsHistory'

/** Recent household nudges (newest first), each with its acks attached. */
async function fetchPings(): Promise<PingWithAcks[]> {
  const { data: rows, error } = await supabase
    .from('pings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error
  const pings = (rows ?? []) as Ping[]
  if (!pings.length) return []
  const { data: acks } = await supabase
    .from('ping_acks')
    .select('*')
    .in(
      'ping_id',
      pings.map((p) => p.id),
    )
  const ackList = (acks ?? []) as PingAck[]
  return pings.map((p) => ({ ...p, acks: ackList.filter((a) => a.ping_id === p.id) }))
}

/** Member phone numbers keyed by email (Call button). Missing phones omitted. */
async function fetchMemberPhones(): Promise<Record<string, string>> {
  const { data } = await supabase.from('member_profiles').select('email, phone')
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; phone: string | null }[]) {
    if (r.phone) out[r.email] = r.phone
  }
  return out
}

export default function NudgesScreen() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  // Deep-link from a Hub banner: ?tab=past&focus=<pingId> opens the history and
  // highlights that nudge.
  const params = useLocalSearchParams<{ tab?: string; focus?: string }>()
  const focus = typeof params.focus === 'string' ? params.focus : null
  const [tab, setTab] = useState<'send' | 'past'>(params.tab === 'past' ? 'past' : 'send')
  const [pings, setPings] = useState<PingWithAcks[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  // Optimistic ack: mark handled immediately, before the round-trip lands.
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      setPings(await fetchPings())
    } catch {
      // keep whatever we had — a failed refresh must not wipe the list
    }
  }, [])

  // Coalesce a mutation + its own Realtime echo into one fetch.
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => void load(), 250)
  }, [load])

  useEffect(() => {
    void load()
    void fetchMemberPhones().then(setPhones)
    const channel = supabase
      .channel('nudges_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () => scheduleLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ping_acks' }, () => scheduleLoad())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  // Feed the Home-Screen Nudges widget: provision this device's send token, and
  // hand it the household members (person selector) + localized presets. The
  // widget stores its own selected recipients as they're toggled.
  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await supabase.rpc('widget_token')
      const token = typeof data === 'string' ? data : null
      const members = profiles
        .filter((p) => p.email !== myEmail)
        .map((p) => ({ email: p.email, name: p.display_name || p.email.split('@')[0] }))
      const presets = PING_PRESETS.map((p) => ({
        kind: p.kind,
        emoji: p.emoji,
        label: t(`pings.preset.${p.kind}` as TKey),
      }))
      if (active) syncNudgeWidget({ token, members, presets })
    })()
    return () => {
      active = false
    }
  }, [profiles, myEmail, t])

  const senderName = useCallback(
    (email: string) =>
      email === myEmail
        ? t('pings.you')
        : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0]),
    [myEmail, profiles, t],
  )

  const ack = useCallback(
    async (id: string) => {
      setAckedLocal((s) => new Set(s).add(id))
      await supabase.from('ping_acks').insert({ ping_id: id })
      scheduleLoad()
    },
    [scheduleLoad],
  )

  const call = useCallback((phone: string) => {
    void Linking.openURL(`tel:${phone}`)
  }, [])

  // Active nudges sent to me that I haven't acked → the "Past" tab badge.
  const now = Date.now()
  const unread = pings.filter(
    (p) =>
      p.sender_email !== myEmail &&
      new Date(p.expires_at).getTime() > now &&
      !(ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)),
  ).length

  return (
    <Screen
      header={
        <>
          <AppHeader title="Nudges" />
          <View style={{ flexDirection: 'row', gap: sp.sm, marginBottom: sp.md }}>
            <TabBtn active={tab === 'send'} onPress={() => setTab('send')} label={t('pings.tabSend')} />
            <TabBtn
              active={tab === 'past'}
              onPress={() => setTab('past')}
              label={t('pings.tabPast')}
              badge={unread}
            />
          </View>
        </>
      }
    >
      {tab === 'send' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: sp.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <PingComposer />
        </ScrollView>
      ) : (
        <PingsHistory
          pings={pings}
          phones={phones}
          ackedLocal={ackedLocal}
          myEmail={myEmail}
          senderName={senderName}
          onAck={ack}
          onCall={call}
          focusId={focus}
        />
      )}
    </Screen>
  )
}

function TabBtn({
  active,
  onPress,
  label,
  badge = 0,
}: {
  active: boolean
  onPress: () => void
  label: string
  badge?: number
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: radius.md,
        backgroundColor: active ? c.accentSoft : c.surface,
      }}
    >
      <Txt style={{ fontWeight: '700', color: active ? c.accent : c.textMuted }}>{label}</Txt>
      {badge > 0 ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 5,
            backgroundColor: c.expense,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>{badge}</Txt>
        </View>
      ) : null}
    </Pressable>
  )
}
