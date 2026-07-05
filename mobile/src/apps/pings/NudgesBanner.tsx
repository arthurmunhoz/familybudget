// Home-screen nudge banners (the RN equivalent of the PWA's PingsBanner). Two
// groups, both between the Hub header and the app grid:
//  • RECEIVED — active nudges sent TO me I haven't acknowledged, each with a
//    respond CTA (Got it / Call). Tapping the body deep-links to the Nudges
//    "Past" tab with the nudge highlighted.
//  • SENT — active nudges I sent, showing who has acknowledged ("seen by …"),
//    each with an ✕ to dismiss from my home (persisted per-device via
//    AsyncStorage; the nudge itself still lives until it expires).
//
// Its own lightweight Realtime subscription (distinct channel from the Nudges
// screen) so it stays live on the Hub. Renders nothing when both groups empty.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Phone, ThumbsUp, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/format'
import type { Ping, PingAck } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

type ActivePing = Ping & { acks: PingAck[] }

/** Active (non-expired) nudges for the household, each with its acks. */
async function fetchActivePings(): Promise<ActivePing[]> {
  const nowISO = new Date().toISOString()
  const { data: rows, error } = await supabase
    .from('pings')
    .select('*')
    .gt('expires_at', nowISO)
    .order('created_at', { ascending: false })
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

async function fetchMemberPhones(): Promise<Record<string, string>> {
  const { data } = await supabase.from('member_profiles').select('email, phone')
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; phone: string | null }[]) {
    if (r.phone) out[r.email] = r.phone
  }
  return out
}

export default function NudgesBanner() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const myEmail = profile?.email

  const [pings, setPings] = useState<ActivePing[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const dismissKey = myEmail ? `nudges-dismissed:${myEmail}` : null

  const load = useCallback(async () => {
    try {
      setPings(await fetchActivePings())
    } catch {
      /* keep what we had */
    }
  }, [])

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current)
    loadTimer.current = setTimeout(() => void load(), 250)
  }, [load])

  useEffect(() => {
    void load()
    void fetchMemberPhones().then(setPhones)
    const channel = supabase
      .channel('hub_nudges_banner')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () => scheduleLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ping_acks' }, () => scheduleLoad())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  // Load this device's dismissed-sent set for the signed-in user.
  useEffect(() => {
    if (!dismissKey) return
    let active = true
    AsyncStorage.getItem(dismissKey).then((raw) => {
      if (!active || !raw) return
      try {
        setDismissed(new Set(JSON.parse(raw) as string[]))
      } catch {
        /* ignore corrupt value */
      }
    })
    return () => {
      active = false
    }
  }, [dismissKey])

  const nameOf = useCallback(
    (email: string) =>
      profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0],
    [profiles],
  )

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await supabase.from('ping_acks').insert({ ping_id: id })
    scheduleLoad()
  }

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id)
      if (dismissKey) void AsyncStorage.setItem(dismissKey, JSON.stringify([...next]))
      return next
    })
  }

  // Nudges sent to me that I haven't acknowledged yet.
  const incoming = pings.filter(
    (p) =>
      p.sender_email !== myEmail &&
      !(ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)),
  )
  // Nudges I sent that are still active and I haven't dismissed from home.
  const sent = pings.filter((p) => p.sender_email === myEmail && !dismissed.has(p.id))

  if (incoming.length === 0 && sent.length === 0) return null

  return (
    <View style={{ gap: sp.sm, marginBottom: sp.lg }}>
      {incoming.map((p) => {
        const isHelp = p.kind === 'help'
        const phone = phones[p.sender_email]
        return (
          <View
            key={p.id}
            style={[styles.row, { backgroundColor: c.card, borderLeftColor: isHelp ? c.expense : c.accent }]}
          >
            {/* Body → deep-link to the Past tab, highlighting this nudge. */}
            <Pressable
              onPress={() => router.push({ pathname: '/pings', params: { tab: 'past', focus: p.id } })}
              style={styles.body}
              accessibilityRole="button"
            >
              <Txt style={styles.emoji}>{p.emoji}</Txt>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt numberOfLines={2} style={{ fontWeight: '600', color: c.text }}>
                  {p.message}
                </Txt>
                <Txt variant="faint" numberOfLines={1}>
                  {nameOf(p.sender_email)} · {timeAgo(p.created_at)}
                </Txt>
              </View>
            </Pressable>
            {/* Respond CTAs (separate targets so they don't trigger the deep-link).
                Help nudges get Call AND Got it, so a recipient can acknowledge —
                and dismiss the banner — without having to call. Other nudges just
                get Got it. */}
            <View style={styles.actions}>
              {isHelp && phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                  style={[styles.actionBtn, { backgroundColor: c.expense }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('pings.call')}
                >
                  <Phone size={14} strokeWidth={2.5} color="#ffffff" />
                  <Txt style={styles.actionTxt}>{t('pings.call')}</Txt>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => ack(p.id)}
                style={[styles.actionBtn, { backgroundColor: c.accent }]}
                accessibilityRole="button"
                accessibilityLabel={t('pings.gotIt')}
              >
                <ThumbsUp size={14} strokeWidth={2.5} color="#ffffff" />
                <Txt style={styles.actionTxt}>{t('pings.gotIt')}</Txt>
              </Pressable>
            </View>
          </View>
        )
      })}

      {sent.map((p) => {
        const ackers = p.acks
          .filter((a) => a.user_email !== myEmail)
          .map((a) => nameOf(a.user_email))
        const seen = ackers.length
          ? t('pings.seenBy', { names: ackers.join(', ') })
          : t('pings.noAcks')
        return (
          <View key={p.id} style={[styles.row, { backgroundColor: c.surface }]}>
            <Pressable
              onPress={() => router.push({ pathname: '/pings', params: { tab: 'past', focus: p.id } })}
              style={styles.body}
              accessibilityRole="button"
            >
              <Txt style={styles.emoji}>{p.emoji}</Txt>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt numberOfLines={2} style={{ fontWeight: '600', color: c.text }}>
                  {p.message}
                </Txt>
                <Txt variant="faint" numberOfLines={1}>
                  {t('pings.you')} · {seen}
                </Txt>
              </View>
            </Pressable>
            {/* ✕ dismiss from my home (persists on this device). */}
            <Pressable
              onPress={() => dismiss(p.id)}
              hitSlop={8}
              style={styles.dismissBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={18} color={c.textFaint} />
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.sm,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    borderLeftColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: sp.md,
  },
  body: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: sp.md },
  emoji: { fontSize: 26 },
  actions: { gap: 6, alignItems: 'stretch' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionTxt: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  dismissBtn: {
    height: 30,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
