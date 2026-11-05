// The editable pet fields (name, species, breed, birthday, colors, weight,
// length, microchip, notes) + a Save button, for both the "Add pet" bottom
// sheet (PetForm) and the editable pet details screen (PetProfile). The photo
// + name live in a `usePetIdentity` controller the parent owns (PetProfile
// pins the photo above its scroll).
//
// Two layouts: inline (PetProfile — the parent supplies the scroll view and
// Save follows the fields) and `dock` (PetForm — this renders the
// KeyboardScroll itself, with `top` at its head, and docks Save under it).
//
// 2026-11 redesign (components/form): grouped rows instead of labelled boxes;
// species is a SelectRow, and weight/length are a number box + a small unit
// chip ("12 kg ⌄") like the family profile, instead of free-text fields.
import { useState, type ReactNode } from 'react'
import { Alert, StyleSheet, TextInput, View } from 'react-native'

import { FormRow, FormSection, NoteRow, NumberBox, SelectRow, TextRow, UnitButton } from '@/components/form'
import { KeyboardScroll } from '@/components/KeyboardScroll'
import { Btn } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet } from '@/lib/types'
import { useBottomGap } from '@/hooks/useBottomGap'
import { fonts, sp, useTheme } from '@/theme/theme'
import { DayRow } from '@/apps/calendar/calendarUi'
import { composeWeight, parseWeight, weightConvert, type WeightUnit } from '@/apps/family/units'
import type { PetIdentity } from './petIdentity'
import { SPECIES, speciesEmoji } from './petMeta'

type LengthUnit = 'cm' | 'in'
const CM_PER_IN = 2.54
const round1 = (n: number) => Math.round(n * 10) / 10

/** "40 cm" / "16 in" → value + unit; a bare number has no unit (null). */
function parseLength(raw: string): { value: number; unit: LengthUnit } | null {
  const n = parseFloat(raw)
  if (!isFinite(n)) return null
  if (/cm/i.test(raw)) return { value: n, unit: 'cm' }
  if (/in|"/i.test(raw)) return { value: n, unit: 'in' }
  return null
}
const composeLength = (unit: LengthUnit, v: string): string => {
  const n = parseFloat(v.replace(',', '.'))
  return isFinite(n) ? `${round1(n)} ${unit}` : ''
}

/** The number to seed a measure box with. A stored value with no unit ("12")
 *  still shows its number (under the default unit) rather than an empty box;
 *  nothing is rewritten unless the field is edited. */
const seedNumber = (raw: string): string => {
  const n = parseFloat(raw)
  return isFinite(n) ? String(n) : ''
}

// Measured rows — hoisted to module scope so their inputs keep focus across
// parent re-renders. Each seeds from the stored "value unit" string and pushes
// a freshly-composed one up on every change (same shape as EditProfile's).

function PetWeightRow({
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
  const [v, setV] = useState(() => seedNumber(initial))

  function changeV(next: string) {
    setV(next)
    onChange(composeWeight(unit, next))
  }
  function pick(u: WeightUnit) {
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
        onChange={pick}
        options={[
          { value: 'lb', label: 'lb' },
          { value: 'kg', label: 'kg' },
        ]}
      />
    </FormRow>
  )
}

function PetLengthRow({
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
  const [unit, setUnit] = useState<LengthUnit>(() => parseLength(initial)?.unit ?? (metric ? 'cm' : 'in'))
  const [v, setV] = useState(() => seedNumber(initial))

  function changeV(next: string) {
    setV(next)
    onChange(composeLength(unit, next))
  }
  function pick(u: LengthUnit) {
    if (u === unit) return
    const n = parseFloat(v)
    const nv = isFinite(n) ? String(round1(u === 'cm' ? n * CM_PER_IN : n / CM_PER_IN)) : v
    setUnit(u)
    setV(nv)
    onChange(composeLength(u, nv))
  }

  return (
    <FormRow label={label}>
      <NumberBox value={v} onChangeText={changeV} width={64} />
      <UnitButton
        title={t('family.unit')}
        value={unit}
        onChange={pick}
        options={[
          { value: 'in', label: 'in' },
          { value: 'cm', label: 'cm' },
        ]}
      />
    </FormRow>
  )
}

export function PetEditor({
  pet,
  identity,
  onSaved,
  top,
  dock,
}: {
  pet: Pet | null
  /** The photo + name, owned by the host (see `usePetIdentity`). */
  identity: PetIdentity
  /** Called after a successful save, with the saved pet's name for a toast. */
  onSaved: (name?: string) => void
  /** Rendered at the head of the scroll in `dock` mode (the sheet's photo). */
  top?: ReactNode
  /** Sheet layout: own KeyboardScroll + Save docked below it.
   *  `clearOfBars` comes from the host's useSheetLift. */
  dock?: { clearOfBars: boolean }
}) {
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { t, lang } = useI18n()
  // Default unit for empty measures: imperial for English, metric otherwise.
  const metric = lang !== 'en'
  const { name, setName, emoji, setEmoji, photoPath } = identity

  const [species, setSpecies] = useState(pet?.species ?? '')
  const [breed, setBreed] = useState(pet?.breed ?? '')
  const [birthday, setBirthday] = useState(pet?.birthday ?? '')
  const [color, setColor] = useState(pet?.color ?? '')
  const [colorSecondary, setColorSecondary] = useState(pet?.color_secondary ?? '')
  const [weight, setWeight] = useState(pet?.weight ?? '')
  const [length, setLength] = useState(pet?.length ?? '')
  const [microchip, setMicrochip] = useState(pet?.microchip ?? '')
  const [notes, setNotes] = useState(pet?.notes ?? '')
  const [saving, setSaving] = useState(false)

  function pickSpecies(id: string) {
    setSpecies(id)
    setEmoji(speciesEmoji(id)) // the icon isn't edited by hand any more — it follows the species
  }

  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    const clean = (v: string) => (v.trim() ? v.trim() : null)
    const fields = {
      name: name.trim(),
      emoji: emoji.trim() || '🐶',
      species: species || null,
      breed: clean(breed),
      birthday: birthday || null,
      color: clean(color),
      color_secondary: clean(colorSecondary),
      weight: clean(weight),
      length: clean(length),
      microchip: clean(microchip),
      notes: clean(notes),
      photo_path: photoPath || null,
    }
    const { error } = pet
      ? await supabase.from('pets').update(fields).eq('id', pet.id)
      : await supabase.from('pets').insert(fields)
    setSaving(false)
    if (error) {
      Alert.alert(t('pets.addPetFailed'))
      return
    }
    if (!pet) track('pet.created', { name: fields.name, species: fields.species })
    else track('pet.updated', { name: fields.name, species: fields.species })
    // Clean up a replaced/removed photo file.
    const oldPhoto = pet?.photo_path ?? null
    if (oldPhoto && oldPhoto !== (photoPath || null)) {
      await supabase.storage.from('documents').remove([oldPhoto])
    }
    onSaved(fields.name)
  }

  const fields = (
    <>
      {/* The name is the page's title, not a form field — it sits under the
          photo with no box around it, centred, in the display face. */}
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('pets.namePlaceholder')}
        placeholderTextColor={c.textFaint}
        style={{
          fontFamily: fonts.display,
          fontSize: 26,
          color: c.text,
          textAlign: 'center',
          paddingVertical: sp.xs,
        }}
      />

      <FormSection>
        {/* species — a picker instead of nine wrapping pills */}
        <SelectRow
          label={t('pets.species')}
          value={species}
          placeholder={t('pets.speciesPlaceholder')}
          options={SPECIES.map((s) => ({ value: s.id as string, label: `${s.emoji}  ${t(`pets.species.${s.id}` as TKey)}` }))}
          onChange={(v) => {
            if (v) pickSpecies(v)
          }}
        />
        <TextRow
          label={t('pets.breed')}
          value={breed}
          onChangeText={setBreed}
          placeholder={t('pets.breedPlaceholder')}
        />
        <DayRow
          label={t('pets.birthday')}
          value={birthday}
          onChange={setBirthday}
          optional
          maximumDate={new Date()}
          wheels
        />
      </FormSection>

      <FormSection>
        <TextRow
          label={t('pets.color')}
          value={color}
          onChangeText={setColor}
          placeholder={t('pets.colorPlaceholder')}
        />
        <TextRow
          label={t('pets.colorSecondary')}
          value={colorSecondary}
          onChangeText={setColorSecondary}
          placeholder={t('pets.colorSecondaryPlaceholder')}
        />
      </FormSection>

      <FormSection>
        <PetWeightRow label={t('pets.weight')} initial={weight} metric={metric} onChange={setWeight} />
        <PetLengthRow label={t('pets.length')} initial={length} metric={metric} onChange={setLength} />
        <TextRow
          label={t('pets.microchip')}
          value={microchip}
          onChangeText={setMicrochip}
          placeholder={t('pets.microchipPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </FormSection>

      <FormSection>
        <NoteRow
          label={t('pets.petNotes')}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('pets.petNotesPlaceholder')}
        />
      </FormSection>
    </>
  )

  const saveBtn = (
    <Btn
      title={saving ? t('common.saving') : pet ? t('common.saveChanges') : t('pets.addPet')}
      onPress={save}
      disabled={!name.trim()}
      loading={saving}
    />
  )

  if (!dock) {
    return (
      <View style={{ gap: sp.lg }}>
        {fields}
        {saveBtn}
      </View>
    )
  }

  return (
    <>
      <KeyboardScroll
        // flexShrink so the scroller yields to the sheet's max height instead
        // of overflowing it once the keyboard has taken half the screen;
        // flexGrow 0 so a short form is still a short sheet.
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ gap: sp.lg, paddingHorizontal: sp.lg, paddingBottom: sp.lg }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {top}
        {fields}
      </KeyboardScroll>
      {/* save — docked */}
      <View
        style={{
          paddingHorizontal: sp.lg,
          paddingTop: sp.sm,
          paddingBottom: dock.clearOfBars ? sp.md : bottomGap,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
        }}
      >
        {saveBtn}
      </View>
    </>
  )
}
