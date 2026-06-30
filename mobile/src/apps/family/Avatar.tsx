// Round member avatar: shows the signed photo when available, otherwise the
// member's initial on a soft surface. Photos are resolved lazily through the
// signed-URL cache so they render fast on repeat views.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'

import { getSignedUrl } from '@/lib/signedUrls'
import { useTheme } from '@/theme/theme'
import { Txt } from '@/components/ui'
import { initial } from './familyShared'

export function Avatar({
  name,
  avatarPath,
  size = 44,
}: {
  name: string
  avatarPath: string | null | undefined
  size?: number
}) {
  const { c } = useTheme()
  const [url, setUrl] = useState<string | null>(null)

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
    return (
      <View style={base}>
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
        />
      </View>
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
