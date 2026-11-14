// Settings › Modo Casa (owner, 2026-11): a spare device at home (an old phone,
// a tablet, a screen) becomes the family's hub — the web app at
// one-roof-app.vercel.app. Here: what it is, the paired devices (unpair),
// "Pair a device" (type the code its screen shows — or point the phone's
// camera at its QR, which opens this with the code filled in) and the Money
// PIN the device asks for. Never says "tablet" — "dispositivo" (owner).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Modal, StyleSheet, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { ChevronRight, KeyRound, MonitorSmartphone, Plus, X } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import type { Gradient } from '@/components/home/palette'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useSheetLift } from '@/hooks/useSheetLift'
import { useAuth } from '@/lib/auth'
import {
  CASA_LOOK as CASA,
  CASA_URL,
  claimHomeDevice,
  fetchHomeDevices,
  fetchHomePlan,
  hasCasaPin,
  normalizeCode,
  revokeHomeDevice,
  setCasaPin,
  trialDaysLeft,
  type ClaimError,
  type HomeDevice,
  type HomePlan,
} from '@/lib/casa'
import type { TKey } from '@/lib/i18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const PIN_LOOK: Gradient = ['#22C58B', '#0F9D6C']

const CLAIM_ERROR: Record<ClaimError, TKey> = {
  invalid_code: 'casa.errCode',
  already_claimed: 'casa.errUsed',
  plus_required: 'casa.errPlus',
  device_limit: 'casa.errLimit',
  no_household: 'casa.errGeneric',
  generic: 'casa.errGeneric',
}

export function CasaSettings({ pairCode, onCount }: { pairCode?: string; onCount?: (n: number) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const [devices, setDevices] = useState<HomeDevice[]>([])
  const [plan, setPlan] = useState<HomePlan | null>(null)
  const [pin, setPin] = useState(false)
  const [pairing, setPairing] = useState<string | null>(null)
  const [pinOpen, setPinOpen] = useState(false)

  const load = useCallback(async () => {
    const [d, p, hp] = await Promise.all([fetchHomeDevices(), fetchHomePlan(), hasCasaPin().catch(() => false)])
    setDevices(d)
    setPlan(p)
    setPin(hp)
    onCount?.(d.length)
  }, [onCount])
  useEffect(() => {
    void load()
  }, [load, profile?.household_id])
  // Opened from the device's QR (oneroof://casa?code=…): straight to pairing.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!pairCode || handled.current === pairCode) return
    handled.current = pairCode
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deep link
    setPairing(normalizeCode(pairCode))
  }, [pairCode])

  const first = (email: string) => (profiles.find((p) => p.email === email)?.display_name ?? email).split(' ')[0]
  const days = trialDaysLeft(plan)
  const status = plan?.plus
    ? t('casa.plus')
    : days !== null
      ? t('casa.trial', { n: days })
      : plan && devices.length > 0
        ? t('casa.displayOnly')
        : t('casa.trialStart')

  function unpair(d: HomeDevice) {
    Alert.alert(t('casa.unpairTitle', { name: d.name }), t('casa.unpairBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('casa.unpair'),
        style: 'destructive',
        onPress: async () => {
          if (await revokeHomeDevice(d.id)) void load()
          else Alert.alert(t('casa.errGeneric'))
        },
      },
    ])
  }

  return (
    <View style={{ gap: sp.md }}>
      {devices.map((d, i) => (
        <View key={d.id} style={[s.row, { borderTopColor: c.border }, i === 0 ? s.first : null]}>
          <View style={[s.devIcon, { backgroundColor: c.surface }]}>
            <MonitorSmartphone size={18} color={c.textMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
              {d.name}
            </Txt>
            <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
              {t('casa.pairedBy', { name: first(d.paired_by) })}
            </Txt>
          </View>
          <Pressable
            onPress={() => unpair(d)}
            accessibilityRole="button"
            accessibilityLabel={t('casa.unpair')}
            hitSlop={8}
            style={({ pressed }) => [s.round, { backgroundColor: c.surface2, opacity: pressed ? 0.6 : 1 }]}
          >
            <X size={15} color={c.textMuted} />
          </Pressable>
        </View>
      ))}

      <Row icon={<Plus size={18} color="#fff" strokeWidth={2.5} />} colors={CASA} title={t('casa.pair')} sub={status} onPress={() => setPairing('')} first={devices.length === 0} />
      <Row
        icon={<KeyRound size={17} color="#fff" />}
        colors={PIN_LOOK}
        title={t('casa.pin')}
        sub={pin ? t('casa.pinSet') : t('casa.pinNone')}
        onPress={() => setPinOpen(true)}
      />

      {pairing !== null ? (
        <PairSheet
          initialCode={pairing}
          onClose={() => setPairing(null)}
          onPaired={() => {
            setPairing(null)
            void load()
          }}
        />
      ) : null}
      {pinOpen && profile?.household_id ? (
        <PinSheet
          household={profile.household_id}
          onClose={() => setPinOpen(false)}
          onSaved={() => {
            setPinOpen(false)
            setPin(true)
          }}
        />
      ) : null}
    </View>
  )
}

/** Settings' one row for Modo Casa: tile, "Modo Casa", how many devices are
 *  paired (or what it is), chevron → the Modo Casa screen. */
export function CasaEntryRow() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void fetchHomeDevices().then((d) => live && setN(d.length))
    return () => {
      live = false
    }
  }, [profile?.household_id])
  const sub = n ? (n === 1 ? t('casa.pairedOne') : t('casa.pairedMany', { n })) : t('casa.entrySub')
  return (
    <Pressable onPress={() => router.push('/casa-mode')} accessibilityRole="button" style={({ pressed }) => [s.row, s.first, { opacity: pressed ? 0.6 : 1 }]}>
      <GradientBox colors={CASA} radius={12} style={s.tile}>
        <MonitorSmartphone size={19} color="#fff" />
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold }}>{t('casa.title')}</Txt>
        <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={2}>
          {sub}
        </Txt>
      </View>
      <ChevronRight size={18} color={c.textFaint} />
    </Pressable>
  )
}

function Row({ icon, colors, title, sub, onPress, first = false }: { icon: ReactNode; colors: Gradient; title: string; sub: string; onPress: () => void; first?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.row, { borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }, first ? s.first : null]}>
      <GradientBox colors={colors} radius={12} style={s.tile}>
        {icon}
      </GradientBox>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontFamily: fonts.semibold }}>{title}</Txt>
        <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={2}>
          {sub}
        </Txt>
      </View>
      <ChevronRight size={18} color={c.textFaint} />
    </Pressable>
  )
}

/** Bottom sheet chrome shared by the two sheets: tile + title + hint, ✕. */
function Sheet({ colors, icon, title, hint, onClose, children }: { colors: Gradient; icon: ReactNode; title: string; hint: string; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View
          style={{
            maxHeight: room * 0.9,
            marginBottom: lift,
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: sp.lg,
            paddingHorizontal: sp.lg,
            paddingBottom: clearOfBars ? sp.lg : bottomGap,
            gap: sp.md,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: sp.md }}>
            <GradientBox colors={colors} radius={16} style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
              {icon}
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text }}>{title}</Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 15, lineHeight: 20, color: c.textFaint }}>{hint}</Txt>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')} style={[s.round, { backgroundColor: c.surface }]}>
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  )
}

function PairSheet({ initialCode, onClose, onPaired }: { initialCode: string; onClose: () => void; onPaired: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<TKey | null>(null)
  const ready = normalizeCode(code).length === 6 && !busy

  async function pair() {
    if (!ready) return
    setBusy(true)
    setErr(null)
    const r = await claimHomeDevice(code, name || t('casa.defaultName'))
    setBusy(false)
    if (r.ok) {
      onPaired()
      return
    }
    if (r.error === 'plus_required') {
      Alert.alert(t('casa.errPlusTitle'), t('casa.errPlus'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('households.seePlus'), onPress: () => router.push('/paywall') },
      ])
      return
    }
    setErr(CLAIM_ERROR[r.error])
  }

  const shown = normalizeCode(code)
  return (
    <Sheet colors={CASA} icon={<MonitorSmartphone size={24} color="#fff" />} title={t('casa.pairTitle')} hint={t('casa.pairHint', { url: CASA_URL })} onClose={onClose}>
      <View style={[s.capsule, { backgroundColor: c.surface, borderColor: err ? c.expense : c.border }]}>
        <TextInput
          // Plain value (no inserted space): formatting the text while typing
          // made the cursor jump and scrambled the letters. Spacing is visual.
          value={shown}
          onChangeText={(v) => {
            setCode(normalizeCode(v))
            setErr(null)
          }}
          placeholder="K7P4QX"
          placeholderTextColor={c.textFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          autoFocus={!initialCode}
          maxLength={6}
          style={{ flex: 1, fontSize: 26, letterSpacing: 8, fontFamily: fonts.semibold, color: c.text, textAlign: 'center', paddingVertical: 0 }}
        />
      </View>
      <View style={[s.capsule, { backgroundColor: c.surface, borderColor: c.border, height: 50 }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('casa.namePlaceholder')}
          placeholderTextColor={c.textFaint}
          autoFocus={!!initialCode}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={() => void pair()}
          style={{ flex: 1, fontSize: 16, fontFamily: fonts.body, color: c.text, paddingVertical: 0 }}
        />
      </View>
      {err ? <Txt style={{ color: c.expense, fontSize: 14 }}>{t(err)}</Txt> : null}
      <TintButton
        tint={CASA[1]}
        colors={CASA}
        inline
        title={t('casa.pairBtn')}
        icon={busy ? <ActivityIndicator color="#fff" /> : null}
        onPress={() => void pair()}
        disabled={!ready}
      />
    </Sheet>
  )
}

function PinSheet({ household, onClose, onSaved }: { household: string; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const mismatch = a.length === 4 && b.length === 4 && a !== b
  const ready = a.length === 4 && a === b && !busy

  async function save() {
    if (!ready) return
    setBusy(true)
    const ok = await setCasaPin(household, a)
    setBusy(false)
    if (ok) onSaved()
    else Alert.alert(t('casa.errGeneric'))
  }

  const field = (v: string, set: (x: string) => void, placeholder: string, focus = false) => (
    <View style={[s.capsule, { backgroundColor: c.surface, borderColor: mismatch ? c.expense : c.border }]}>
      <TextInput
        value={v}
        onChangeText={(x) => set(x.replace(/\D/g, '').slice(0, 4))}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus={focus}
        maxLength={4}
        style={{ flex: 1, fontSize: 24, letterSpacing: 10, fontFamily: fonts.semibold, color: c.text, textAlign: 'center', paddingVertical: 0 }}
      />
    </View>
  )

  return (
    <Sheet colors={PIN_LOOK} icon={<KeyRound size={22} color="#fff" />} title={t('casa.pinTitle')} hint={t('casa.pinHint')} onClose={onClose}>
      {field(a, setA, t('casa.pinNew'), true)}
      {field(b, setB, t('casa.pinAgain'))}
      {mismatch ? <Txt style={{ color: c.expense, fontSize: 14 }}>{t('casa.pinMismatch')}</Txt> : null}
      <TintButton tint={PIN_LOOK[1]} colors={PIN_LOOK} inline title={t('casa.pinSave')} icon={busy ? <ActivityIndicator color="#fff" /> : null} onPress={() => void save()} disabled={!ready} />
    </Sheet>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md, borderTopWidth: StyleSheet.hairlineWidth },
  first: { paddingTop: 0, borderTopWidth: 0 },
  tile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  devIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  round: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  capsule: { flexDirection: 'row', alignItems: 'center', height: 60, paddingHorizontal: sp.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
})
