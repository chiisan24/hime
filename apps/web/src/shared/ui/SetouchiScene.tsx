type SetouchiSceneProps = Readonly<{
  className?: string;
}>;

/**
 * 松山城・しまなみの吊り橋・瀬戸内海・みかんを描いた控えめな風景（UI担当デザイン）。
 * ホームのヒーローで使う装飾のため aria-hidden。
 * 右下を基準に切り抜くので、狭い画面でも城と海が見える。
 */
export function SetouchiScene({ className }: SetouchiSceneProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      preserveAspectRatio="xMaxYMax slice"
      viewBox="0 0 1200 240"
    >
      <defs>
        <linearGradient id="ehimeSky" x1="0" x2="0" y1="0" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#eaf4ff" />
        </linearGradient>
        <linearGradient id="ehimeSea" x1="0" x2="0" y1="196" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a9d6f0" />
          <stop offset="1" stopColor="#74b9e2" />
        </linearGradient>
      </defs>

      <rect fill="url(#ehimeSky)" height="240" width="1200" />
      <circle cx="1120" cy="52" fill="#ffe0b2" opacity="0.7" r="26" />

      {/* 遠くの島々 */}
      <path
        d="M0 182 Q90 158 180 174 T380 170 T560 176 T760 166 T960 174 T1200 170 V240 H0 Z"
        fill="#cfe3f3"
      />

      {/* しまなみの吊り橋 */}
      <g fill="none" stroke="#7d9bb8" strokeLinecap="round">
        <line strokeWidth="3" x1="560" x2="800" y1="176" y2="176" />
        <line strokeWidth="4" x1="610" x2="610" y1="128" y2="182" />
        <line strokeWidth="4" x1="750" x2="750" y1="128" y2="182" />
        <path d="M560 172 Q585 140 610 130 Q680 168 750 130 Q775 140 800 172" strokeWidth="1.5" />
      </g>

      {/* 城山の緑 */}
      <path d="M800 200 Q940 150 1060 160 Q1140 166 1200 178 V240 H800 Z" fill="#cde8cf" />
      <ellipse cx="900" cy="184" fill="#a9d4ad" rx="26" ry="12" />
      <ellipse cx="1100" cy="180" fill="#a9d4ad" rx="30" ry="12" />

      {/* 松山城（天守のシルエット） */}
      <g transform="translate(944 96) scale(1.2)">
        <polygon fill="#9aa9b8" points="6,58 74,58 66,42 14,42" />
        <rect fill="#ffffff" height="12" width="44" x="18" y="30" />
        <polygon fill="#3f5f80" points="8,32 72,32 60,22 20,22" />
        <rect fill="#ffffff" height="9" width="30" x="25" y="14" />
        <polygon fill="#3f5f80" points="16,16 64,16 55,7 25,7" />
        <rect fill="#ffffff" height="9" width="18" x="31" y="-1" />
        <polygon fill="#3f5f80" points="25,1 55,1 48,-8 32,-8" />
        <rect fill="#3f5f80" height="4" width="4" x="28" y="34" />
        <rect fill="#3f5f80" height="4" width="4" x="38" y="34" />
        <rect fill="#3f5f80" height="4" width="4" x="48" y="34" />
      </g>

      {/* 瀬戸内海 */}
      <rect fill="url(#ehimeSea)" height="44" width="1200" y="196" />
      <path
        d="M0 210 q30 -6 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2"
      />

      {/* 手前のみかん */}
      <g transform="translate(1150 206)">
        <circle fill="#ff9800" r="13" />
        <ellipse cx="-4" cy="-4" fill="#ffffff" fillOpacity="0.45" rx="3.5" ry="2.3" />
        <path d="M1 -13c3-2.2 6-1.8 6-1.8s-.6 2.9-3.3 3.8c-1.8.6-2.7-1-2.7-2z" fill="#3fae5a" />
      </g>
      <g transform="translate(1124 216) scale(0.75)">
        <circle fill="#ff9800" r="13" />
        <ellipse cx="-4" cy="-4" fill="#ffffff" fillOpacity="0.45" rx="3.5" ry="2.3" />
      </g>
    </svg>
  );
}
