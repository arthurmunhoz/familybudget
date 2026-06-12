/**
 * Decorative beach scene for the home screen — travel-poster style:
 * silhouette palms, gradient ocean with a setting sun, Tampa skyline on the
 * horizon, modern stilt beach house, and a TAMPA road sign. Rendered at low
 * opacity, lifted above the bottom action button.
 */
export default function BeachBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 -z-10 mx-auto max-w-md select-none"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom) + 6.5rem)',
        opacity: 0.25,
      }}
    >
      <svg
        viewBox="0 0 800 460"
        width="100%"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMax meet"
      >
        <defs>
          <linearGradient id="bb-sea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#155e75" />
            <stop offset="1" stopColor="#67e8f9" />
          </linearGradient>
          <linearGradient id="bb-sand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ead9b0" />
            <stop offset="1" stopColor="#d9c294" />
          </linearGradient>
          <radialGradient id="bb-sun">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="0.55" stopColor="#fbbf24" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* setting sun */}
        <circle cx="600" cy="215" r="95" fill="url(#bb-sun)" />
        <circle cx="600" cy="215" r="36" fill="#fcd34d" opacity="0.95" />

        {/* gulls */}
        <g stroke="#64748b" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8">
          <path d="M250 120 q9 -7 18 0 q9 -7 18 0" />
          <path d="M300 95 q7 -6 14 0 q7 -6 14 0" />
          <path d="M205 150 q6 -5 12 0 q6 -5 12 0" />
        </g>

        {/* Tampa skyline on the horizon */}
        <g fill="#475569" opacity="0.5">
          <rect x="300" y="214" width="14" height="36" />
          <rect x="318" y="200" width="18" height="50" />
          <rect x="340" y="222" width="12" height="28" />
          <rect x="356" y="190" width="20" height="60" />
          <rect x="380" y="208" width="14" height="42" />
          <rect x="398" y="226" width="16" height="24" />
          <line x1="366" y1="190" x2="366" y2="176" stroke="#475569" strokeWidth="2" />
        </g>

        {/* ocean */}
        <rect x="0" y="250" width="800" height="80" fill="url(#bb-sea)" opacity="0.9" />
        {/* sun reflection */}
        <g stroke="#fde68a" strokeLinecap="round" opacity="0.7">
          <line x1="582" y1="262" x2="618" y2="262" strokeWidth="4" />
          <line x1="588" y1="274" x2="612" y2="274" strokeWidth="3" />
          <line x1="593" y1="286" x2="607" y2="286" strokeWidth="3" />
        </g>
        {/* wave highlights */}
        <g stroke="#e0f2fe" strokeWidth="2" opacity="0.5" strokeLinecap="round">
          <line x1="80" y1="280" x2="150" y2="280" />
          <line x1="240" y1="300" x2="330" y2="300" />
          <line x1="450" y1="272" x2="520" y2="272" />
          <line x1="660" y1="305" x2="730" y2="305" />
        </g>

        {/* sand with foam line */}
        <path d="M0 330 C 180 312 420 318 800 326 L800 460 L0 460 Z" fill="url(#bb-sand)" />
        <path
          d="M0 330 C 180 312 420 318 800 326"
          stroke="#f8fafc"
          strokeWidth="3"
          fill="none"
          opacity="0.7"
        />

        {/* modern stilt beach house */}
        <g>
          <rect x="436" y="316" width="6" height="24" fill="#64748b" />
          <rect x="470" y="316" width="6" height="24" fill="#64748b" />
          <rect x="540" y="316" width="6" height="24" fill="#64748b" />
          <rect x="574" y="316" width="6" height="24" fill="#64748b" />
          <rect x="428" y="310" width="160" height="8" rx="2" fill="#94a3b8" />
          <rect x="432" y="258" width="152" height="52" rx="2" fill="#f1f5f9" />
          <rect x="424" y="248" width="168" height="10" rx="3" fill="#475569" />
          <rect x="446" y="268" width="32" height="30" rx="1" fill="#7cc7d8" />
          <rect x="492" y="268" width="32" height="30" rx="1" fill="#7cc7d8" />
          <rect x="544" y="268" width="22" height="42" rx="1" fill="#64748b" />
        </g>

        {/* palm silhouettes */}
        <g id="bb-palm" fill="#334155">
          <path d="M128 432 C 140 370 150 320 168 268 L178 272 C 162 322 154 372 150 432 Z" />
          <path d="M172 268 C 140 244 100 238 70 250 C 105 252 140 260 170 276 Z" />
          <path d="M172 268 C 150 234 118 218 88 218 C 120 228 148 244 168 270 Z" />
          <path d="M172 268 C 176 232 196 208 226 200 C 202 220 188 244 180 272 Z" />
          <path d="M172 268 C 204 246 242 240 272 250 C 240 252 206 262 176 278 Z" />
          <path d="M172 268 C 198 270 226 282 244 302 C 218 290 194 282 174 280 Z" />
          <path d="M172 268 C 146 270 120 282 104 300 C 128 288 152 282 172 280 Z" />
          <circle cx="168" cy="278" r="5" fill="#1f2937" />
          <circle cx="178" cy="282" r="5" fill="#1f2937" />
        </g>
        <use href="#bb-palm" transform="translate(175 160) scale(0.6)" />

        {/* TAMPA road sign */}
        <g>
          <rect x="686" y="346" width="4" height="44" fill="#6b7280" />
          <rect x="714" y="346" width="4" height="44" fill="#6b7280" />
          <rect x="672" y="314" width="60" height="34" rx="4" fill="#15803d" stroke="#e2e8f0" strokeWidth="2" />
          <text
            x="702"
            y="336"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize="14"
            fontWeight="bold"
            fill="#ffffff"
            letterSpacing="2"
          >
            TAMPA
          </text>
        </g>
      </svg>
    </div>
  )
}
