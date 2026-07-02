// Round member avatar: shows the signed photo when available, otherwise the
// member's initial on a soft surface. Photos are resolved lazily through the
// signed-URL cache so they render fast on repeat views.
import { useEffect, useState } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Image } from 'expo-image'

import { getSignedUrl } from '@/lib/signedUrls'
import { useTheme } from '@/theme/theme'
import { Txt } from '@/components/ui'
import { initial } from './familyShared'

export function Avatar({
  name,
  avatarPath,
  size = 44,
  zoomable = false,
}: {
  name: string
  avatarPath: string | null | undefined
  size?: number
  /** When true and a photo is set, tapping opens a full-screen lightbox. */
  zoomable?: boolean
}) {
  const { c } = useTheme()
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let active = true
    if (!avatarPath) {
      setUrl(null)
      return
    }
    getSignedUrl(avatarPath).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [avatarPath])

  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: c.surface,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }

  if (url) {
    const img = (
      <View style={base}>
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
        />
      </View>
    )
    if (!zoomable) return img
    return (
      <>
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton">
          {img}
        </Pressable>
        <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
          <Pressable
            onPress={() => setZoom(false)}
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.92)',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '80%' }}
              contentFit="contain"
              transition={150}
            />
          </Pressable>
        </Modal>
      </>
    )
  }

  return (
    <View style={base}>
      <Txt
        style={{
          fontSize: size * 0.42,
          fontWeight: '700',
          color: c.textFaint,
        }}
      >
        {initial(name)}
      </Txt>
    </View>
  )
}
