import { cn } from '../../lib/cn'

/**
 * 愛媛県らしさを感じられる控えめな装飾（瀬戸内海＋みかん）。
 * 情報の読みやすさを邪魔しないよう、淡い配色で背景に敷く（指示書 3・5）。
 */
export function SetouchiScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 140"
      preserveAspectRatio="xMidYMax slice"
      className={cn('block h-full w-full', className)}
      aria-hidden="true"
    >
      {/* 空 */}
      <rect width="400" height="140" fill="url(#sky)" />
      {/* 奥の島影 */}
      <path d="M0 96 Q60 70 120 92 T260 90 T400 96 V140 H0 Z" fill="#bcdcef" opacity="0.7" />
      <path d="M0 108 Q80 86 170 104 T400 106 V140 H0 Z" fill="#9fcde7" opacity="0.7" />
      {/* 海 */}
      <rect y="110" width="400" height="30" fill="url(#sea)" />
      {/* さざ波 */}
      <path d="M0 120 q20 -5 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.5" fill="none" />
      {/* みかん（右上に小さく） */}
      <g transform="translate(336,30)">
        <circle r="16" fill="var(--color-accent)" opacity="0.9" />
        <ellipse cx="-4" cy="-5" rx="4" ry="2.6" fill="#fff" fillOpacity="0.45" />
        <rect x="-1.2" y="-20" width="2.4" height="5" rx="1" fill="#7a5230" />
        <path d="M1 -18c3-2 6-1.6 6-1.6s-.6 2.8-3.2 3.7c-1.8.6-2.8-1-2.8-2.1z" fill="#3fae5a" />
      </g>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="140" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eef7ff" />
          <stop offset="1" stopColor="#dceffb" />
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="110" x2="0" y2="140" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7cc0e4" />
          <stop offset="1" stopColor="#5aa9d6" />
        </linearGradient>
      </defs>
    </svg>
  )
}
