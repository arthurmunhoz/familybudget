// The editable pet fields (photo, emoji, name, species, breed, birthday, colors,
// weight, length, microchip, notes) + a Save button — WITHOUT any surrounding
// chrome or scroll container, so it can be dropped into both the "Add pet"
// bottom sheet (PetForm) and the editable pet details screen (PetProfile). The
// parent supplies the ScrollView. Owns its own state, photo upload, and save.
import { useEffect, useState } from 'react'
import { Alert, Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Check, ChevronDown, Pencil, X } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { getSignedUrl } from '@/lib/signedUrls'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet } from '@/lib/types'
import { fonts, radius, sheetRadius, sp, useTheme } from '@/theme/theme'
import { SPECIES, speciesEmoji } from './petMeta'
import { DateField } from './petUi'

/** One height for the emoji + name row, so the two boxes line up. The name
 *  runs at display size here, so it needs more room than a plain field. */
const PET_FIELD_H = 56
/** Hero photo: full size at the top of the page, collapsed once scrolled. */
const HERO_MAX = 140
const HERO_MIN = 88
/** The floating photo actions. Two of them have to fit across HERO_MIN. */
const HERO_BTN = 32

export function PetEditor({
  pet,
  onSaved,
  scrollY,
}: {
  pet: Pet | null
  /** Called after a successful save, with the saved pet's name for a toast. */
  onSaved: (name?: string) => void
  /** The host page's scroll position. When given, the hero photo collapses as
   *  the page scrolls (the pet details screen); omitted in the add-pet sheet,
   *  where it simply stays full size. */
  scrollY?: Animated.Value
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()

  const [name, setName] = useState(pet?.name ?? '')
  const [emoji, setEmoji] = useState(pet?.emoji ?? '🐶')
  const [species, setSpecies] = useState(pet?.species ?? '')
  const [breed, setBreed] = useState(pet?.breed ?? '')
  const [birthday, setBirthday] = useState(pet?.birthday ?? '')
  const [color, setColor] = useState(pet?.color ?? '')
  const [colorSecondary, setColorSecondary] = useState(pet?.color_secondary ?? '')
  const [weight, setWeight] = useState(pet?.weight ?? '')
  const [length, setLength] = useState(pet?.length ?? '')
  const [microchip, setMicrochip] = useState(pet?.microchip ?? '')
  const [notes, setNotes] = useState(pet?.notes ?? '')
  const [photoPath, setPhotoPath] = useState(pet?.photo_path ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [speciesOpen, setSpeciesOpen] = useState(false)

  // Collapse the hero on scroll when the host drives one; otherwise it's a
  // constant at full size (Animated accepts a plain number just fine).
  const heroSize = scrollY
    ? scrollY.interpolate({ inputRange: [0, 120], outputRange: [HERO_MAX, HERO_MIN], extrapolate: 'clamp' })
    : HERO_MAX
  const heroGlyph = scrollY
    ? scrollY.interpolate({ inputRange: [0, 120], outputRange: [60, 38], extrapolate: 'clamp' })
    : 60

  // Sign the existing photo for preview.
  useEffect(() => {
    if (!pet?.photo_path) return
    let cancelled = false
    getSignedUrl(pet.photo_path).then((url) => {
      if (!cancelled && url) setPhotoPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [pet?.photo_path])

  function pickSpecies(id: string) {
    setSpecies(id)
    setEmoji(speciesEmoji(id)) // default the icon to the species; still editable
  }

  async function onAddPhoto() {
    if (uploadingPhoto || !profile) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('pets.photoFailed'))
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (result.canceled || !result.assets[0]) return
    setUploadingPhoto(true)
    try {
      // Resize to 512px (longest edge auto), encode to JPEG base64.
      const ctx = ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 512 })
      const ref = await ctx.renderAsync()
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
      if (!out.base64) throw new Error('no base64')
      const bytes = decodeBase64(out.base64)
      const path = `${profile.household_id}/pets/${randomUUID()}.jpg`
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '604800' })
      if (error) throw error
      setPhotoPath(path)
      setPhotoPreview(out.uri)
    } catch {
      Alert.alert(t('pets.photoFailed'))
    }
    setUploadingPhoto(false)
  }

  function removePhoto() {
    setPhotoPath('')
    setPhotoPreview(null)
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
      {/* Hero: the pet's photo with its actions floating ON it (pencil = add or
          change, ✕ = remove) rather than as a row of text buttons underneath.
          The wrapper is the one that carries the animated size — the circle
          clips its image, so buttons parented to IT would be clipped too. */}
      <Animated.View
        style={{ height: heroSize, width: heroSize, alignSelf: 'center' }}
      >
        <View
          style={{
            height: '100%',
            width: '100%',
            borderRadius: HERO_MAX / 2,
            backgroundColor: c.surface,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {photoPreview ? (
            <Image
              source={{ uri: photoPreview }}
              style={{ height: '100%', width: '100%' }}
              contentFit="cover"
            />
          ) : (
            <Animated.Text style={{ fontSize: heroGlyph }}>{emoji || '🐾'}</Animated.Text>
          )}
        </View>

        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: 0,
            flexDirection: 'row',
            gap: 6,
          }}
        >
          {photoPath ? (
            <Pressable
              onPress={removePhoto}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('common.remove')}
              style={{
                height: HERO_BTN,
                width: HERO_BTN,
                borderRadius: HERO_BTN / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.sheet,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
              }}
            >
              <X size={15} color={c.expense} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onAddPhoto}
            disabled={uploadingPhoto}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={photoPath ? t('pets.changePhoto') : t('pets.addPhoto')}
            style={{
              height: HERO_BTN,
              width: HERO_BTN,
              borderRadius: HERO_BTN / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: c.accent,
              opacity: uploadingPhoto ? 0.5 : 1,
            }}
          >
            <Pencil size={15} color={c.onAccent} />
          </Pressable>
        </View>
      </Animated.View>

      {/* The name reads as the page's title under the photo — big and centred,
          in a quiet box. The emoji sits beside it at a matching height. */}
      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
        <Field
          value={emoji}
          onChangeText={setEmoji}
          accessibilityLabel={t('pets.petEmoji')}
          style={{
            width: 56,
            height: PET_FIELD_H,
            paddingVertical: 0,
            textAlign: 'center',
            textAlignVertical: 'center',
            fontSize: 24,
          }}
        />
        <View style={{ flex: 1 }}>
          <Field
            value={name}
            onChangeText={setName}
            placeholder={t('pets.namePlaceholder')}
            style={{
              height: PET_FIELD_H,
              paddingVertical: 0,
              textAlign: 'center',
              textAlignVertical: 'center',
              fontFamily: fonts.display,
              fontSize: 24,
            }}
          />
        </View>
      </View>

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
