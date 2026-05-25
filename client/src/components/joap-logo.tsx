/**
 * JoapLogo — crossed hammer + screwdriver, matching favicon.svg.
 * Use anywhere the brand mark appears (sidebar header, login splash, About
 * hero, PDF exports). Vector-clean at any size; respects parent `color`
 * indirectly via the amber gradient backplate.
 */
export function JoapLogo({ size = 32, className }: { size?: number; className?: string }) {
  const id = "joap-logo-" + Math.random().toString(36).slice(2, 8);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="JOAP Hardware Trading"
    >
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#f5a623" />
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#bg-${id})`} />
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd07a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#d65a2a" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`handle-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a06a3a" />
          <stop offset="100%" stopColor="#6b4220" />
        </linearGradient>
        <linearGradient id={`head-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a6470" />
          <stop offset="100%" stopColor="#2f3845" />
        </linearGradient>
        <linearGradient id={`shaft-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bcc4d0" />
          <stop offset="100%" stopColor="#6b7480" />
        </linearGradient>
        <linearGradient id={`grip-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e84a3a" />
          <stop offset="100%" stopColor="#a82a1a" />
        </linearGradient>
      </defs>

      {/* Screwdriver */}
      <g transform="rotate(45 32 32)">
        <rect x="30" y="6" width="4" height="18" rx="2" fill={`url(#grip-${id})`} />
        <rect x="29" y="6" width="6" height="3" rx="1.5" fill="#7a1a10" />
        <rect x="29" y="24" width="6" height="2" fill="#3a4250" />
        <rect x="31" y="26" width="2" height="28" fill={`url(#shaft-${id})`} />
        <polygon points="29.5,54 34.5,54 33.5,58 30.5,58" fill="#aab4c0" />
      </g>

      {/* Hammer */}
      <g transform="rotate(-45 32 32)">
        <rect x="30" y="22" width="4" height="32" rx="1.5" fill={`url(#handle-${id})`} />
        <rect x="29.5" y="44" width="5" height="1.5" fill="#3a2614" opacity="0.6" />
        <rect x="29.5" y="48" width="5" height="1.5" fill="#3a2614" opacity="0.6" />
        <path
          d="M 22 14 L 42 14 L 44 22 L 40 22 L 40 24 L 24 24 L 24 22 L 20 22 Z"
          fill={`url(#head-${id})`}
        />
        <path d="M 22 14 L 18 8 L 14 10 L 18 18 Z" fill="#3a4250" />
        <rect x="24" y="16" width="16" height="2" fill="#7a8694" opacity="0.6" />
      </g>

      {/* Spark */}
      <circle cx="32" cy="32" r="3" fill="#fff8d6" opacity="0.9" />
      <circle cx="32" cy="32" r="6" fill="#ffd07a" opacity="0.35" />
    </svg>
  );
}
