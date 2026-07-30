// First-login screen for a signed-in user with no household yet (App.tsx shows
// it when `profileLoaded && !profile`). Two steps: say what you'd like to be
// called, then create a household (become its owner) or join one with a code.
// On success we refreshProfile() so App.tsx re-renders straight into the Hub.
// Backed by the SECURITY DEFINER RPCs create_household / join_household
// (migration 051) + set_display_name (057).
//
// Ported from the iOS app's `mobile/src/components/Onboarding.tsx` — same steps,
// same RPCs, same error mapping. The name step exists because create/join stamp
// display_name from jwt_display_name(), which falls back to the email's
// local-part; Google's JWT does carry a name, but a private-relay or
// nameless provider would otherwise land someone in their family's app called
// something like "z5khzgh5ff". We can only apply the name AFTER create/join,
// since that's what creates the allowed_users row to update.
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'

export default function Onboarding() {
  const { t } = useI18n()
  const { refreshProfile, signOut, session } = useAuth()
  const [step, setStep] = useState<'name' | 'household'>('name')
  const [myName, setMyName] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Which path they've picked. Both cards start collapsed to a title + blurb —
  // showing two inputs at once made the choice look like a form to fill in.
  const [choice, setChoice] = useState<'create' | 'join' | null>(null)

  function toHousehold() {
    if (!myName.trim()) {
      setErr(t('onboarding.errYourNameRequired'))
      return
    }
    setErr(null)
    setStep('household')
  }

  /** Apply the chosen name once the allowed_users row exists. Best-effort: they
   *  are already in the household by now, so a failure here must not trap them
   *  on this screen — it's fixable in Family → Edit my info. */
  async function applyName() {
    const n = myName.trim()
    if (!n) return
    await supabase.rpc('set_display_name', { p_name: n })
  }

  // Map the RPC's raised messages (see migration 051) to friendly, localized text.
  function mapError(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('already in a household')) return t('onboarding.errAlready')
    if (m.includes('invalid code')) return t('onboarding.errInvalidCode')
    if (m.includes('household_member_limit')) return t('onboarding.errFull')
    if (m.includes('too many')) return t('onboarding.errTooMany')
    if (m.includes('household name required')) return t('onboarding.errNameRequired')
    return t('onboarding.errGeneric')
  }

  async function create() {
    const n = name.trim()
    if (!n) {
      setErr(t('onboarding.errNameRequired'))
      return
    }
    if (busy) return
    setBusy('create')
    setErr(null)
    const { error } = await supabase.rpc('create_household', { p_name: n })
    if (error) {
      setBusy(null)
      setErr(mapError(error.message))
      return
    }
    await applyName()
    setBusy(null)
    await refreshProfile()
  }

  async function join() {
    const cd = code.trim()
    if (!cd) {
      setErr(t('onboarding.errCodeRequired'))
      return
    }
    if (busy) return
    setBusy('join')
    setErr(null)
    const { error } = await supabase.rpc('join_household', { p_code: cd })
    if (error) {
      setBusy(null)
      setErr(mapError(error.message))
      return
    }
    await applyName()
    setBusy(null)
    await refreshProfile()
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-10">
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="font-display text-3xl font-bold text-(--text)">One Roof</h1>
        {/* Subtle rule parting the brand from the set-up flow. */}
        <div className="my-2 h-px w-full bg-(--text-faint) opacity-40" />
        <h2 className="font-display text-center text-xl font-bold text-(--text)">
          {t('onboarding.title')}
        </h2>
        {/* The instruction only belongs to the household step — on the name step
            the card asks its own question. */}
        {step === 'household' && (
          <p className="text-center text-sm text-(--text-muted)">{t('onboarding.subtitle')}</p>
        )}
        <p className="truncate text-xs text-(--text-faint)">{session?.user.email}</p>
      </div>

      {err && (
        <p className="rounded-xl bg-(--surface) px-4 py-3 text-sm font-medium text-(--expense)">
          {err}
        </p>
      )}

      {step === 'name' ? (
        <>
          <div className="rounded-2xl bg-(--card) p-4 shadow-sm">
            <p className="font-semibold text-(--text)">{t('onboarding.nameTitle')}</p>
            <p className="mt-0.5 text-xs text-(--text-faint)">{t('onboarding.nameDesc')}</p>
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && toHousehold()}
              placeholder={t('onboarding.yourNamePlaceholder')}
              autoCapitalize="words"
              autoCorrect="off"
              maxLength={40}
              className="mt-3 w-full rounded-xl bg-(--surface) px-3.5 py-3 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <button
              onClick={toHousehold}
              disabled={!myName.trim()}
              className="mt-3 w-full rounded-xl bg-(--accent) py-3.5 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {t('onboarding.continue')}
            </button>
          </div>
          <SignOutRow onClick={signOut} label={t('drawer.signOut')} />
        </>
      ) : (
        <>
          {/* Echo the name back, big — they just typed it, so let them actually
              confirm it before committing to a household. */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-(--text-faint)">{t('onboarding.appearAs')}</span>
            <span className="font-display truncate text-xl font-bold text-(--text)">
              {myName.trim()}
            </span>
            <button
              onClick={() => setStep('name')}
              className="text-sm font-semibold text-(--accent)"
            >
              {t('onboarding.changeName')}
            </button>
          </div>

          <ChoiceCard
            title={t('onboarding.createTitle')}
            desc={t('onboarding.createDesc')}
            open={choice === 'create'}
            onOpen={() => setChoice('create')}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder={t('onboarding.namePlaceholder')}
              autoCapitalize="words"
              maxLength={40}
              autoFocus
              className="mt-3 w-full rounded-xl bg-(--surface) px-3.5 py-3 text-base text-(--text) outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <button
              onClick={create}
              disabled={busy !== null}
              className="mt-3 w-full rounded-xl bg-(--accent) py-3.5 font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {busy === 'create' ? t('common.loading') : t('onboarding.createBtn')}
            </button>
          </ChoiceCard>

          <ChoiceCard
            title={t('onboarding.joinTitle')}
            desc={t('onboarding.joinDesc')}
            open={choice === 'join'}
            onOpen={() => setChoice('join')}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder={t('onboarding.codePlaceholder')}
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={8}
              autoFocus
              className="mt-3 w-full rounded-xl bg-(--surface) px-3.5 py-3 text-base tracking-[0.2em] text-(--text) uppercase outline-none focus:ring-2 focus:ring-(--accent)"
            />
            <button
              onClick={join}
              disabled={busy !== null}
              className="mt-3 w-full rounded-xl bg-(--surface-2) py-3.5 font-bold text-(--text) active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {busy === 'join' ? t('common.loading') : t('onboarding.joinBtn')}
            </button>
          </ChoiceCard>

          <SignOutRow onClick={signOut} label={t('drawer.signOut')} />
        </>
      )}
    </div>
  )
}

// Hoisted (not defined inside Onboarding) so React keeps the same component type
// across renders — otherwise every keystroke remounts the input and drops focus.
function ChoiceCard({
  title,
  desc,
  open,
  onOpen,
  children,
}: {
  title: string
  desc: string
  open: boolean
  onOpen: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-(--card) p-4 shadow-sm">
      <button
        onClick={open ? undefined : onOpen}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-(--text)">{title}</span>
          <span className="mt-0.5 block text-xs text-(--text-faint)">{desc}</span>
        </span>
        {!open && (
          <ChevronRight size={20} strokeWidth={2} aria-hidden="true" className="shrink-0 text-(--text-muted)" />
        )}
      </button>
      {open && children}
    </div>
  )
}

function SignOutRow({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-1 w-full rounded-xl py-3 font-semibold text-(--text-muted) active:bg-(--surface)"
    >
      {label}
    </button>
  )
}
