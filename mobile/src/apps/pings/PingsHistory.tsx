// "Past nudges" tab — the household nudge history with an All / Sent / Received
// selector. Each row shows who sent it, when, and who acknowledged. A nudge that
// is still active, was sent TO me, and I haven't acked yet keeps its Got it /
// Call action so the history is also where you respond.
//
// Deep-link: when the Hub banner is tapped, the screen passes focusId here — we
// switch to "All", scroll that nudge into view, and pulse-highlight it so the
// user can spot it. Data + realtime live in the screen (src/app/pings.tsx).
import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Phone, ThumbsUp } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatDay, timeAgo } from '@/lib/format'
import type { Ping, PingAck } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'

export type PingWithAcks = Ping & { acks: PingAck[] }
type Seg = 'all' | 'sent' | 'received'

/** timeAgo for the first day, then the calendar day for older nudges. */
function when(iso: string): string {
  return Date.now() - new Date(iso).getTime() > 86_400_000 ? formatDay(iso.slice(0, 10)) : timeAgo(iso)
}

export default function PingsHistory({
  pings,
  phones,
  ackedLocal,
  myEmail,
  senderName,
  onAck,
  onCall,
  focusId,
}: {
  pings: PingWithAcks[]
  phones: Record<string, string>
  ackedLocal: Set<string>
  myEmail?: string
  senderName: (email: string) => string
  onAck: (id: string) => void
  onCall: (phone: string) => void
  /** A nudge to scroll to + highlight (set when arriving from a Hub banner). */
  focusId?: string | null
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [seg, setSeg] = useState<Seg>('all')
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const scrollRef = useRef<ScrollView>(null)
  const rowY = useRef<Record<string, number>>({})

  // Arriving from a Hub banner: show everything (so the target is present),
  // scroll it into view, and pulse-highlight it.
  useEffect(() => {
    if (!focusId) return
    setSeg('all')
    setHighlightId(focusId)
    const scrollT = setTimeout(() => {
      const y = rowY.current[focusId]
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true })
    }, 180)
    const clearT = setTimeout(() => setHighlightId(null), 2800)
    return () => {
      clearTimeout(scrollT)
      clearTimeout(clearT)
    }
  }, [focusId])

  const filtered = pings.filter((p) =>
    seg === 'all' ? true : seg === 'sent' ? p.sender_email === myEmail : p.sender_email !== myEmail,
  )

  const segs: { id: Seg; label: string }[] = [
    { id: 'all', label: t('pings.filterAll') },
    { id: 'sent', label: t('pings.filterSent') },
    { id: 'received', label: t('pings.filterReceived') },
  ]

  return (
    <View style={{ flex: 1 }}>
      {/* All / Sent / Received selector (fixed above the scroll) */}
      <View style={[styles.segbar, { backgroundColor: c.surface, marginTop: sp.sm }]}>
        {segs.map((s) => {
          const active = seg === s.id
          return (
            <Pressable
              key={s.id}
              onPress={() => setSeg(s.id)}
              style={[styles.segBtn, active && { backgroundColor: c.accent }]}
              accessibilityRole="button"
            >
              <Txt style={{ fontWeight: '700', fontSize: 14, color: active ? '#ffffff' : c.textMuted }}>
                {s.label}
              </Txt>
            </Pressable>
          )
        })}
      </View>

      {filtered.length === 0 ? (
        <Txt variant="muted" style={{ textAlign: 'center', paddingVertical: sp.xl }}>
          {t('pings.empty')}
        </Txt>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: sp.sm, paddingTop: sp.md, paddingBottom: sp.xxl }}
        >
          {filtered.map((p) => (
            <HistoryRow
              key={p.id}
              p={p}
              highlighted={highlightId === p.id}
              myEmail={myEmail}
              phones={phones}
              ackedLocal={ackedLocal}
              senderName={senderName}
              onAck={onAck}
              onCall={onCall}
              onLayout={(y) => {
                rowY.current[p.id] = y
              }}
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function HistoryRow({
  p,
  highlighted,
  myEmail,
  phones,
  ackedLocal,
  senderName,
  onAck,
  onCall,
  onLayout,
}: {
  p: PingWithAcks
  highlighted: boolean
  myEmail?: string
  phones: Record<string, string>
  ackedLocal: Set<string>
  senderName: (email: string) => string
  onAck: (id: string) => void
  onCall: (phone: string) => void
  onLayout: (y: number) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!highlighted) return
    anim.setValue(0)
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 650, useNativeDriver: false }),
      ]),
      { iterations: 2 },
    ).start()
  }, [highlighted, anim])

  const mine = p.sender_email === myEmail
  const isHigh = p.high_priority
  const active = new Date(p.expires_at).getTime() > Date.now()
  const ackedByMe = ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)
  const ackNames = p.acks.map((a) => senderName(a.user_email)).join(', ')
  const phone = phones[p.sender_email]
  const actionable = !mine && active && !ackedByMe

  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [c.surface, c.accentSoft] })

  return (
    <Animated.View
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
      style={[styles.row, { backgroundColor: bg, borderLeftColor: isHigh ? c.expense : c.accent }]}
    >
      <Txt style={styles.emoji}>{p.emoji}</Txt>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt numberOfLines={2} style={{ fontWeight: '600', color: c.text }}>
          {p.message}
        </Txt>
        <Txt variant="faint" numberOfLines={1}>
          {senderName(p.sender_email)} · {when(p.created_at)}
        </Txt>
        <Txt variant="faint" numberOfLines={1}>
          {ackNames ? t('pings.seenBy', { names: ackNames }) : t('pings.noAcks')}
        </Txt>
      </View>
      {actionable ? (
        isHigh && phone ? (
          <Pressable
            onPress={() => onCall(phone)}
            style={[styles.actionBtn, { backgroundColor: c.expense }]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.call')}
          >
            <Phone size={14} strokeWidth={2.5} color="#ffffff" />
            <Txt style={styles.actionTxt}>{t('pings.call')}</Txt>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onAck(p.id)}
            style={[styles.actionBtn, { backgroundColor: c.accent }]}
            accessibilityRole="button"
            accessibilityLabel={t('pings.gotIt')}
          >
            <ThumbsUp size={14} strokeWidth={2.5} color="#ffffff" />
            <Txt style={styles.actionTxt}>{t('pings.gotIt')}</Txt>
          </Pressable>
        )
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  segbar: { flexDirection: 'row', borderRadius: radius.pill, padding: 4, gap: 4 },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
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
