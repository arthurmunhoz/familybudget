// Edit-my-info sheet. Only the signed-in user can open this (for their own
// member_profiles row). Handles the avatar (pick → resize → upload to the
// documents bucket), birthday (native date picker), blood type (chips), and the
// remaining text fields, then upserts the row.
import { type ReactNode, useMemo, useState } from 'react'
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Camera, User, X } from 'lucide-react-native'

import { supabase } from '@/lib/supabase'
import { getSignedUrl } from '@/lib/signedUrls'
import { formatPhone, formatDay } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp, radius, fonts } from '@/theme/theme'
import { Btn, Field, Txt } from '@/components/ui'
import type { MemberProfile, Profile } from '@/lib/types'
import { BLOOD_TYPES, EDIT_FIELDS } from './familyShared'
import {
  cmToFtIn,
  composeHeight,
  composeShoe,
  composeWeight,
  ftInToCm,
  parseHeight,
  parseShoe,
  parseWeight,
  shoeConvert,
  weightConvert,
  type HeightUnit,
  type ShoeGender,
  type ShoeSystem,
  type WeightUnit,
} from './units'

type Form = {
  avatar_path: string
  birthday: string
  blood_type: string
  phone: string
  height: string
  weight: string
  shoe_size: string
  pants_size: string
  shirt_size: string
  allergies: string
  notes: string
}

/** Random-ish file id for the content-addressed avatar path (no crypto dep). */
function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyForm(p?: MemberProfile): Form {
  return {
    avatar_path: p?.avatar_path ?? '',
    birthday: p?.birthday ?? '',
    blood_type: p?.blood_type ?? '',
    phone: p?.phone ?? '',
    height: p?.height ?? '',
    weight: p?.weight ?? '',
    shoe_size: p?.shoe_size ?? '',
    pants_size: p?.pants_size ?? '',
    shirt_size: p?.shirt_size ?? '',
    allergies: p?.allergies ?? '',
    notes: p?.notes ?? '',
  }
}

// ── Measured-field editors (hoisted to module scope so their TextInputs keep
// focus across parent re-renders). Each seeds from the stored "value + unit"
// string, and pushes a freshly-composed string up on every change. ────────────
function UnitPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        borderRadius: radius.sm,
        overflow: 'hidden',
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: on ? c.accent : 'transparent',
              borderLeftWidth: i ? StyleSheet.hairlineWidth : 0,
              borderLeftColor: c.border,
            }}
          >
            <Txt style={{ color: on ? '#fff' : c.textMuted, fontWeight: '600', fontSize: 13 }}>
              {o.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

function NumInput({
  value,
  onChangeText,
  width = 72,
}: {
  value: string
  onChangeText: (v: string) => void
  width?: number
}) {
  const { c } = useTheme()
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      keyboardType="decimal-pad"
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        borderRadius: radius.md,
        paddingHorizontal: sp.md,
        paddingVertical: 12,
        fontSize: 16,
        color: c.text,
        width,
        backgroundColor: c.card,
        fontFamily: fonts.body,
      }}
    />
  )
}

function MeasureRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>{children}</View>
    </View>
  )
}

function HeightField({
  label,
  initial,
  metric,
  onChange,
}: {
  label: string
  initial: string
  metric: boolean
  onChange: (v: string) => void
}) {
  const [unit, setUnit] = useState<HeightUnit>(
    () => parseHeight(initial)?.unit ?? (metric ? 'cm' : 'ftin'),
  )
  const [a, setA] = useState(() => {
    const p = parseHeight(initial)
    if (!p) return ''
    return p.unit === 'cm' ? String(Math.round(p.cm)) : String(cmToFtIn(p.cm).ft)
  })
  const [b, setB] = useState(() => {
    const p = parseHeight(initial)
    return !p || p.unit === 'cm' ? '' : String(cmToFtIn(p.cm).inch)
  })

  function changeA(v: string) {
    setA(v)
    onChange(composeHeight(unit, v, b))
  }
  function changeB(v: string) {
    setB(v)
    onChange(composeHeight(unit, a, v))
  }
  function toggle(u: HeightUnit) {
    if (u === unit) return
    let na = a
    let nb = b
    if (u === 'cm') {
      na = a || b ? String(Math.round(ftInToCm(parseFloat(a) || 0, parseFloat(b) || 0))) : ''
      nb = ''
    } else {
      const cm = parseFloat(a)
      if (isFinite(cm)) {
        const r = cmToFtIn(cm)
        na = String(r.ft)
        nb = String(r.inch)
      } else {
        na = ''
        nb = ''
      }
    }
    setUnit(u)
    setA(na)
    setB(nb)
    onChange(composeHeight(u, na, nb))
  }

  return (
    <MeasureRow label={label}>
      {unit === 'cm' ? (
        <NumInput value={a} onChangeText={changeA} width={84} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <NumInput value={a} onChangeText={changeA} width={52} />
          <Txt variant="muted">ft</Txt>
          <NumInput value={b} onChangeText={changeB} width={52} />
          <Txt variant="muted">in</Txt>
        </View>
      )}
      <View style={{ flex: 1 }} />
      <UnitPills
        value={unit}
        onChange={toggle}
        options={[
          { value: 'ftin', label: 'ft·in' },
          { value: 'cm', label: 'cm' },
        ]}
      />
    </MeasureRow>
  )
}

function WeightField({
  label,
  initial,
  metric,
  onChange,
}: {
  label: string
  initial: string
  metric: boolean
  onChange: (v: string) => void
}) {
  const [unit, setUnit] = useState<WeightUnit>(
    () => parseWeight(initial)?.unit ?? (metric ? 'kg' : 'lb'),
  )
  const [v, setV] = useState(() => (parseWeight(initial) ? String(parseFloat(initial)) : ''))

  function changeV(next: string) {
    setV(next)
    onChange(composeWeight(unit, next))
  }
  function toggle(u: WeightUnit) {
    if (u === unit) return
    const n = parseFloat(v)
    const nv = isFinite(n) ? String(weightConvert(n, unit, u)) : v
    setUnit(u)
    setV(nv)
    onChange(composeWeight(u, nv))
  }

  return (
    <MeasureRow label={label}>
      <NumInput value={v} onChangeText={changeV} />
      <View style={{ flex: 1 }} />
      <UnitPills
        value={unit}
        onChange={toggle}
        options={[
          { value: 'lb', label: 'lb' },
          { value: 'kg', label: 'kg' },
        ]}
      />
    </MeasureRow>
  )
}

function ShoeField({
  label,
  initial,
  metric,
  onChange,
}: {
  label: string
  initial: string
  metric: boolean
  onChange: (v: string) => void
}) {
  const { t } = useI18n()
  const p0 = parseShoe(initial)
  const [system, setSystem] = useState<ShoeSystem>(p0?.system ?? (metric ? 'EU' : 'US'))
  const [gender, setGender] = useState<ShoeGender>(p0?.gender ?? 'M')
  const [v, setV] = useState(() => (p0 ? String(p0.value) : ''))

  function changeV(next: string) {
    setV(next)
    onChange(composeShoe(system, gender, next))
  }
  function toggleSystem(s: ShoeSystem) {
    if (s === system) return
    const n = parseFloat(v)
    const conv = isFinite(n) ? shoeConvert(n, gender, system, s) : null
    const nv = conv != null ? String(conv) : v
    setSystem(s)
    setV(nv)
    onChange(composeShoe(s, gender, nv))
  }
  function toggleGender(g: ShoeGender) {
    if (g === gender) return
    setGender(g)
    onChange(composeShoe(system, g, v))
  }

  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label">{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
        <NumInput value={v} onChangeText={changeV} />
        <View style={{ flex: 1 }} />
        <UnitPills
          value={system}
          onChange={toggleSystem}
          options={[
            { value: 'US', label: 'US' },
            { value: 'EU', label: 'EU' },
            { value: 'UK', label: 'UK' },
          ]}
        />
      </View>
      <UnitPills
        value={gender}
        onChange={toggleGender}
        options={[
          { value: 'M', label: t('family.shoeMen') },
          { value: 'W', label: t('family.shoeWomen') },
        ]}
      />
    </View>
  )
}

export function EditProfile({
  profile,
  mine,
  initialPhoto,
  onClose,
  onSaved,
}: {
  profile: Profile
  mine?: MemberProfile
  initialPhoto: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t, lang } = useI18n()
  const { c } = useTheme()
  // Default unit for empty fields: imperial for English, metric otherwise.
  const metric = lang !== 'en'

  const [form, setForm] = useState<Form>(() => emptyForm(mine))
  // display_name lives on allowed_users, not member_profiles — members can't
  // write that table, so it's saved through the set_display_name RPC (057).
  const [displayName, setDisplayName] = useState(profile.display_name)
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialPhoto)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDate, setShowDate] = useState(false)

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  // birthday "YYYY-MM-DD" → local Date for the picker (defaults to ~30y ago).
  const birthdayDate = useMemo(() => {
    if (form.birthday) {
      const [y, m, d] = form.birthday.split('-').map(Number)
      if (y && m && d) return new Date(y, m - 1, d)
    }
    const now = new Date()
    return new Date(now.getFullYear() - 30, now.getMonth(), now.getDate())
  }, [form.birthday])

  async function pickPhoto() {
    if (uploadingPhoto) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('family.photoFailed'))
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    })
    if (res.canceled || !res.assets?.[0]) return

    setUploadingPhoto(true)
    try {
      // Downscale to a small square-ish avatar to keep storage light.
      const manipulated = await ImageManipulator.manipulate(res.assets[0].uri)
        .resize({ width: 512 })
        .renderAsync()
      const saved = await manipulated.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })

      // Read the resized JPEG's bytes and upload directly (no base64 round-trip).
      const buffer = await new File(saved.uri).arrayBuffer()
      const path = `${profile.household_id}/avatars/${randomId()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, buffer, { contentType: 'image/jpeg', cacheControl: '604800' })
      if (error) throw error

      set('avatar_path', path)
      const url = await getSignedUrl(path)
      setPhotoPreview(url ?? saved.uri)
    } catch {
      Alert.alert(t('family.photoFailed'))
    }
    setUploadingPhoto(false)
  }

  function removePhoto() {
    set('avatar_path', '')
    setPhotoPreview(null)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const clean = (v: string) => (v.trim() ? v.trim() : null)
    const oldAvatar = mine?.avatar_path ?? null
    const newAvatar = clean(form.avatar_path)

    // Name first: if it fails, bail before touching anything else rather than
    // half-saving.
    const dn = displayName.trim()
    if (!dn) {
      setSaving(false)
      Alert.alert(t('onboarding.errYourNameRequired'))
      return
    }
    if (dn !== profile.display_name) {
      const { error: nameErr } = await supabase.rpc('set_display_name', { p_name: dn })
      if (nameErr) {
        setSaving(false)
        Alert.alert(t('family.saveFailed'))
        return
      }
    }

    const { error } = await supabase.from('member_profiles').upsert(
      {
        email: profile.email,
        avatar_path: newAvatar,
        birthday: clean(form.birthday),
        phone: clean(form.phone),
        blood_type: clean(form.blood_type),
        height: clean(form.height),
        weight: clean(form.weight),
        shoe_size: clean(form.shoe_size),
        pants_size: clean(form.pants_size),
        shirt_size: clean(form.shirt_size),
        allergies: clean(form.allergies),
        notes: clean(form.notes),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' },
    )
    setSaving(false)
    if (error) {
      Alert.alert(t('family.saveFailed'))
      return
    }
    // Remove the previous photo file if it was replaced or cleared.
    if (oldAvatar && oldAvatar !== newAvatar) {
      await supabase.storage.from('documents').remove([oldAvatar])
    }
    onSaved()
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          {/* header */}
          <View style={styles.sheetHead}>
            <Txt variant="h2">{t('family.editTitle')}</Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={22} color={c.textMuted} />
            </Pressable>
          </View>

          {/* avatar with edit / remove controls */}
          <View style={{ alignItems: 'center', paddingBottom: sp.lg }}>
            <View style={{ width: 96, height: 96 }}>
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: c.surface,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: uploadingPhoto ? 0.5 : 1,
                }}
              >
                {photoPreview ? (
                  <Image
                    source={{ uri: photoPreview }}
                    style={{ width: 96, height: 96 }}
                    contentFit="cover"
                  />
                ) : (
                  <User size={40} color={c.textFaint} />
                )}
              </View>
              {/* edit — bottom-right */}
              <Pressable
                onPress={pickPhoto}
                disabled={uploadingPhoto}
                accessibilityRole="button"
                accessibilityLabel={
                  form.avatar_path ? t('family.changePhoto') : t('family.addPhoto')
                }
                style={[
                  styles.fab,
                  { right: -2, bottom: -2, backgroundColor: c.accent, borderColor: c.card },
                ]}
              >
                <Camera size={16} color="#fff" />
              </Pressable>
              {/* remove — top-right */}
              {form.avatar_path ? (
                <Pressable
                  onPress={removePhoto}
                  accessibilityRole="button"
                  accessibilityLabel={t('family.removePhoto')}
                  style={[
                    styles.fabSmall,
                    { right: -2, top: -2, backgroundColor: c.expense, borderColor: c.card },
                  ]}
                >
                  <X size={14} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* scrollable fields */}
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.md, paddingBottom: sp.sm }}
            keyboardShouldPersistTaps="handled"
          >
            {/* your name (allowed_users.display_name — how the family sees you) */}
            <View style={{ gap: 6 }}>
              <Field
                label={t('family.myName')}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={40}
              />
              <Txt variant="faint">{t('family.myNameHint')}</Txt>
            </View>

            {/* birthday */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('family.birthday')}</Txt>
              <Pressable
                onPress={() => setShowDate(true)}
                style={{
                  backgroundColor: c.card,
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  paddingHorizontal: sp.md,
                  paddingVertical: 12,
                }}
              >
                <Txt style={{ color: form.birthday ? c.text : c.textFaint }}>
                  {form.birthday ? formatDay(form.birthday) : t('family.notSet')}
                </Txt>
              </Pressable>
              {form.birthday ? (
                <Pressable onPress={() => set('birthday', '')} hitSlop={6}>
                  <Txt variant="faint">{t('family.removePhoto')}</Txt>
                </Pressable>
              ) : null}
              {showDate ? (
                <DateTimePicker
                  value={birthdayDate}
                  mode="date"
                  maximumDate={new Date()}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    if (Platform.OS !== 'ios') setShowDate(false)
                    if (event.type === 'dismissed') return
                    if (date) {
                      const y = date.getFullYear()
                      const m = String(date.getMonth() + 1).padStart(2, '0')
                      const d = String(date.getDate()).padStart(2, '0')
                      set('birthday', `${y}-${m}-${d}`)
                    }
                  }}
                />
              ) : null}
              {Platform.OS === 'ios' && showDate ? (
                <Btn title={t('common.close')} variant="secondary" onPress={() => setShowDate(false)} />
              ) : null}
            </View>

            {/* blood type chips */}
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('family.bloodType')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
                <Chip
                  label={t('family.notSet')}
                  active={!form.blood_type}
                  onPress={() => set('blood_type', '')}
                />
                {BLOOD_TYPES.map((b) => (
                  <Chip
                    key={b}
                    label={b}
                    active={form.blood_type === b}
                    onPress={() => set('blood_type', b)}
                  />
                ))}
              </View>
            </View>

            {/* remaining fields — height/weight/shoe get a unit picker */}
            {EDIT_FIELDS.map(([key, labelKey]) => {
              if (key === 'height')
                return (
                  <HeightField
                    key={key}
                    label={t(labelKey)}
                    initial={form.height}
                    metric={metric}
                    onChange={(v) => set('height', v)}
                  />
                )
              if (key === 'weight')
                return (
                  <WeightField
                    key={key}
                    label={t(labelKey)}
                    initial={form.weight}
                    metric={metric}
                    onChange={(v) => set('weight', v)}
                  />
                )
              if (key === 'shoe_size')
                return (
                  <ShoeField
                    key={key}
                    label={t(labelKey)}
                    initial={form.shoe_size}
                    metric={metric}
                    onChange={(v) => set('shoe_size', v)}
                  />
                )
              return (
                <Field
                  key={key}
                  label={t(labelKey)}
                  value={form[key as keyof Form]}
                  onChangeText={(v) => set(key as keyof Form, v)}
                  onBlur={
                    key === 'phone' ? () => set('phone', formatPhone(form.phone)) : undefined
                  }
                  keyboardType={key === 'phone' ? 'phone-pad' : 'default'}
                  multiline={key === 'notes' || key === 'allergies'}
                />
              )
            })}
          </ScrollView>

          {/* save */}
          <View style={{ paddingTop: sp.md }}>
            <Btn
              title={saving ? t('common.saving') : t('common.saveChanges')}
              onPress={save}
              loading={saving}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: sp.md,
        paddingVertical: sp.sm,
        borderRadius: radius.pill,
        backgroundColor: active ? c.accent : c.surface,
      }}
    >
      <Txt style={{ color: active ? '#fff' : c.text, fontWeight: '600', fontSize: 14 }}>
        {label}
      </Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sp.lg,
    paddingTop: sp.lg,
    paddingBottom: sp.xl,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: sp.lg,
  },
  fab: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSmall: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
