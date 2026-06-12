/**
 * Decorative watercolor-style beach scene for the home screen: beach house,
 * ocean, palm trees, and a Tampa road sign. Rendered at low opacity so it
 * stays a subtle background in both light and dark themes.
 */
export default function BeachBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 mx-auto max-w-md select-none"
      style={{ opacity: 0.22 }}
    >
      <svg
        viewBox="0 0 800 520"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMax meet"
      >
        {/* sun */}
        <circle cx="640" cy="95" r="75" fill="#fbbf24" opacity="0.35" />
        <circle cx="640" cy="95" r="50" fill="#fbbf24" opacity="0.9" />

        {/* clouds */}
        <g fill="#94a3b8" opacity="0.45">
          <ellipse cx="170" cy="85" rx="55" ry="17" />
          <ellipse cx="220" cy="72" rx="38" ry="13" />
          <ellipse cx="455" cy="125" rx="45" ry="13" />
        </g>

        {/* birds */}
        <g stroke="#475569" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M310 110 q10 -10 20 0 q10 -10 20 0" />
          <path d="M365 78 q8 -8 16 0 q8 -8 16 0" />
        </g>

        {/* ocean */}
        <rect x="0" y="268" width="800" height="95" fill="#38bdf8" opacity="0.8" />
        <g stroke="#e0f2fe" strokeWidth="4" fill="none" opacity="0.8" strokeLinecap="round">
          <path d="M60 300 q15 8 30 0 q15 8 30 0" />
          <path d="M250 332 q15 8 30 0 q15 8 30 0" />
          <path d="M610 312 q15 8 30 0 q15 8 30 0" />
        </g>

        {/* sailboat */}
        <g>
          <path d="M540 268 h44 l-9 14 h-27 z" fill="#f8fafc" />
          <path d="M562 264 v-40 l27 40 z" fill="#fb7185" />
          <path d="M556 264 v-32 l-19 32 z" fill="#fda4af" />
        </g>

        {/* sand */}
        <path
          d="M0 362 Q200 332 420 356 T800 350 L800 520 L0 520 Z"
          fill="#fcd34d"
          opacity="0.85"
        />

        {/* beach house */}
        <g>
          <rect x="340" y="290" width="130" height="86" rx="4" fill="#fff7ed" stroke="#fdba74" strokeWidth="3" />
          <path d="M324 292 L405 238 L486 292 Z" fill="#fb7185" />
          <rect x="390" y="331" width="28" height="45" rx="3" fill="#b45309" />
          <rect x="352" y="305" width="24" height="22" rx="3" fill="#7dd3fc" />
          <rect x="432" y="305" width="24" height="22" rx="3" fill="#7dd3fc" />
        </g>

        {/* large palm */}
        <g>
          <path d="M150 408 C156 345 144 322 162 286" stroke="#a16207" strokeWidth="12" fill="none" strokeLinecap="round" />
          <g fill="none" stroke="#22c55e" strokeWidth="9" strokeLinecap="round">
            <path d="M162 286 q-45 -25 -86 -10" />
            <path d="M162 286 q-30 -45 -70 -50" />
            <path d="M162 286 q5 -50 40 -64" />
            <path d="M162 286 q45 -30 86 -18" />
            <path d="M162 286 q40 -5 70 22" />
          </g>
          <circle cx="156" cy="293" r="6" fill="#92400e" />
          <circle cx="170" cy="296" r="6" fill="#92400e" />
        </g>

        {/* small palm */}
        <g>
          <path d="M252 402 C248 362 257 342 244 314" stroke="#a16207" strokeWidth="9" fill="none" strokeLinecap="round" />
          <g fill="none" stroke="#16a34a" strokeWidth="7" strokeLinecap="round">
            <path d="M244 314 q-32 -18 -62 -8" />
            <path d="M244 314 q-20 -33 -50 -36" />
            <path d="M244 314 q4 -36 30 -47" />
            <path d="M244 314 q33 -22 62 -13" />
          </g>
        </g>

        {/* Tampa road sign */}
        <g>
          <rect x="664" y="332" width="9" height="72" rx="2" fill="#6b7280" />
          <rect x="612" y="292" width="113" height="46" rx="7" fill="#16a34a" stroke="#f8fafc" strokeWidth="3" />
          <text
            x="668.5"
            y="323"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize="24"
            fontWeight="bold"
            fill="#ffffff"
            letterSpacing="3"
          >
            TAMPA
          </text>
        </g>
      </svg>
    </div>
  )
}
