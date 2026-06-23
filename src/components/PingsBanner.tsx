import { useEffect, useState } from 'react'
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

/** Live banner of active household pings on the Hub. Updates in real time as
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

  // Hide: sender-dismissed (mine), or acked (recipient — disappears at once).
  const visible = pings.filter((s) => {
    if (s.sender_email === myEmail) return !dismissed.has(s.id)
    return !(ackedLocal.has(s.id) || s.acks.some((a) => a.user_email === myEmail))
  })
  if (visible.length === 0) return null

  const senderName = (email: string) =>
    email === myEmail
      ? t('pings.you')
      : (profiles.find((p) => p.email === email)?.display_name ?? email.split('@')[0])

  async function ack(id: string) {
    setAckedLocal((s) => new Set(s).add(id))
    await ackPing(id)
    revalidate()
  }

  return (
    <div className="mb-4 space-y-2">
      {visible.map((s) => {
        const mine = s.sender_email === myEmail
        const ackNames = s.acks.map((a) => senderName(a.user_email)).join(', ')
        return (
          <div
            key={s.id}
            className={`flex items-center gap-3 rounded-2xl border-l-4 bg-(--surface) py-2.5 pl-3 pr-3 ${
              s.kind === 'help' ? 'border-(--expense)' : 'border-(--accent)'
            }`}
          >
            <span className="text-2xl">{s.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-(--text)">{s.message}</p>
              <p className="truncate text-xs text-(--text-faint)">
                {senderName(s.sender_email)} · {timeAgo(s.created_at)}
                {mine && ackNames && ` · ${t('pings.seenBy', { names: ackNames })}`}
              </p>
            </div>
            {!mine && (
              <div className="flex shrink-0 items-center gap-2">
                {phones[s.sender_email] && (
                  <a
                    href={`tel:${phones[s.sender_email]}`}
                    className="rounded-full bg-(--expense) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                  >
                    📞 {t('pings.call')}
                  </a>
                )}
                <button
                  onClick={() => ack(s.id)}
                  className="rounded-full bg-(--accent) px-3 py-1.5 text-xs font-bold text-white active:scale-95 transition-transform"
                >
                  👍 {t('pings.gotIt')}
                </button>
              </div>
            )}
            {mine && (
              <button
                onClick={() => dismiss(s.id)}
                aria-label={t('common.close')}
                className="shrink-0 px-1 text-lg text-(--text-faint) active:text-(--text)"
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
