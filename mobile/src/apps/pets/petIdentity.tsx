// A pet's identity — its photo and its name — and the hero that shows them.
//
// This lives apart from PetEditor because on the details screen the photo is
// PINNED: it sits above the ScrollView and shrinks as the content scrolls, so
// it can't be a child of the form. The state has to be shared between the two,
// hence a controller the HOST owns and hands to both (`usePetIdentity`).
import { useEffect, useState } from 'react'
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Pencil, X } from 'lucide-react-native'

import { Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/hooks/useI18n'
import { getSignedUrl } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet } from '@/lib/types'
import { useTheme } from '@/theme/theme'

/** Hero photo: full size at rest, collapsed once the page is scrolled. */
export const HERO_MAX = 132
const HERO_MIN = 76
/** How far you scroll before the hero is fully collapsed. */
const COLLAPSE_AT = 130
const HERO_BTN = 30

export type PetIdentity = ReturnType<typeof usePetIdentity>

/** Owns the name + photo of the pet being edited. The host holds this so the
 *  hero (pinned, outside the scroll) and the form (inside it) agree. */
export function usePetIdentity(pet: Pet | null) {
  const { t } = useI18n()
  const { profile } = useAuth()

  const [name, setName] = useState(pet?.name ?? '')
  const [emoji, setEmoji] = useState(pet?.emoji ?? '🐶')
  const [photoPath, setPhotoPath] = useState(pet?.photo_path ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

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

  async function addPhoto() {
    if (uploading || !profile) return
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
    setUploading(true)
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
    setUploading(false)
  }

  function removePhoto() {
    setPhotoPath('')
    setPhotoPreview(null)
  }

  return {
    name,
    setName,
    emoji,
    setEmoji,
    photoPath,
    photoPreview,
    uploading,
    addPhoto,
    removePhoto,
  }
}

/** The circular photo with its two actions floating on it: ✕ (remove) in the
 *  top-right corner, pencil (add / change) in the bottom-right.
 *
 *  Pass `scrollY` — from a host that renders this ABOVE its ScrollView — to get
 *  the shrink-on-scroll. Animating the size is only safe because the hero is
 *  outside the scroll content: inside it, shrinking would change contentSize
 *  mid-gesture, iOS would clamp contentOffset to match, that would feed back
 *  into scrollY, and the scroll would lock up. */
export function PetHero({
  identity,
  scrollY,
}: {
  identity: PetIdentity
  scrollY?: Animated.Value
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { emoji, photoPath, photoPreview, uploading, addPhoto, removePhoto } = identity

  const size = scrollY
    ? scrollY.interpolate({
        inputRange: [0, COLLAPSE_AT],
        outputRange: [HERO_MAX, HERO_MIN],
        extrapolate: 'clamp',
      })
    : HERO_MAX

  return (
    <Animated.View style={{ height: size, width: size, alignSelf: 'center' }}>
      {/* The clip lives on an INNER view — buttons parented to it would be
          clipped away with the image. */}
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
          <Txt style={{ fontSize: 52 }}>{emoji || '🐾'}</Txt>
        )}
      </View>

      {photoPath ? (
        <Pressable
          onPress={removePhoto}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.remove')}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
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
        onPress={addPhoto}
        disabled={uploading}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={photoPath ? t('pets.changePhoto') : t('pets.addPhoto')}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          height: HERO_BTN,
          width: HERO_BTN,
          borderRadius: HERO_BTN / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.accent,
          opacity: uploading ? 0.5 : 1,
        }}
      >
        <Pencil size={15} color={c.onAccent} />
      </Pressable>
    </Animated.View>
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
