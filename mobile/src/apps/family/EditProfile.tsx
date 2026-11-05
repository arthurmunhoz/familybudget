// Edit-my-info sheet. Only the signed-in user can open this (for their own
// member_profiles row). Handles the avatar (pick → resize → upload to the
// documents bucket), then the fields as grouped rows (components/form) —
// About you / Health / Sizes / Anything else — and upserts the row.
//
// 2026-11 redesign: this was a tall stack of labelled boxes with eight
// accent-filled blood-type chips and permanently visible unit pills. Now:
// compact rows, a picker for blood type, and the unit as a small "lb ⌄" chip.
import { useState } from 'react'
import { Alert, Modal, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import { Camera, X } from 'lucide-react-native'

import { supabase } from '@/lib/supabase'
import { getSignedUrl } from '@/lib/signedUrls'
import { formatPhone, formatDay } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useSheetLift } from '@/hooks/useSheetLift'
import { useTheme, sp, fonts } from '@/theme/theme'
import { Btn, Txt } from '@/components/ui'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import {
  DateRow,
  FormRow,
  FormSection,
  NoteRow,
  NumberBox,
  SelectRow,
  TextRow,
  UnitButton,
} from '@/components/form'
import type { MemberProfile, Profile } from '@/lib/types'
import { BLOOD_TYPES, initial as initialOf } from './familyShared'
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

// ── Measured-field rows (hoisted to module scope so their TextInputs keep
// focus across parent re-renders). Each seeds from the stored "value + unit"
// string, and pushes a freshly-composed string up on every change. ──────────

function HeightRow({
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
  const [unit, setUnit] = useState<HeightUnit>(() => parseHeight(initial)?.unit ?? (metric ? 'cm' : 'ftin'))
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
    let na: string
    let nb: string
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
    <FormRow label={label}>
      {unit === 'cm' ? (
        <NumberBox value={a} onChangeText={changeA} width={64} />
      ) : (
        <>
          <NumberBox value={a} onChangeText={changeA} width={40} suffix="ft" />
          <NumberBox value={b} onChangeText={changeB} width={40} suffix="in" />
        </>
      )}
      <UnitButton
        title={t('family.unit')}
        value={unit}
        onChange={toggle}
        options={[
          { value: 'ftin', label: 'ft·in' },
          { value: 'cm', label: 'cm' },
        ]}
      />
    </FormRow>
  )
}

function WeightRow({
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
  const [unit, setUnit] = useState<WeightUnit>(() => parseWeight(initial)?.unit ?? (metric ? 'kg' : 'lb'))
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
    <FormRow label={label}>
      <NumberBox value={v} onChangeText={changeV} width={64} />
      <UnitButton
        title={t('family.unit')}
        value={unit}
        onChange={toggle}
        options={[
          { value: 'lb', label: 'lb' },
          { value: 'kg', label: 'kg' },
        ]}
      />
    </FormRow>
  )
}

type ShoeKey = `${ShoeSystem}-${ShoeGender}`

function ShoeRow({
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
  // System and fit used to be two pill groups crammed into one row; they're
  // one choice now ("US · Men's"), picked from a list.
  function pick(key: ShoeKey) {
    const [s, g] = key.split('-') as [ShoeSystem, ShoeGender]
    if (s === system && g === gender) return
    const n = parseFloat(v)
    const conv = isFinite(n) && s !== system ? shoeConvert(n, g, system, s) : null
    const nv = conv != null ? String(conv) : v
    setSystem(s)
    setGender(g)
    setV(nv)
    onChange(composeShoe(s, g, nv))
  }
  const men = t('family.shoeMenFull')
  const women = t('family.shoeWomenFull')
  const options = (['US', 'EU', 'UK'] as ShoeSystem[]).flatMap((s) => [
    { value: `${s}-M` as ShoeKey, label: `${s} · ${men}` },
    { value: `${s}-W` as ShoeKey, label: `${s} · ${women}` },
  ])

  return (
    <FormRow label={label}>
      <NumberBox value={v} onChangeText={changeV} width={52} />
      <UnitButton
        title={t('family.unit')}
        value={`${system}-${gender}` as ShoeKey}
        onChange={pick}
        options={options}
      />
    </FormRow>
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
  const bottomGap = useBottomGap(sp.lg)
  // Default unit for empty fields: imperial for English, metric otherwise.
  const metric = lang !== 'en'

  const [form, setForm] = useState<Form>(() => emptyForm(mine))
  // display_name lives on allowed_users, not member_profiles — members can't
  // write that table, so it's saved through the set_display_name RPC (057).
  const [displayName, setDisplayName] = useState(profile.display_name)
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialPhoto)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

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

  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop} onLayout={onRootLayout}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.sheet, maxHeight: room * 0.94, marginBottom: lift },
          ]}
        >
          {/* header: Cancel-less — the × closes, Save is docked at the bottom */}
          <View style={styles.sheetHead}>
            <Txt variant="h2">{t('family.editTitle')}</Txt>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          <KeyboardScroll
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Photo: tap it to change; one quiet text action to remove. */}
            <View style={{ alignItems: 'center', gap: sp.sm }}>
              <Pressable
                onPress={pickPhoto}
                disabled={uploadingPhoto}
                accessibilityRole="button"
                accessibilityLabel={photoPreview ? t('family.changePhoto') : t('family.addPhoto')}
              >
                <View
                  style={{
                    width: 92,
                    height: 92,
                    borderRadius: 46,
                    backgroundColor: c.accentSoft,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: uploadingPhoto ? 0.5 : 1,
                  }}
                >
                  {photoPreview ? (
                    <Image source={{ uri: photoPreview }} style={{ width: 92, height: 92 }} contentFit="cover" />
                  ) : (
                    <Txt style={{ fontFamily: fonts.display, fontSize: 36, color: c.accent }}>
                      {initialOf(displayName || profile.display_name)}
                    </Txt>
                  )}
                </View>
                <View style={[styles.fab, { backgroundColor: c.text, borderColor: c.sheet }]}>
                  <Camera size={14} color={c.sheet} />
                </View>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: sp.lg }}>
                <Pressable onPress={pickPhoto} hitSlop={8} disabled={uploadingPhoto}>
                  <Txt style={{ color: c.accent, fontFamily: fonts.semibold, fontSize: 14 }}>
                    {photoPreview ? t('family.changePhoto') : t('family.addPhoto')}
                  </Txt>
                </Pressable>
                {photoPreview ? (
                  <Pressable onPress={removePhoto} hitSlop={8}>
                    <Txt style={{ color: c.textMuted, fontFamily: fonts.semibold, fontSize: 14 }}>
                      {t('family.removePhoto')}
                    </Txt>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <FormSection title={t('family.section.about')}>
              <TextRow
                label={t('family.myName')}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={40}
                placeholder={t('family.myNameHint')}
              />
              <DateRow
                label={t('family.birthday')}
                value={form.birthday}
                display={form.birthday ? formatDay(form.birthday) : ''}
                onChange={(v) => set('birthday', v)}
                maximumDate={new Date()}
                wheels
              />
              <TextRow
                label={t('family.phone')}
                value={form.phone}
                onChangeText={(v) => set('phone', v)}
                onBlur={() => set('phone', formatPhone(form.phone))}
                keyboardType="phone-pad"
              />
            </FormSection>

            <FormSection title={t('family.section.health')}>
              <SelectRow
                label={t('family.bloodType')}
                value={form.blood_type}
                options={BLOOD_TYPES.map((b) => ({ value: b, label: b }))}
                onChange={(v) => set('blood_type', v)}
                allowNone
              />
              <NoteRow
                label={t('family.allergies')}
                value={form.allergies}
                onChangeText={(v) => set('allergies', v)}
              />
            </FormSection>

            <FormSection title={t('family.section.sizes')}>
              <HeightRow label={t('family.height')} initial={form.height} metric={metric} onChange={(v) => set('height', v)} />
              <WeightRow label={t('family.weight')} initial={form.weight} metric={metric} onChange={(v) => set('weight', v)} />
              <ShoeRow label={t('family.shoeSize')} initial={form.shoe_size} metric={metric} onChange={(v) => set('shoe_size', v)} />
              <TextRow
                label={t('family.pantsSize')}
                value={form.pants_size}
                onChangeText={(v) => set('pants_size', v)}
                autoCapitalize="characters"
              />
              <TextRow
                label={t('family.shirtSize')}
                value={form.shirt_size}
                onChangeText={(v) => set('shirt_size', v)}
                autoCapitalize="characters"
              />
            </FormSection>

            <FormSection title={t('family.section.notes')}>
              <NoteRow
                label={t('family.notes')}
                placeholder={t('family.notesPlaceholder')}
                value={form.notes}
                onChangeText={(v) => set('notes', v)}
              />
            </FormSection>
          </KeyboardScroll>

          {/* save — docked */}
          <View
            style={{
              paddingHorizontal: sp.lg,
              paddingTop: sp.sm,
              paddingBottom: clearOfBars ? sp.md : bottomGap,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            <Btn title={saving ? t('common.saving') : t('common.saveChanges')} onPress={save} loading={saving} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: sp.lg,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: sp.lg,
    paddingBottom: sp.md,
  },
  fab: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
