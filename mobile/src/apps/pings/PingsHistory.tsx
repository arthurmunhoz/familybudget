// "Past nudges" tab — the household nudge history with an All / Sent / Received
// selector. Each row shows who sent it, when, and who acknowledged. A nudge that
// is still active, was sent TO me, and I haven't acked yet keeps its Got it /
// Call action so the history is also where you respond. Data + realtime live in
// the screen (src/app/pings.tsx); this is presentational.
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
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
}: {
  pings: PingWithAcks[]
  phones: Record<string, string>
  ackedLocal: Set<string>
  myEmail?: string
  senderName: (email: string) => string
  onAck: (id: string) => void
  onCall: (phone: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [seg, setSeg] = useState<Seg>('all')

  const filtered = pings.filter((p) =>
    seg === 'all' ? true : seg === 'sent' ? p.sender_email === myEmail : p.sender_email !== myEmail,
  )

  const segs: { id: Seg; label: string }[] = [
    { id: 'all', label: t('pings.filterAll') },
    { id: 'sent', label: t('pings.filterSent') },
    { id: 'received', label: t('pings.filterReceived') },
  ]

  return (
    <View style={{ gap: sp.md }}>
      {/* All / Sent / Received selector */}
      <View style={[styles.segbar, { backgroundColor: c.surface }]}>
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
        <View style={{ gap: sp.sm }}>
          {filtered.map((p) => {
            const mine = p.sender_email === myEmail
            const isHelp = p.kind === 'help'
            const active = new Date(p.expires_at).getTime() > Date.now()
            const ackedByMe = ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)
            const ackNames = p.acks.map((a) => senderName(a.user_email)).join(', ')
            const phone = phones[p.sender_email]
            const actionable = !mine && active && !ackedByMe
            return (
              <View
                key={p.id}
                style={[styles.row, { backgroundColor: c.surface, borderLeftColor: isHelp ? c.expense : c.accent }]}
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
                  isHelp && phone ? (
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
              </View>
            )
          })}
        </View>
      )}
    </View>
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
