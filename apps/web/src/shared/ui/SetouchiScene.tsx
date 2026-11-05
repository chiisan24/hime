type SetouchiSceneProps = Readonly<{
  className?: string;
}>;

/**
 * 瀬戸内海＋みかんの控えめな装飾（UI担当デザイン）。
 * ヘッダー背景に淡く敷き、文言の可読性を損なわない。装飾のため aria-hidden。
 */
export function SetouchiScene({ className }: SetouchiSceneProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 120"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <rect width="400" height="120" fill="url(#setoSky)" />
      <path d="M0 82 Q60 58 120 80 T260 78 T400 84 V120 H0 Z" fill="#bcdcef" opacity="0.6" />
      <path d="M0 94 Q80 72 170 90 T400 92 V120 H0 Z" fill="#9fcde7" opacity="0.6" />
      <rect y="98" width="400" height="22" fill="url(#setoSea)" />
      <g transform="translate(348,26)">
        <circle r="13" fill="var(--color-accent)" opacity="0.9" />
        <ellipse cx="-3.5" cy="-4" rx="3.2" ry="2.1" fill="#fff" fillOpacity="0.45" />
        <rect x="-1" y="-16" width="2" height="4" rx="1" fill="#7a5230" />
        <path d="M1 -14c2.5-1.8 5-1.4 5-1.4s-.5 2.4-2.7 3.2c-1.5.5-2.3-.9-2.3-1.8z" fill="#3fae5a" />
      </g>
      <defs>
        <linearGradient id="setoSky" x1="0" y1="0" x2="0" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eef7ff" />
          <stop offset="1" stopColor="#dceffb" />
        </linearGradient>
        <linearGradient id="setoSea" x1="0" y1="98" x2="0" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7cc0e4" />
          <stop offset="1" stopColor="#5aa9d6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
