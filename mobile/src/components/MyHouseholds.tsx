// Settings › "My families" (migration 099): every household this account
// belongs to, the active one checked. Tap another to switch — AuthProvider then
// re-reads the profile and refetches every mounted screen (lib/auth.tsx), so the
// Hub underneath, the widgets and Plus all follow. "Join another family" adds a
// membership by invite code; "Create a new family" needs a PAID Plus on the
// active family and an account stops at 3 families (migration 104); "Leave this family" leaves the ACTIVE one (an only
// owner hands it over first; someone alone in it deletes it, after a warning).
//
// The section hides itself until there is something to show: against a server
// without migration 099 `my_households` doesn't exist and the list is empty.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Check, Crown, House, KeyRound, LogOut, Plus, UserPlus, X } from 'lucide-react-native'
import { router } from 'expo-router'

// Rows flip `disabled` (active / switching) — the Android-safe wrapper.
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, type Gradient } from '@/components/home/palette'
import { TintButton } from '@/components/TintButton'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import {
  createHousehold,
  fetchMyHouseholds,
  householdError,
  joinHousehold,
  leaveHousehold,
  setActiveHousehold,
  type MyHousehold,
} from '@/lib/households'
import type { TKey } from '@/lib/i18n'
import type { Profile } from '@/lib/types'
import { fonts, sp, useTheme } from '@/theme/theme'

const FAMILY = APP_GRADIENT.family
const LEAVE: Gradient = ['#F0766A', '#D2483C']

const JOIN_ERROR: Record<string, TKey> = {
  invalidCode: 'households.errInvalidCode',
  alreadyMember: 'households.errAlreadyMember',
  full: 'households.errFull',
  tooMany: 'households.errTooMany',
  familyLimit: 'households.limitReached',
  plusRequired: 'households.plusBody',
  plusOwnerRequired: 'households.plusOwnerBody',
}

/** Mirrors the server's cap (migration 104 `max_households_per_account`). */
export const MAX_FAMILIES = 3

/** The bottom of Settings' Family card (`FamilySection`): your OTHER
 *  families (tap to switch), then Join another / Leave this one. Rendered
 *  inside that card — no card or label of its own. */
export function FamilySwitcher() {
  const { t } = useI18n()
  const { c } = useTheme()
  const { profile, profiles } = useAuth()
  const { data: list = [], revalidate } = useCachedQuery<MyHousehold[]>('settings:households', fetchMyHouseholds)
  const [switching, setSwitching] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [creating, setCreating] = useState(false)
  const { isPlus, isTrial } = usePlus()
  const [handOver, setHandOver] = useState<MyHousehold | null>(null)

  // The account row is the truth for which one is active (it moves first).
  const activeId = profile?.household_id ?? list.find((h) => h.is_active)?.household_id ?? null
  // Refetch when the active household changes under us (another device, a push tap).
  useEffect(() => {
    void revalidate().catch(() => {})
  }, [activeId, revalidate])

  const active = list.find((h) => h.household_id === activeId) ?? null
  const others = profiles.filter((p) => p.email !== profile?.email)

  async function switchTo(h: MyHousehold) {
    if (switching || h.household_id === activeId) return
    setSwitching(h.household_id)
    try {
      await setActiveHousehold(h.household_id)
      await revalidate()
    } catch {
      Alert.alert(t('households.switchError'))
    } finally {
      setSwitching(null)
    }
  }

  async function doLeave(h: MyHousehold, newOwner?: string) {
    try {
      await leaveHousehold(h.household_id, newOwner)
      setHandOver(null)
      await revalidate()
    } catch (e) {
      // The payer of a family's Plus can't hand it over (migration 104).
      Alert.alert(householdError(e) === 'payerOwner' ? t('households.payerOwner') : t('households.leaveError'))
    }
  }

  function leave() {
    if (!active) return
    if (others.length === 0) {
      Alert.alert(t('households.leaveTitle', { name: active.name }), t('households.leaveAloneBody', { name: active.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('households.leaveAloneBtn'), style: 'destructive', onPress: () => void doLeave(active) },
      ])
      return
    }
    if (active.role === 'owner' && !others.some((o) => o.role === 'owner')) {
      setHandOver(active)
      return
    }
    Alert.alert(t('households.leaveTitle', { name: active.name }), t('households.leaveBody', { name: active.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('households.leaveBtn'), style: 'destructive', onPress: () => void doLeave(active) },
    ])
  }

  // Creating ANOTHER family needs a PAID Plus on the active one — the server
  // refuses the signup trial (migration 104), so this copy has to match it —
// and only its OWNER may spend it (the new family rides on that Plus).
  function startCreate() {
    if (profile?.role !== 'owner') {
      Alert.alert(t('households.plusTitle'), t('households.plusOwnerBody'))
      return
    }
    if (isPlus && !isTrial) {
      setCreating(true)
      return
    }
    Alert.alert(t('households.plusTitle'), t(isTrial ? 'households.plusTrialBody' : 'households.plusBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('households.seePlus'), onPress: () => router.push('/paywall') },
    ])
  }

  const full = list.length >= MAX_FAMILIES
  const rest = list.filter((h) => h.household_id !== activeId)
  return (
    <>
      {rest.length ? (
        <View style={[s.othersHead, { borderTopColor: c.border }]}>
          <Txt style={[s.label, { color: c.textMuted }]}>{t('households.others')}</Txt>
        </View>
      ) : null}
      {rest.map((h, i) => (
        <HouseholdRow
          key={h.household_id}
          h={h}
          first={i === 0}
          active={false}
          busy={switching === h.household_id}
          onPress={() => void switchTo(h)}
        />
      ))}
      {/* "from here down you can add another family" */}
      <View style={s.divider} accessibilityRole="header">
        <View style={[s.rule, { backgroundColor: c.border }]} />
        <Txt style={[s.label, { color: c.textMuted }]}>{t('households.addSection')}</Txt>
        <View style={[s.rule, { backgroundColor: c.border }]} />
      </View>
      {full ? (
        <Txt variant="faint" style={s.fullNote}>
          {t('households.limitReached')}
        </Txt>
      ) : (
        <>
          <TextAction icon={<UserPlus size={16} color={c.accent} />} label={t('households.join')} color={c.accent} onPress={() => setJoining(true)} />
          <TextAction icon={<Plus size={16} color={c.accent} />} label={t('households.create')} color={c.accent} onPress={startCreate} />
        </>
      )}
      {list.length > 1 && active ? (
        <TextAction icon={<LogOut size={15} color={c.expense} />} label={t('households.leave')} color={c.expense} small onPress={leave} />
      ) : null}
      <View style={{ height: sp.sm }} />

      {joining ? (
        <JoinHouseholdSheet
          onClose={() => setJoining(false)}
          onJoined={() => {
            setJoining(false)
            void revalidate()
          }}
        />
      ) : null}
      {creating ? (
        <CreateHouseholdSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void revalidate()
          }}
        />
      ) : null}
      {handOver ? (
        <HandOverSheet
          household={handOver}
          members={others}
          onClose={() => setHandOver(null)}
          onConfirm={(email) => doLeave(handOver, email)}
        />
      ) : null}
    </>
  )
}

/** One family: its name, members
 *  and role; the active one carries a check that springs in when it becomes so. */
function HouseholdRow({
  h,
  first,
  active,
  busy,
  onPress,
}: {
  h: MyHousehold
  first: boolean
  active: boolean
  busy: boolean
  onPress: () => void
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const [pop] = useState(() => new Animated.Value(active ? 1 : 0))
  useEffect(() => {
    Animated.spring(pop, { toValue: active ? 1 : 0, useNativeDriver: true, friction: 5, tension: 140 }).start()
  }, [active, pop])
  const meta = [t('households.members', { count: h.member_count }), h.role === 'owner' ? t('households.owner') : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <Pressable
      onPress={onPress}
      disabled={active || busy}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? `${h.name}, ${t('households.active')}` : t('households.switchTo', { name: h.name })}
      style={({ pressed }) => [
        s.row,
        { borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 17, lineHeight: 22, color: c.text, flexShrink: 1 }}>
            {h.name}
          </Txt>
          {h.role === 'owner' ? <Crown size={13} color={FAMILY[1]} /> : null}
        </View>
        <Txt variant="faint" numberOfLines={1} style={{ fontSize: 12.5 }}>
          {meta}
        </Txt>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={FAMILY[1]} />
      ) : (
        <View style={[s.radio, { borderColor: active ? 'transparent' : c.border }]}>
          <Animated.View style={{ transform: [{ scale: pop }], opacity: pop }}>
            <GradientBox colors={FAMILY} radius={13} style={s.check}>
              <Check size={15} color="#fff" strokeWidth={3} />
            </GradientBox>
          </Animated.View>
        </View>
      )}
    </Pressable>
  )
}

/** A centred text button (icon + label), no tile — the actions under the
 *  "Add a family" divider. */
function TextAction({
  icon,
  label,
  color,
  small = false,
  onPress,
}: {
  icon: ReactNode
  label: string
  color: string
  small?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [s.textAction, { opacity: pressed ? 0.55 : 1 }]}
    >
      {icon}
      <Txt style={{ fontSize: small ? 14 : 15.5, fontFamily: fonts.semibold, color }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** Shared sheet chrome: dimmed backdrop, the 2026-11 head (gradient tile, big
 *  title with its purpose faded under it, round ✕), lifted above the keyboard. */
function Sheet({
  icon,
  colors,
  title,
  hint,
  onClose,
  onShow,
  children,
  footer,
}: {
  icon: ReactNode
  colors: Gradient
  title: string
  hint: string
  onClose: () => void
  onShow?: () => void
  children: ReactNode
  footer: ReactNode
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} onShow={onShow}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View
          style={{
            maxHeight: room * 0.88,
            marginBottom: lift,
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: sp.lg,
          }}
        >
          <View style={s.head}>
            <GradientBox colors={colors} radius={16} style={s.headTile}>
              {icon}
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text }}>{title}</Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 15, lineHeight: 20, color: c.textFaint }}>{hint}</Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[s.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, paddingTop: sp.md, gap: sp.md }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: clearOfBars ? sp.lg : bottomGap }}>
            {footer}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function JoinHouseholdSheet({ onClose, onJoined }: { onClose: () => void; onJoined: () => void }) {
  const { t } = useI18n()
  const { c } = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<TKey | null>(null)
  const [shake] = useState(() => new Animated.Value(0))

  async function submit() {
    const cd = code.trim()
    if (cd.length < 6 || busy) return
    setBusy(true)
    setErr(null)
    try {
      await joinHousehold(cd)
      onJoined()
    } catch (e) {
      setErr(JOIN_ERROR[householdError(e)] ?? 'households.errGeneric')
      shake.setValue(0)
      Animated.timing(shake, { toValue: 1, duration: 360, easing: Easing.linear, useNativeDriver: true }).start()
    } finally {
      setBusy(false)
    }
  }

  const dx = shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -8, 8, -5, 4, 0] })

  return (
    <Sheet
      icon={<UserPlus size={24} color="#fff" />}
      colors={FAMILY}
      title={t('households.joinTitle')}
      hint={t('households.joinHint')}
      onClose={onClose}
      // autoFocus alone misses on Android (the modal's window isn't up yet).
      onShow={() => inputRef.current?.focus()}
      footer={
        <TintButton
          tint={FAMILY[1]}
          colors={FAMILY}
          title={t('households.joinBtn')}
          icon={busy ? <ActivityIndicator size="small" color="#fff" /> : null}
          onPress={() => void submit()}
          disabled={busy || code.trim().length < 6}
        />
      }
    >
      <Animated.View style={[s.capsule, { backgroundColor: c.surface, borderColor: err ? c.expense : c.border, transform: [{ translateX: dx }] }]}>
        <KeyRound size={18} color={FAMILY[1]} />
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
            setErr(null)
          }}
          placeholder={t('households.codePlaceholder')}
          placeholderTextColor={c.textFaint}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={{ flex: 1, fontSize: 20, letterSpacing: 3, fontFamily: fonts.semibold, color: c.text, paddingVertical: 0 }}
        />
      </Animated.View>
      {err ? <Txt style={{ color: c.expense, fontSize: 14 }}>{t(err)}</Txt> : null}
    </Sheet>
  )
}

function CreateHouseholdSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const { c } = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<TKey | null>(null)

  async function submit() {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    setErr(null)
    try {
      await createHousehold(n)
      onCreated()
    } catch (e) {
      setErr(JOIN_ERROR[householdError(e)] ?? 'households.errGeneric')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      icon={<House size={24} color="#fff" />}
      colors={FAMILY}
      title={t('households.createTitle')}
      hint={t('households.createHint')}
      onClose={onClose}
      onShow={() => inputRef.current?.focus()}
      footer={
        <TintButton
          tint={FAMILY[1]}
          colors={FAMILY}
          title={t('households.createBtn')}
          icon={busy ? <ActivityIndicator size="small" color="#fff" /> : null}
          onPress={() => void submit()}
          disabled={busy || !name.trim()}
        />
      }
    >
      <View style={[s.capsule, { backgroundColor: c.surface, borderColor: err ? c.expense : c.border }]}>
        <House size={18} color={FAMILY[1]} />
        <TextInput
          ref={inputRef}
          value={name}
          onChangeText={(v) => {
            setName(v)
            setErr(null)
          }}
          placeholder={t('households.namePlaceholder')}
          placeholderTextColor={c.textFaint}
          autoFocus
          autoCapitalize="words"
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          style={{ flex: 1, fontSize: 18, fontFamily: fonts.semibold, color: c.text, paddingVertical: 0 }}
        />
      </View>
      {err ? <Txt style={{ color: c.expense, fontSize: 14 }}>{t(err)}</Txt> : null}
    </Sheet>
  )
}

/** The only owner leaving a family that still has members: pick who takes over. */
function HandOverSheet({
  household,
  members,
  onClose,
  onConfirm,
}: {
  household: MyHousehold
  members: Profile[]
  onClose: () => void
  onConfirm: (email: string) => Promise<void>
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const [pick, setPick] = useState<string | null>(members.length === 1 ? members[0].email : null)
  const [busy, setBusy] = useState(false)
  const picked = members.find((m) => m.email === pick) ?? null
  const first = (n: string) => n.split(/\s+/)[0]

  return (
    <Sheet
      icon={<Crown size={24} color="#fff" />}
      colors={FAMILY}
      title={t('households.handOverTitle', { name: household.name })}
      hint={t('households.handOverHint')}
      onClose={onClose}
      footer={
        <TintButton
          tint={LEAVE[1]}
          colors={LEAVE}
          title={picked ? t('households.handOverBtn', { name: first(picked.display_name) }) : t('households.handOverPick')}
          icon={busy ? <ActivityIndicator size="small" color="#fff" /> : <LogOut size={17} color="#fff" />}
          disabled={!picked || busy}
          onPress={() => {
            if (!picked) return
            setBusy(true)
            void onConfirm(picked.email).finally(() => setBusy(false))
          }}
        />
      }
    >
      <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {members.map((m, i) => {
          const on = m.email === pick
          return (
            <Pressable
              key={m.email}
              onPress={() => setPick(m.email)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [
                s.row,
                { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={[s.initials, { backgroundColor: FAMILY[0] + '2E' }]}>
                <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: FAMILY[1] }}>
                  {(m.display_name.trim()[0] ?? '?').toUpperCase()}
                </Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, color: c.text }}>
                  {m.display_name}
                </Txt>
                <Txt variant="faint" numberOfLines={1} style={{ fontSize: 12 }}>
                  {m.email}
                </Txt>
              </View>
              <View style={[s.radio, { borderColor: on ? 'transparent' : c.border }]}>
                {on ? (
                  <GradientBox colors={FAMILY} radius={13} style={s.check}>
                    <Check size={15} color="#fff" strokeWidth={3} />
                  </GradientBox>
                ) : null}
              </View>
            </Pressable>
          )
        })}
      </View>
    </Sheet>
  )
}

const s = StyleSheet.create({
  othersHead: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: sp.md, paddingTop: sp.md, paddingBottom: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 12 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingHorizontal: sp.md, paddingTop: sp.lg, paddingBottom: sp.xs },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  fullNote: { textAlign: 'center', fontSize: 13.5, paddingHorizontal: sp.lg, paddingVertical: 11 },
  textAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: sp.md },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg },
  headTile: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: sp.md,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  initials: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
