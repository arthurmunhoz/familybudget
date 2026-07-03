// Store logo for native. The PWA serves brand SVGs from /store-logos/<slug>.svg,
// but those assets aren't bundled in the app yet — so here we always render the
// PWA's *fallback*: a brand-colored monogram tile for catalog stores (using the
// catalog color) and a neutral tile for custom ones. So the list still reads
// right; real logo bitmaps can be wired up later via expo-image.
import { Text, View } from 'react-native'

import { catalogBySlug, monogram } from '@/lib/stores'
import { useTheme } from '@/theme/theme'

export default function StoreLogo({
  slug,
  name,
  color,
  size = 36,
}: {
  slug: string | null
  name: string
  /** Custom store color — overrides the catalog color when set. */
  color?: string | null
  size?: number
}) {
  const { c } = useTheme()
  const cat = catalogBySlug(slug)
  const bg = color ?? cat?.color ?? null
  const radius = Math.round(size * 0.24)

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg ?? c.surface2,
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.42),
          fontWeight: '600',
          color: bg ? '#ffffff' : c.textMuted,
        }}
      >
        {monogram(name)}
      </Text>
    </View>
  )
}
