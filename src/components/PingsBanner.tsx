import { useEffect, useState } from 'react'
import { Phone, ThumbsUp, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useI18n } from '../hooks/useI18n'
import { timeAgo } from '../lib/format'
import {
  ackPing,
  fetchActivePings,
  fetchMemberPhones,
  type ActivePing,
} from '../lib/pings'
import { supabase } from '../lib/supabase'

/** Live banner of active household pings on the Hub and Pings page. Two groups:
 *  RECEIVED — active pings sent to me I haven't acknowledged, each with a
 *  respond CTA (high-priority gets BOTH Call and Got it; others just Got it).
 *  SENT — active pings I sent, showing ack status ("seen by …"), each with an
 *  ✕ to dismiss from my view (persisted per device). Updates in real time as
 *  pings arrive and as members acknowledge them. */
export default function PingsBanner() {
  const { profile, profiles } = useAuth()
  const { t } = useI18n()
  const myEmail = profile?.email
  // Cached so it doesn't flash on every Hub remount; revalidated by Realtime.
  const { data: pings = [], revalidate } = useCachedQuery<ActivePing[]>(
    'pings:active',
    fetchActivePings,
  )
  // Phone numbers (from the Family feature) → a "Call" button on pings whose
  // sender has a number saved.
  const { data: phones = {} } = useCachedQuery<Record<string, string>>(
    'pings:phones',
    fetchMemberPhones,
  )
  // Optimistic ack: hide the button immediately, before the round-trip lands.
  const [ackedLocal, setAckedLocal] = useState<Set<string>>(new Set())

  // The sender can dismiss their own banner (persisted per device). Recipients
  // don't dismiss manually — their banner disappears the moment they ack.
  const dismissKey = `pings-dismissed:${myEmail ?? ''}`
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(dismissKey) || '[]') as string[])
    } catch {
      return new Set()
    }
  })
  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id)
      try {
        localStorage.setItem(dismissKey, JSON.stringify([...next]))
      } catch {
        // ignore storage failures
      }
      return next
    })
  }
  useEffect(() => {
    const channel = supabase
      .channel('hub_pings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pings' },
        () => revalidate(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ping_acks' },
        () => revalidate(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [revalidate])

  const senderName = (email: string) =>
    email === myEmail
      ? t('pings.you')
      : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0])

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await ackPing(id)
    revalidate()
  }

  // Pings sent to me that I haven't acknowledged yet.
  const incoming = pings.filter(
    (p) =>
      p.sender_email !== myEmail &&
      !(ackedLocal.has(p.id) || p.acks.some((a) => a.user_email === myEmail)),
  )
  // Pings I sent that are still active and I haven't dismissed from view.
  const sent = pings.filter((p) => p.sender_email === myEmail && !dismissed.has(p.id))

  if (incoming.length === 0 && sent.length === 0) return null

  return (
    <div className="mb-4 space-y-2">
      {incoming.map((p) => {
        const isHigh = p.high_priority
        const phone = phones[p.sender_email]
        return (
          <div
            key={p.id}
            className={`flex items-center gap-3 rounded-2xl border-l-4 bg-(--surface) py-2.5 pl-3 pr-3 ${
              isHigh ? 'border-(--expense)' : 'border-(--accent)'
            }`}
          >
            <span className="text-2xl">{p.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-(--text)">{p.message}</p>
              <p className="truncate text-xs text-(--text-faint)">
                {senderName(p.sender_email)} · {timeAgo(p.created_at)}
              </p>
            </div>
            {/* High-priority pings get BOTH Call and Got it, so a recipient can
                acknowledge without having to call. Other pings just get Got it. */}
            <div className="flex shrink-0 items-center gap-2">
              {isHigh && phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-1 rounded-full bg-(--expense) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                >
                  <Phone size={14} strokeWidth={2} aria-hidden="true" />
                  {t('pings.call')}
                </a>
              )}
              <button
                onClick={() => ack(p.id)}
                className="flex items-center gap-1 rounded-full bg-(--accent) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
              >
                <ThumbsUp size={14} strokeWidth={2} aria-hidden="true" />
                {t('pings.gotIt')}
              </button>
            </div>
          </div>
        )
      })}

      {sent.map((p) => {
        const ackers = p.acks
          .filter((a) => a.user_email !== myEmail)
          .map((a) => senderName(a.user_email))
        const seen = ackers.length
          ? t('pings.seenBy', { names: ackers.join(', ') })
          : t('pings.noAcks')
        return (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-2xl bg-(--surface) py-2.5 pl-3 pr-3"
          >
            <span className="text-2xl">{p.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-(--text)">{p.message}</p>
              <p className="truncate text-xs text-(--text-faint)">
                {t('pings.you')} · {seen}
              </p>
            </div>
            <button
              onClick={() => dismiss(p.id)}
              aria-label={t('common.close')}
              className="shrink-0 px-1 text-(--text-faint) active:text-(--text)"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
