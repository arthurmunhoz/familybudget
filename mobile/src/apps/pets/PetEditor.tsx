// The editable pet fields (name, species, breed, birthday, colors, weight,
// length, microchip, notes) + a Save button — WITHOUT any surrounding chrome or
// scroll container, so it can be dropped into both the "Add pet" bottom sheet
// (PetForm) and the editable pet details screen (PetProfile). The parent
// supplies the ScrollView, and the photo + name live in a `usePetIdentity`
// controller the parent owns (PetProfile pins the photo above its scroll).
import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { Check, ChevronDown } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import type { PetIdentity } from './petIdentity'
import { SPECIES, speciesEmoji } from './petMeta'
import { DateField } from './petUi'

/** Height of the plain (boxed) fields — the species dropdown matches Field. */
const PET_FIELD_H = 48

export function PetEditor({
  pet,
  identity,
  onSaved,
}: {
  pet: Pet | null
  /** The photo + name, owned by the host (see `usePetIdentity`). */
  identity: PetIdentity
  /** Called after a successful save, with the saved pet's name for a toast. */
  onSaved: (name?: string) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
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
  const [speciesOpen, setSpeciesOpen] = useState(false)

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

  return (
    <View style={{ gap: sp.md }}>
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

      {/* species — one dropdown instead of nine wrapping pills */}
      <View style={{ gap: 6 }}>
        <Txt variant="label">{t('pets.species')}</Txt>
        <Pressable
          onPress={() => setSpeciesOpen(true)}
          accessibilityRole="button"
          style={{
            height: PET_FIELD_H,
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.sm,
            backgroundColor: c.card,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: sp.md,
          }}
        >
          <Txt style={{ flex: 1, color: species ? c.text : c.textFaint }}>
            {species
              ? `${speciesEmoji(species)}  ${t(`pets.species.${species}` as TKey)}`
              : t('pets.speciesPlaceholder')}
          </Txt>
          <ChevronDown size={18} color={c.textMuted} />
        </Pressable>
      </View>

      <Field
        label={t('pets.breed')}
        value={breed}
        onChangeText={setBreed}
        placeholder={t('pets.breedPlaceholder')}
      />

      <DateField
        label={`${t('pets.birthday')} ${t('pets.optional')}`}
        value={birthday}
        placeholder={t('pets.optional')}
        onChange={setBirthday}
        optional
      />

      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t('pets.color')}
            value={color}
            onChangeText={setColor}
            placeholder={t('pets.colorPlaceholder')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t('pets.colorSecondary')}
            value={colorSecondary}
            onChangeText={setColorSecondary}
            placeholder={t('pets.colorSecondaryPlaceholder')}
          />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t('pets.weight')}
            value={weight}
            onChangeText={setWeight}
            placeholder={t('pets.weightPlaceholder')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label={t('pets.length')}
            value={length}
            onChangeText={setLength}
            placeholder={t('pets.lengthPlaceholder')}
          />
        </View>
      </View>

      <Field
        label={t('pets.microchip')}
        value={microchip}
        onChangeText={setMicrochip}
        placeholder={t('pets.microchipPlaceholder')}
      />

      <Field
        label={t('pets.petNotes')}
        value={notes}
        onChangeText={setNotes}
        placeholder={t('pets.petNotesPlaceholder')}
      />

      <Btn
        title={saving ? t('common.saving') : pet ? t('common.saveChanges') : t('pets.addPet')}
        onPress={save}
        disabled={!name.trim()}
        loading={saving}
        style={{ marginTop: sp.xs }}
      />

      {/* species dropdown */}
      <Modal
        visible={speciesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeciesOpen(false)}
      >
        <Pressable
          onPress={() => setSpeciesOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: c.sheet,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingTop: sp.lg,
              paddingBottom: sp.xl,
              maxHeight: '70%',
            }}
          >
            <Txt variant="label" style={{ paddingHorizontal: sp.lg, marginBottom: sp.sm }}>
              {t('pets.species')}
            </Txt>
            <ScrollView>
              {SPECIES.map((s) => {
                const active = species === s.id
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      pickSpecies(s.id)
                      setSpeciesOpen(false)
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.md,
                      paddingHorizontal: sp.lg,
                      paddingVertical: 14,
                    }}
                  >
                    <Txt style={{ fontSize: 20 }}>{s.emoji}</Txt>
                    <Txt style={{ flex: 1, fontWeight: active ? '700' : '400' }}>
                      {t(`pets.species.${s.id}` as TKey)}
                    </Txt>
                    {active ? <Check size={18} color={c.accent} /> : null}
                  </Pressable>
                )
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

/** RN-safe base64 → Uint8Array (no atob). */
function decodeBase64(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  const len = b64.length
  let padding = 0
  if (b64[len - 1] === '=') padding++
  if (b64[len - 2] === '=') padding++
  const byteLength = (len * 3) / 4 - padding
  const bytes = new Uint8Array(byteLength)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[b64.charCodeAt(i)]
    const e2 = lookup[b64.charCodeAt(i + 1)]
    const e3 = lookup[b64.charCodeAt(i + 2)]
    const e4 = lookup[b64.charCodeAt(i + 3)]
    bytes[p++] = (e1 << 2) | (e2 >> 4)
    if (p < byteLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2)
    if (p < byteLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63)
  }
  return bytes
}

/** UUID v4 without a crypto dependency (good enough for a storage filename). */
function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
