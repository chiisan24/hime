type BrandLogoProps = Readonly<{
  className?: string;
}>;

/**
 * みかんをモチーフにしたシンプルなロゴ（UI担当デザイン）。
 * 装飾は控えめにし、情報の読みやすさを邪魔しない。
 */
export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      role="img"
      aria-label="えひめ投票ナビ ロゴ"
    >
      <circle cx="20" cy="22" r="13" fill="var(--color-accent)" />
      <ellipse cx="15.5" cy="17.5" rx="3.5" ry="2.4" fill="#fff" fillOpacity="0.5" />
      <rect x="18.6" y="6" width="2.8" height="4.2" rx="1.2" fill="#7a5230" />
      <path
        d="M21 8.2c3.2-2.4 6.2-2 6.2-2s-.6 3-3.4 4.1c-1.9.7-2.8-1-2.8-2.1z"
        fill="#3fae5a"
      />
    </svg>
  );
}
