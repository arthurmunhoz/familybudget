// The editable pet fields (photo, emoji, name, species, breed, birthday, colors,
// weight, length, microchip, notes) + a Save button — WITHOUT any surrounding
// chrome or scroll container, so it can be dropped into both the "Add pet"
// bottom sheet (PetForm) and the editable pet details screen (PetProfile). The
// parent supplies the ScrollView. Owns its own state, photo upload, and save.
import { useEffect, useState } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Camera } from 'lucide-react-native'

import { Btn, Field, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { getSignedUrl } from '@/lib/signedUrls'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { SPECIES, speciesEmoji } from './petMeta'
import { DateField } from './petUi'

export function PetEditor({
  pet,
  onSaved,
}: {
  pet: Pet | null
  onSaved: () => void
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
    // Clean up a replaced/removed photo file.
    const oldPhoto = pet?.photo_path ?? null
    if (oldPhoto && oldPhoto !== (photoPath || null)) {
      await supabase.storage.from('documents').remove([oldPhoto])
    }
    onSaved()
  }

  return (
    <View style={{ gap: sp.md }}>
      {/* photo */}
      <View style={{ alignItems: 'center', gap: sp.sm }}>
        <View
          style={{
            height: 96,
            width: 96,
            borderRadius: 48,
            backgroundColor: c.surface,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {photoPreview ? (
            <Image source={{ uri: photoPreview }} style={{ height: 96, width: 96 }} contentFit="cover" />
          ) : (
            <Txt style={{ fontSize: 40 }}>{emoji || '🐾'}</Txt>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: sp.sm }}>
          <Pressable
            onPress={onAddPhoto}
            disabled={uploadingPhoto}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: c.surface,
              borderRadius: radius.sm,
              paddingHorizontal: 12,
              paddingVertical: 8,
              opacity: uploadingPhoto ? 0.5 : 1,
            }}
          >
            <Camera size={16} color={c.text} />
            <Txt variant="label" style={{ color: c.text }}>
              {uploadingPhoto
                ? t('drawer.working')
                : photoPath
                  ? t('pets.changePhoto')
                  : t('pets.addPhoto')}
            </Txt>
          </Pressable>
          {photoPath ? (
            <Pressable
              onPress={removePhoto}
              style={{
                backgroundColor: c.surface,
                borderRadius: radius.sm,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Txt variant="label" style={{ color: c.expense }}>
                {t('common.remove')}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* emoji + name */}
      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <Field
          value={emoji}
          onChangeText={setEmoji}
          accessibilityLabel={t('pets.petEmoji')}
          style={{ width: 64, textAlign: 'center', fontSize: 22 }}
        />
        <View style={{ flex: 1 }}>
          <Field value={name} onChangeText={setName} placeholder={t('pets.namePlaceholder')} />
        </View>
      </View>

      {/* species */}
      <View style={{ gap: 6 }}>
        <Txt variant="label">{t('pets.species')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
          {SPECIES.map((s) => {
            const active = species === s.id
            return (
              <Pressable
                key={s.id}
                onPress={() => pickSpecies(s.id)}
                style={{
                  flexDirection: 'row',
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: active ? c.accent : c.surface,
                }}
              >
                <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600' }}>
                  {s.emoji} {t(`pets.species.${s.id}` as TKey)}
                </Txt>
              </Pressable>
            )
          })}
        </View>
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
