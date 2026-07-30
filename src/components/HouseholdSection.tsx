// Household section of the settings drawer: who's in it, and (for the owner) the
// invite code that lets family join. Ported from the iOS app's settings screen
// (`mobile/src/app/settings.tsx` HouseholdSection) — same RPCs, same semantics.
//
// Everything here goes through the SECURITY DEFINER RPCs from migration 051
// (get_join_code / rotate_join_code / remove_member): clients never write
// allowed_users or household_join_codes directly. `role === 'owner'` is the
// household-scoped role — NOT `is_admin`, which is a global super-admin flag.
import { useState } from 'react'
import { Check, Copy, RotateCcw, Share2, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { useHousehold } from '../hooks/useHousehold'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'

/** Mirrors the DB trigger in migration 059 — the trigger is the real cap, this
 *  is only the count we show. */
const MEMBER_LIMIT_FREE = 4
const MEMBER_LIMIT_PLUS = 12

type Member = { email: string; display_name: string; role: string }

export default function HouseholdSection() {
  const { profile } = useAuth()
  const { household } = useHousehold()
  const { t } = useI18n()
  const isOwner = profile?.role === 'owner'
  const hid = profile?.household_id ?? null

  const [rotated, setRotated] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)
  const [copied, setCopied] = useState(false)

  // Cached like every other screen's data, so re-opening the drawer renders the
  // roster instantly instead of flashing empty. The join code is fetched here
  // too: get_join_code() returns null for anyone who isn't the owner, so asking
  // unconditionally is safe and keeps this to one round-trip set.
  type Data = { members: Member[]; isPlus: boolean; code: string | null }
  const { data, revalidate } = useCachedQuery<Data>(`household:${hid ?? ''}`, async () => {
    if (!hid) return { members: [], isPlus: false, code: null }
    const [m, plus, jc] = await Promise.all([
      supabase
        .from('allowed_users')
        .select('email, display_name, role')
        .eq('household_id', hid)
        .order('display_name'),
      supabase.rpc('current_household_is_plus'),
      supabase.rpc('get_join_code'),
    ])
    return {
      members: (m.data as Member[] | null) ?? [],
      isPlus: plus.data === true,
      code: typeof jc.data === 'string' ? jc.data : null,
    }
  })

  const members = data?.members ?? []
  const isPlus = data?.isPlus ?? false
  // A rotation returns the new code directly; prefer it over the cached one.
  const code = rotated ?? data?.code ?? null

  const shareText = () =>
    t('household.shareMessage', { code: code ?? '', url: window.location.origin })

  async function copyCode() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked (insecure context / permission) — the code is on screen */
    }
  }

  async function shareCode() {
    if (!code) return
    try {
      await navigator.share({ text: shareText() })
    } catch {
      /* user dismissed the share sheet, or it's unavailable */
    }
  }

  async function rotate() {
    if (rotating || !confirm(t('household.rotateConfirm'))) return
    setRotating(true)
    const { data, error } = await supabase.rpc('rotate_join_code')
    setRotating(false)
    if (error || typeof data !== 'string') {
      alert(t('household.rotateError'))
      return
    }
    setRotated(data)
    void revalidate()
  }

  async function removeMember(m: Member) {
    if (!confirm(t('household.removeConfirm', { name: m.display_name }))) return
    const { error } = await supabase.rpc('remove_member', { p_email: m.email })
    if (error) {
      alert(t('household.removeError'))
      return
    }
    void revalidate()
  }

  if (!hid) return null
  const limit = isPlus ? MEMBER_LIMIT_PLUS : MEMBER_LIMIT_FREE
  // navigator.share is Android Chrome + iOS Safari; desktop Chrome mostly isn't.
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <div className="mt-6">
      <span className="text-sm text-(--text-muted)">{t('household.title')}</span>

      <div className="mt-2 rounded-xl bg-(--surface) p-3">
        {household?.name && (
          <div className="font-display mb-2 text-base font-bold text-(--text)">
            {household.name}
          </div>
        )}
        <div className="space-y-2.5">
          {members.map((m) => (
            <div key={m.email} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-(--text)">
                    {m.display_name}
                  </span>
                  {m.role === 'owner' && (
                    <span className="shrink-0 rounded-full bg-(--accent-soft) px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-(--accent) uppercase">
                      {t('household.owner')}
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-(--text-faint)">{m.email}</div>
              </div>
              {isOwner && m.role !== 'owner' && (
                <button
                  onClick={() => removeMember(m)}
                  aria-label={t('household.removeMember')}
                  className="shrink-0 p-1 text-(--text-faint) active:text-(--expense)"
                >
                  <X size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-(--text-faint)/25 pt-2.5 text-xs text-(--text-faint)">
          {t('household.memberCount', { count: members.length, max: limit })}
        </div>
      </div>

      {isOwner ? (
        <div className="mt-2 rounded-xl bg-(--surface) p-3">
          <div className="text-sm font-semibold text-(--text)">{t('household.inviteCode')}</div>
          <p className="mt-0.5 text-xs text-(--text-faint)">{t('household.inviteHint')}</p>
          <div className="mt-2.5 rounded-lg bg-(--card) py-3 text-center">
            <span className="font-mono text-xl font-bold tracking-[0.25em] text-(--text)">
              {code ?? '········'}
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={copyCode}
              disabled={!code}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-(--accent) py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {copied ? (
                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Copy size={14} strokeWidth={2} aria-hidden="true" />
              )}
              {copied ? t('household.copied') : t('household.copy')}
            </button>
            {canShare && (
              <button
                onClick={shareCode}
                disabled={!code}
                aria-label={t('household.share')}
                className="rounded-lg bg-(--card) px-3 py-2.5 text-(--text) disabled:opacity-50"
              >
                <Share2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <button
              onClick={rotate}
              disabled={rotating || !code}
              aria-label={t('household.rotate')}
              className="rounded-lg bg-(--card) px-3 py-2.5 text-(--text-muted) disabled:opacity-50"
            >
              <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-(--text-faint)">{t('household.notOwnerHint')}</p>
      )}
    </div>
  )
}
