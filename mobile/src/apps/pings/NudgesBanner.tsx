// Home-screen nudge banners (the RN equivalent of the PWA's PingsBanner). Two
// groups, both between the Hub header and the app grid:
//  • RECEIVED — active nudges sent TO me I haven't acknowledged, each with a
//    respond CTA (Got it / Call). The row itself is inert: this banner IS the
//    inbox — there is no nudge history screen behind it.
//  • SENT — active nudges I sent, showing who has acknowledged ("seen by …"),
//    each with an ✕ to dismiss from my home (persisted per-device via
//    AsyncStorage; the nudge itself still lives until it expires).
//
// Its own lightweight Realtime subscription (distinct channel from the Nudges
// screen) so it stays live on the Hub. Renders nothing when both groups empty.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Vibration, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Check, Phone, ThumbsUp, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useAuth } from '@/lib/auth'
import { useRevalidateOnForeground } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { supabase } from '@/lib/supabase'
import { channelName } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import type { Ping, PingAck } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

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
      .channel(channelName('hub_nudges_banner'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pings' }, () => scheduleLoad())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ping_acks' }, () => scheduleLoad())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
      if (loadTimer.current) clearTimeout(loadTimer.current)
    }
  }, [load, scheduleLoad])

  // A nudge that arrived (or expired, or was acked) while the app was suspended
  // isn't in the Realtime stream when it resumes — this banner sits on the Hub,
  // the screen most likely to be the one left open, so it was the most visible
  // version of that: tapping the push opened the app to a banner that didn't
  // list the nudge you'd just been told about.
  useRevalidateOnForeground(scheduleLoad)

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

  // Buzz once when a new high-priority nudge arrives (in-app vibration; sound
  // rides the push notification when that's wired).
  const buzzed = useRef<Set<string>>(new Set())
  const highIds = incoming.filter((p) => p.high_priority).map((p) => p.id).join(',')
  useEffect(() => {
    const fresh = incoming.filter((p) => p.high_priority && !buzzed.current.has(p.id))
    if (fresh.length === 0) return
    fresh.forEach((p) => buzzed.current.add(p.id))
    Vibration.vibrate([0, 400, 200, 400])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highIds])

  if (incoming.length === 0 && sent.length === 0) return null

  return (
    <View style={{ gap: sp.sm, marginBottom: sp.lg }}>
      {/* RECEIVED — a gradient card in the Nudges colour (red when it's
          urgent): who and when as a kicker, the message large, the replies as
          pills inside (2026-11). The card itself is inert. */}
      {incoming.map((p) => {
        const isHigh = p.high_priority
        const phone = phones[p.sender_email]
        const colors = isHigh ? URGENT : (APP_GRADIENT.pings as [string, string])
        return (
          <GradientBox key={p.id} colors={colors} radius={24} style={styles.card}>
            <View style={styles.top}>
              <View style={styles.emojiOnColor}>
                <Txt style={styles.emoji}>{p.emoji}</Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={styles.kickerOnColor} numberOfLines={1}>
                  {t('pings.from', { name: firstName(nameOf(p.sender_email)) })} · {timeAgo(p.created_at)}
                </Txt>
                <Txt style={styles.msgOnColor} numberOfLines={3}>
                  {p.message}
                </Txt>
              </View>
            </View>
            <View style={styles.actions}>
              {/* Urgent: Call AND Got it, so a recipient can acknowledge
                  without having to call. */}
              {isHigh && phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                  style={({ pressed }) => [styles.pill, { backgroundColor: '#fff', opacity: pressed ? 0.8 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('pings.call')}
                >
                  <Phone size={15} strokeWidth={2.5} color={colors[1]} />
                  <Txt style={[styles.pillTxt, { color: colors[1] }]}>{t('pings.call')}</Txt>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => ack(p.id)}
                style={({ pressed }) => [
                  styles.pill,
                  isHigh && phone
                    ? { backgroundColor: 'rgba(255,255,255,0.22)' }
                    : { backgroundColor: '#fff' },
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('pings.gotIt')}
              >
                <ThumbsUp size={15} strokeWidth={2.5} color={isHigh && phone ? '#fff' : colors[1]} />
                <Txt style={[styles.pillTxt, { color: isHigh && phone ? '#fff' : colors[1] }]}>{t('pings.gotIt')}</Txt>
              </Pressable>
            </View>
          </GradientBox>
        )
      })}

      {/* SENT — a plain card: what I sent, then WHO HAS SEEN IT, newest first,
          with who's still to see it faded below (owner, 2026-11: "You · No one
          has acknowledged yet" said nothing about who it went to). */}
      {sent.map((p) => {
        const seen = p.acks
          .filter((a) => a.user_email !== myEmail)
          .sort((x, y) => y.created_at.localeCompare(x.created_at))
        const seenSet = new Set(seen.map((a) => a.user_email))
        const audience = (p.recipients?.length ? p.recipients : profiles.map((m) => m.email)).filter(
          (e) => e !== myEmail,
        )
        const waiting = audience.filter((e) => !seenSet.has(e))
        const total = Math.max(audience.length, seen.length)
        return (
          <View key={p.id} style={[styles.card, { backgroundColor: c.card, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.top}>
              <GradientBox colors={APP_GRADIENT.pings as [string, string]} radius={14} style={styles.emojiTile}>
                <Txt style={styles.emoji}>{p.emoji}</Txt>
              </GradientBox>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={[styles.kicker, { color: c.textMuted }]} numberOfLines={1}>
                  {t('pings.youSent')} · {timeAgo(p.created_at)}
                </Txt>
                <Txt style={[styles.msg, { color: c.text }]} numberOfLines={3}>
                  {p.message}
                </Txt>
              </View>
              {/* ✕ dismiss from my home (persists on this device). */}
              <Pressable
                onPress={() => dismiss(p.id)}
                hitSlop={8}
                style={[styles.close, { backgroundColor: c.surface }]}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <X size={14} color={c.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.seenBox, { borderTopColor: c.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt style={[styles.label, { color: c.textMuted }]}>{t('pings.seenByLabel')}</Txt>
                {total ? (
                  <Txt style={[styles.label, { color: seen.length === total ? c.income : c.textMuted }]}>
                    {t('pings.seenCount', { n: seen.length, total })}
                  </Txt>
                ) : null}
              </View>
              {seen.map((a) => (
                <View key={a.user_email} style={styles.person}>
                  <Initials name={nameOf(a.user_email)} />
                  <Txt style={{ flex: 1, fontSize: 14.5, color: c.text }} numberOfLines={1}>
                    {nameOf(a.user_email)}
                  </Txt>
                  <Check size={14} color={c.income} strokeWidth={3} />
                  <Txt variant="faint" style={{ fontSize: 12.5 }}>
                    {timeAgo(a.created_at)}
                  </Txt>
                </View>
              ))}
              {waiting.map((e) => (
                <View key={e} style={[styles.person, { opacity: 0.55 }]}>
                  <Initials name={nameOf(e)} faded />
                  <Txt style={{ flex: 1, fontSize: 14.5, color: c.textMuted }} numberOfLines={1}>
                    {nameOf(e)}
                  </Txt>
                  <Txt variant="faint" style={{ fontSize: 12.5 }}>
                    {t('pings.notYet')}
                  </Txt>
                </View>
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const URGENT: [string, string] = ['#F2605A', '#C9353F']

const firstName = (n: string) => n.split(' ')[0]

/** Initials on a soft accent circle. */
function Initials({ name, faded }: { name: string; faded?: boolean }) {
  const { c } = useTheme()
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const ini = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
  return (
    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: faded ? c.surface : c.accentSoft }}>
      <Txt style={{ fontSize: 12, fontWeight: '700', color: faded ? c.textMuted : c.accent }}>{ini}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, padding: sp.md, gap: sp.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md },
  emojiOnColor: { width: 46, height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  emojiTile: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
  kickerOnColor: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.88)' },
  msgOnColor: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, color: '#fff', marginTop: 2 },
  kicker: { fontSize: 12.5, fontWeight: '600' },
  msg: { fontFamily: fonts.display, fontSize: 18, lineHeight: 23, marginTop: 2 },
  actions: { flexDirection: 'row', gap: sp.sm },
  pill: { flex: 1, height: 42, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pillTxt: { fontWeight: '700', fontSize: 14 },
  close: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  seenBox: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: sp.sm, gap: 8 },
  label: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  person: { flexDirection: 'row', alignItems: 'center', gap: sp.sm },
})
