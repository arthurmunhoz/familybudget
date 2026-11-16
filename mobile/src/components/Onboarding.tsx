// First-login screen for a signed-in user with no household yet (index.tsx shows
// it when `profileLoaded && !profile`). Two steps: say what you'd like to be
// called, then create a household (become its owner) or join one with a code. On
// success we refreshProfile() so index.tsx re-renders straight into the Hub.
// Backed by the SECURITY DEFINER RPCs create_household / join_household
// (migration 051) + set_display_name (057).
//
// The name step exists because create_household/join_household stamp
// display_name from jwt_display_name(), which falls back to the email's
// local-part when the JWT has no name claim — and Apple NEVER puts a name in the
// token, so "Hide My Email" users were landing in their family's app called
// things like "z5khzgh5ff". We can only apply the name AFTER create/join, since
// that's what creates the allowed_users row to update.
//
// 2026-11-15 restyle: the Home's language on every step — three progress
// bars, a big display title with a faded line under it, the Family purple on
// the avatar, choice tiles and the one primary button.
// 2026-11 redesign (components/form): calm, ONE primary action per step. The
// name is a row; create vs join is a two-row choice; only the chosen path's
// field and its button appear. Sign out is a quiet text link, not a button.
import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native'
import { Check, House, KeyRound, Plus, Share2 } from 'lucide-react-native'

import { Screen, Txt } from './ui'
import { TintButton } from './TintButton'
import { Pressable } from './Pressable'
import { FormSection, TextRow } from './form'
import { GradientBox } from './home/GradientBox'
import { APP_GRADIENT } from './home/palette'
import { track } from '../lib/analytics'
import { fetchJoinCode, shareInvite, takePendingJoinCode } from '../lib/invite'
import { takePendingDisplayName, useAuth } from '../lib/auth'
import { useI18n } from '../hooks/useI18n'
import { supabase } from '../lib/supabase'
import { fonts, sp, useTheme } from '../theme/theme'

// Setting up a household is Family's business: its purple carries the steps.
const FAMILY = APP_GRADIENT.family

/** One of the two household paths, as a tile: gradient icon, title, one line
 *  of context; the chosen one is outlined and washed in the Family colour. */
function ChoiceTile({
  icon,
  title,
  desc,
  selected,
  onPress,
}: {
  icon: ReactNode
  title: string
  desc: string
  selected: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: selected ? FAMILY[1] + '14' : c.card, borderColor: selected ? FAMILY[1] : c.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <GradientBox colors={FAMILY} radius={14} style={styles.choiceIcon}>
        {icon}
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt style={{ fontSize: 16.5, fontFamily: fonts.semibold, color: c.text }}>{title}</Txt>
        <Txt variant="faint" style={{ fontSize: 13.5, lineHeight: 18 }}>
          {desc}
        </Txt>
      </View>
      <View style={[styles.radio, selected ? { backgroundColor: FAMILY[1], borderColor: FAMILY[1] } : { borderColor: c.border }]}>
        {selected ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
      </View>
    </Pressable>
  )
}

/** Where you are in the set-up: three small bars. */
function Steps({ at }: { at: number }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible={false}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: i === at ? 28 : 14, height: 5, borderRadius: 3, backgroundColor: i <= at ? FAMILY[1] : c.border }} />
      ))}
    </View>
  )
}

/** The step's heading in the Home's type: big title, faded line under it. */
function Head({ title, sub }: { title: string; sub?: string }) {
  const { c } = useTheme()
  return (
    <View>
      <Txt style={{ fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.6, color: c.text }}>{title}</Txt>
      {sub ? <Txt style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 25, color: c.textFaint }}>{sub}</Txt> : null}
    </View>
  )
}

/** A low-key text action (Change, Sign out). */
function QuietLink({ label, onPress, accent, left }: { label: string; onPress: () => void; accent?: boolean; left?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={{ alignSelf: left ? 'flex-start' : 'center', paddingVertical: sp.xs }}>
      <Txt style={{ fontSize: 14, fontFamily: fonts.semibold, color: accent ? FAMILY[1] : c.textMuted }}>{label}</Txt>
    </Pressable>
  )
}

export default function Onboarding() {
  const { t } = useI18n()
  const { c } = useTheme()
  const { refreshProfile, signOut } = useAuth()
  const [step, setStep] = useState<'name' | 'household' | 'invite'>('name')
  const [myName, setMyName] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  // Which path they've picked. Both cards start collapsed to a title + blurb —
  // showing two inputs at once made the choice look like a form to fill in.
  const [choice, setChoice] = useState<'create' | 'join' | null>(null)
  // The invite step (2026-11-15): right after creating the household, while
  // the person still has the reason they installed the app in mind. A household
  // of one is the most common way this app dies, and the code used to be a
  // banner and several screens away.
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [shared, setShared] = useState(false)
  // Arrived through an invite link (app/join.tsx): the code is already known.
  const [viaLink, setViaLink] = useState(false)

  useEffect(() => {
    void takePendingJoinCode().then((cd) => {
      if (!cd) return
      setCode(cd)
      setChoice('join')
      setViaLink(true)
    })
  }, [])

  // Apple gives us the real name exactly once, at sign-in — use it as the
  // default. Don't clobber anything already typed if this resolves late.
  useEffect(() => {
    void takePendingDisplayName().then((n) => {
      if (n) setMyName((cur) => cur || n)
    })
  }, [])

  function toHousehold() {
    if (!myName.trim()) {
      Alert.alert(t('onboarding.errYourNameRequired'))
      return
    }
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
      Alert.alert(t('onboarding.errNameRequired'))
      return
    }
    if (busy) return
    setBusy('create')
    const { error } = await supabase.rpc('create_household', { p_name: n })
    if (error) {
      setBusy(null)
      Alert.alert(mapError(error.message))
      return
    }
    await applyName()
    track('household.created')
    // Only the owner can read the code, and they just became one. No code
    // (offline, an old server) → straight to the Hub, where the banner waits.
    const jc = await fetchJoinCode().catch(() => null)
    setBusy(null)
    if (!jc) {
      await refreshProfile()
      return
    }
    setInviteCode(jc)
    setStep('invite')
    track('invite.shown', { source: 'onboarding' })
  }

  async function sendInvite() {
    if (!inviteCode) return
    if (await shareInvite(t, inviteCode, 'onboarding')) setShared(true)
  }

  async function finishInvite() {
    if (!shared) track('invite.skipped', { source: 'onboarding' })
    await refreshProfile()
  }

  async function join() {
    const cd = code.trim()
    if (!cd) {
      Alert.alert(t('onboarding.errCodeRequired'))
      return
    }
    if (busy) return
    setBusy('join')
    const { error } = await supabase.rpc('join_household', { p_code: cd })
    if (error) {
      setBusy(null)
      Alert.alert(mapError(error.message))
      return
    }
    await applyName()
    track('household.joined', { via: viaLink ? 'link' : 'typed' })
    setBusy(null)
    await refreshProfile()
  }

  const initial = (myName.trim().charAt(0) || '?').toUpperCase()
  return (
    <Screen scroll>
      <View style={{ gap: sp.xl, paddingTop: sp.lg, paddingBottom: sp.xxl }}>
        <Steps at={step === 'name' ? 0 : step === 'household' ? 1 : 2} />

        {step === 'invite' ? (
          <View style={{ gap: sp.lg }}>
            <Head title={t('onboarding.inviteTitle')} sub={shared ? t('onboarding.inviteSent') : t('onboarding.inviteBody')} />
            {/* You, and the empty seats next to you. */}
            <View style={styles.seats}>
              <GradientBox colors={FAMILY} radius={32} style={styles.seat}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 26, color: '#fff' }}>{initial}</Txt>
              </GradientBox>
              {[0, 1].map((i) => (
                <View key={i} style={[styles.seat, styles.seatEmpty, { borderColor: c.border }]}>
                  <Plus size={22} color={c.textFaint} strokeWidth={2.2} />
                </View>
              ))}
            </View>
            <View style={[styles.ticket, { borderColor: c.border, backgroundColor: c.card }]}>
              <Txt variant="faint" style={{ fontSize: 12.5 }}>
                {t('onboarding.inviteCodeLabel')}
              </Txt>
              <Txt selectable style={{ fontFamily: fonts.display, fontSize: 26, letterSpacing: 4, color: c.text }}>
                {inviteCode}
              </Txt>
            </View>
            {shared ? (
              <>
                <TintButton inline tint={FAMILY[1]} colors={FAMILY} title={t('onboarding.continue')} onPress={() => void finishInvite()} />
                <QuietLink label={t('onboarding.inviteAgain')} onPress={sendInvite} accent />
              </>
            ) : (
              <>
                <TintButton
                  inline
                  tint={FAMILY[1]}
                  colors={FAMILY}
                  icon={<Share2 size={18} color="#fff" strokeWidth={2.4} />}
                  title={t('onboarding.inviteCta')}
                  onPress={() => void sendInvite()}
                />
                <QuietLink label={t('onboarding.inviteLater')} onPress={finishInvite} />
              </>
            )}
          </View>
        ) : step === 'name' ? (
          <View style={{ gap: sp.lg }}>
            <Head title={t('onboarding.nameTitle')} sub={t('onboarding.nameDesc')} />
            {/* The avatar the family will see, filling in as you type. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
              <GradientBox colors={FAMILY} radius={32} style={styles.seat}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 26, color: '#fff' }}>{initial}</Txt>
              </GradientBox>
              <View style={{ flex: 1 }}>
                <FormSection>
                  <TextRow
                    label={t('family.myName')}
                    value={myName}
                    onChangeText={setMyName}
                    placeholder={t('onboarding.yourNamePlaceholder')}
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={toHousehold}
                  />
                </FormSection>
              </View>
            </View>
            <TintButton inline tint={FAMILY[1]} colors={FAMILY} title={t('onboarding.continue')} onPress={toHousehold} disabled={!myName.trim()} />
            <QuietLink label={t('settings.signOut')} onPress={signOut} />
          </View>
        ) : (
          <View style={{ gap: sp.lg }}>
            <Head title={t('onboarding.houseTitle', { name: myName.trim().split(/\s+/)[0] })} sub={t('onboarding.subtitle')} />
            <QuietLink label={`${t('onboarding.appearAs')} ${myName.trim()} · ${t('onboarding.changeName')}`} onPress={() => setStep('name')} accent left />

            <View style={{ gap: sp.md }}>
              <ChoiceTile
                icon={<House size={20} color="#fff" strokeWidth={2.2} />}
                title={t('onboarding.createTitle')}
                desc={t('onboarding.createDesc')}
                selected={choice === 'create'}
                onPress={() => setChoice('create')}
              />
              <ChoiceTile
                icon={<KeyRound size={20} color="#fff" strokeWidth={2.2} />}
                title={t('onboarding.joinTitle')}
                desc={t('onboarding.joinDesc')}
                selected={choice === 'join'}
                onPress={() => setChoice('join')}
              />
            </View>

            {choice === 'create' ? (
              <>
                <FormSection key="create">
                  <TextRow
                    label={t('onboarding.namePlaceholder')}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    autoFocus
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={create}
                  />
                </FormSection>
                <TintButton
                  inline
                  tint={FAMILY[1]}
                  colors={FAMILY}
                  icon={busy === 'create' ? <ActivityIndicator color="#fff" /> : undefined}
                  title={t('onboarding.createBtn')}
                  onPress={() => void create()}
                  disabled={busy !== null}
                />
              </>
            ) : choice === 'join' ? (
              <>
                {viaLink ? (
                  <Txt variant="faint" style={{ textAlign: 'center' }}>
                    {t('onboarding.invitedHint')}
                  </Txt>
                ) : null}
                <FormSection key="join">
                  <TextRow
                    label={t('onboarding.codePlaceholder')}
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoFocus={!viaLink}
                    maxLength={8}
                    returnKeyType="done"
                    onSubmitEditing={join}
                  />
                </FormSection>
                <TintButton
                  inline
                  tint={FAMILY[1]}
                  colors={FAMILY}
                  icon={busy === 'join' ? <ActivityIndicator color="#fff" /> : undefined}
                  title={t('onboarding.joinBtn')}
                  onPress={() => void join()}
                  disabled={busy !== null}
                />
              </>
            ) : null}

            <QuietLink label={t('settings.signOut')} onPress={signOut} />
          </View>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.md, borderRadius: 20, borderWidth: 1.5 },
  choiceIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  seats: { flexDirection: 'row', gap: sp.md },
  seat: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  seatEmpty: { borderWidth: 1.5, borderStyle: 'dashed' },
  ticket: { alignItems: 'center', gap: 4, paddingVertical: sp.md, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed' },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
