/**
 * One Roof default art — a cozy "Warm Hearth" home scene: a little house under
 * a big roof (on brand), a glowing window, sage trees and a honey sun (or a
 * moon + stars at night). Flat warm fills, theme-aware, bottom-anchored. Used
 * full-strength on the Login screen and faint behind the Hub.
 */
export default function HearthBackdrop({
  theme,
  opacity = 1,
}: {
  theme: 'light' | 'dark'
  opacity?: number
}) {
  const dark = theme === 'dark'
  const c = dark
    ? {
        orb: '#ecdfc4',
        orbGlow: '#5a4a38',
        hillBack: '#241d16',
        hillFront: '#2c2419',
        roof: '#b05738',
        wall: '#3a2f23',
        wallShade: '#2f2619',
        door: '#241d16',
        window: '#e6ae55',
        frame: '#4a3a28',
        chimney: '#8e4630',
        smoke: '#3e352a',
        trunk: '#3a2f23',
        tree: '#46523c',
        treeDark: '#3a4533',
        bird: '#6e6357',
      }
    : {
        orb: '#e0a23c',
        orbGlow: '#ecc98a',
        hillBack: '#e6dac5',
        hillFront: '#dac8aa',
        roof: '#c2603f',
        wall: '#eccfa6',
        wallShade: '#deb888',
        door: '#a9663f',
        window: '#e7b864',
        frame: '#a9663f',
        chimney: '#b05738',
        smoke: '#cdbfa8',
        trunk: '#9a7a5a',
        tree: '#7e8a6b',
        treeDark: '#6c7a5a',
        bird: '#b3a89b',
      }

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 mx-auto w-full max-w-md select-none"
      style={{ opacity }}
    >
      <svg
        viewBox="0 0 800 560"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMax meet"
      >
        {/* sun / moon */}
        {dark ? (
          <>
            <circle cx="648" cy="132" r="40" fill={c.orb} />
            <g fill={c.orb} opacity="0.85">
              <circle cx="210" cy="92" r="2.5" />
              <circle cx="330" cy="66" r="2" />
              <circle cx="520" cy="104" r="2.5" />
              <circle cx="712" cy="210" r="2" />
              <circle cx="150" cy="170" r="2" />
            </g>
          </>
        ) : (
          <>
            <circle cx="640" cy="138" r="82" fill={c.orbGlow} opacity="0.45" />
            <circle cx="640" cy="138" r="42" fill={c.orb} />
          </>
        )}

        {/* birds */}
        <g stroke={c.bird} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.85">
          <path d="M236 116 q10 -8 20 0 q10 -8 20 0" />
          <path d="M292 92 q8 -7 16 0 q8 -7 16 0" />
          <path d="M196 150 q7 -6 14 0 q7 -6 14 0" />
        </g>

        {/* hills */}
        <path
          d="M0 430 C160 388 300 400 440 418 C560 432 680 418 800 432 L800 560 L0 560 Z"
          fill={c.hillBack}
        />

        {/* trees (behind the front hill line so they sit in the scene) */}
        <g>
          <rect x="150" y="396" width="14" height="86" rx="4" fill={c.trunk} />
          <circle cx="128" cy="402" r="28" fill={c.treeDark} />
          <circle cx="188" cy="400" r="30" fill={c.treeDark} />
          <circle cx="157" cy="384" r="44" fill={c.tree} />
        </g>
        <g>
          <rect x="556" y="420" width="12" height="66" rx="4" fill={c.trunk} />
          <circle cx="540" cy="422" r="20" fill={c.treeDark} />
          <circle cx="588" cy="420" r="22" fill={c.treeDark} />
          <circle cx="562" cy="408" r="32" fill={c.tree} />
        </g>

        {/* house */}
        <rect x="430" y="300" width="20" height="56" fill={c.chimney} />
        <g
          stroke={c.smoke}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          opacity="0.7"
        >
          <path d="M440 296 q-16 -16 0 -32 q16 -16 0 -32" />
        </g>
        <rect x="322" y="362" width="150" height="120" fill={c.wall} />
        <rect x="412" y="362" width="60" height="120" fill={c.wallShade} />
        <polygon points="300,368 397,290 494,368" fill={c.roof} />
        {/* door */}
        <rect x="356" y="420" width="36" height="62" rx="4" fill={c.door} />
        <circle cx="385" cy="452" r="2.5" fill={c.window} />
        {/* windows with simple frames */}
        <g>
          <rect x="334" y="384" width="26" height="26" rx="3" fill={c.window} />
          <path d="M347 384 V410 M334 397 H360" stroke={c.frame} strokeWidth="2" />
        </g>
        <g>
          <rect x="430" y="384" width="26" height="26" rx="3" fill={c.window} />
          <path d="M443 384 V410 M430 397 H456" stroke={c.frame} strokeWidth="2" />
        </g>

        {/* front hill, drawn last so it tucks the house + trees into the ground */}
        <path
          d="M0 492 C200 458 380 476 540 488 C650 496 740 490 800 494 L800 560 L0 560 Z"
          fill={c.hillFront}
        />

        {/* a little bush by the door */}
        <circle cx="300" cy="486" r="18" fill={c.treeDark} />
        <circle cx="320" cy="490" r="13" fill={c.tree} />
      </svg>
    </div>
  )
}
