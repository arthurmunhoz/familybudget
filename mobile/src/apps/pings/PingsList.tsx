// Live list of active (non-expired) household nudges — the RN equivalent of the
// PWA's PingsBanner. Updates in real time as nudges arrive and as members
// acknowledge them (Supabase Realtime on `pings` + `ping_acks`). RLS scopes
// everything to the household; ack inserts get user_email stamped server-side,
// so the client never passes it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { Phone, ThumbsUp } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { timeAgo } from '@/lib/format'
import type { Ping, PingAck } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

type ActivePing = Ping & { acks: PingAck[] }

/** Active (non-expired) nudges for the household, newest first, each with its
 *  acks attached for the "seen by" line. */
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

/** Phone numbers of household members, keyed by email (for the Call button).
 *  Members without a saved phone are omitted. */
async function fetchMemberPhones(): Promise<Record<string, string>> {
  const { data } = await supabase.from('member_profiles').select('email, phone')
  const out: Record<string, string> = {}
  for (const r of (data ?? []) as { email: string; phone: string | null }[]) {
    if (r.phone) out[r.email] = r.phone
  }
  return out
}

export default function PingsList() {
  const { c } = useTheme()
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const myEmail = profile?.email

  const [pings, setPings] = useState<ActivePing[]>([])
  const [phones, setPhones] = useState<Record<string, string>>({})
  // Optimistic ack: hide the row immediately, before the round-trip lands.
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const data = await fetchActivePings()
      setPings(data)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () =>
        scheduleLoad(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ping_acks' }, () =>
        scheduleLoad(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  const senderName = useCallback(
    (email: string) =>
      email === myEmail
        ? t('pings.you')
        : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0]),
    [myEmail, profiles, t],
  )

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await supabase.from('ping_acks').insert({ ping_id: id })
    scheduleLoad()
  }

  function call(phone: string) {
    void Linking.openURL(`tel:${phone}`)
  }

  // Show: nudges I sent (always, so I can see who's seen them), and nudges to me
  // that I haven't acked yet (they disappear the moment I ack).
  const visible = pings.filter((p) => {
    if (p.sender_email === myEmail) return true
    return !(ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail))
  })
  if (visible.length === 0) return null

  return (
    <View style={{ gap: sp.sm, marginBottom: sp.lg }}>
      {visible.map((p) => {
        const mine = p.sender_email === myEmail
        const isHelp = p.kind === 'help'
        const ackNames = p.acks.map((a) => senderName(a.user_email)).join(', ')
        const phone = phones[p.sender_email]
        return (
          <View
            key={p.id}
            style={[
              styles.row,
              {
                backgroundColor: c.surface,
                borderLeftColor: isHelp ? c.expense : c.accent,
              },
            ]}
          >
            <Txt style={styles.emoji}>{p.emoji}</Txt>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt numberOfLines={2} style={{ fontWeight: '600', color: c.text }}>
                {p.message}
              </Txt>
              <Txt variant="faint" numberOfLines={1}>
                {senderName(p.sender_email)} · {timeAgo(p.created_at)}
                {mine && ackNames ? ` · ${t('pings.seenBy', { names: ackNames })}` : ''}
              </Txt>
            </View>
            {!mine && (
              <View style={styles.actions}>
                {/* "Need help" with a saved phone → call the sender. Every other
                    nudge (and help with no phone) gets a "Got it" ack. */}
                {isHelp && phone ? (
                  <Pressable
                    onPress={() => call(phone)}
                    style={[styles.actionBtn, { backgroundColor: c.expense }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('pings.call')}
                  >
                    <Phone size={14} strokeWidth={2.5} color="#ffffff" />
                    <Txt style={styles.actionTxt}>{t('pings.call')}</Txt>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => ack(p.id)}
                    style={[styles.actionBtn, { backgroundColor: c.accent }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('pings.gotIt')}
                  >
                    <ThumbsUp size={14} strokeWidth={2.5} color="#ffffff" />
                    <Txt style={styles.actionTxt}>{t('pings.gotIt')}</Txt>
                  </Pressable>
                )}
              </View>
            )}
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
    gap: sp.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    paddingVertical: 10,
    paddingHorizontal: sp.md,
  },
  emoji: { fontSize: 26 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  actionTxt: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
})
