import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { timeAgo } from '../lib/format'
import {
  ackSignal,
  fetchActiveSignals,
  fetchMemberPhones,
  type ActiveSignal,
} from '../lib/signals'
import { supabase } from '../lib/supabase'

/** Live banner of active household signals on the Hub. Updates in real time as
 *  signals arrive and as members acknowledge them. */
export default function SignalsBanner() {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const myEmail = profile?.email
  // Cached so it doesn't flash on every Hub remount; revalidated by Realtime.
  const { data: signals = [], revalidate } = useCachedQuery<ActiveSignal[]>(
    'signals:active',
    fetchActiveSignals,
  )
  // Phone numbers (from the Family feature) → a "Call" button on signals whose
  // sender has a number saved.
  const { data: phones = {} } = useCachedQuery<Record<string, string>>(
    'signals:phones',
    fetchMemberPhones,
  )
  // Optimistic ack: hide the button immediately, before the round-trip lands.
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())

  useEffect(() => {
    const channel = supabase
      .channel('hub_signals')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signals' },
        () => revalidate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signal_acks' },
        () => revalidate(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [revalidate])

  if (signals.length === 0) return null

  const senderName = (email: string) =>
    email === myEmail
      ? t('signals.you')
      : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0])

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await ackSignal(id)
    revalidate()
  }

  return (
    <div className="mb-4 space-y-2">
      {signals.map((s) => {
        const mine = s.sender_email === myEmail
        const acked = ackedLocal.has(s.id) || s.acks.some((a) => a.user_email === myEmail)
        const ackCount = s.acks.length
        return (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-2xl border-l-4 border-(--accent) bg-(--surface) py-2.5 pl-3 pr-3"
          >
            <span className="text-2xl">{s.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-(--text)">{s.message}</p>
              <p className="truncate text-xs text-(--text-faint)">
                {senderName(s.sender_email)} · {timeAgo(s.created_at)}
                {mine && ackCount > 0 && ` · ${t('signals.seenBy', { count: ackCount })}`}
              </p>
            </div>
            {!mine && (
              <div className="flex shrink-0 items-center gap-2">
                {phones[s.sender_email] && (
                  <a
                    href={`tel:${phones[s.sender_email]}`}
                    className="rounded-full bg-(--expense) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                  >
                    📞 {t('signals.call')}
                  </a>
                )}
                {acked ? (
                  <span className="text-xs font-semibold text-(--text-faint)">
                    ✓ {t('signals.acked')}
                  </span>
                ) : (
                  <button
                    onClick={() => ack(s.id)}
                    className="rounded-full bg-(--accent) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                  >
                    👍 {t('signals.gotIt')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
