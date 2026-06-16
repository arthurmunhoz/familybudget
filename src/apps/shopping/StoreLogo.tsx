import { useState } from 'react'
import { catalogBySlug, monogram } from '../../lib/stores'

/**
 * Store logo with a graceful fallback. If the store has a catalog `slug` and a
 * bundled file exists at `/store-logos/<slug>.svg`, that renders; otherwise it
 * falls back to a brand-colored monogram tile (catalog color for known stores,
 * neutral for custom ones). So the list always looks right, even before any
 * real logo files are added.
 */
export default function StoreLogo({
  slug,
  name,
  size = 36,
}: {
  slug: string | null
  name: string
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const cat = catalogBySlug(slug)
  const radius = Math.round(size * 0.24)

  if (slug && !failed) {
    return (
      <img
        src={`/store-logos/${slug}.svg`}
        alt=""
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'contain',
          background: '#fff',
          flex: 'none',
        }}
      />
    )
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.42),
        background: cat?.color ?? 'var(--surface-2, var(--surface))',
        color: cat ? '#fff' : 'var(--text-muted)',
      }}
    >
      {monogram(name)}
    </span>
  )
}
