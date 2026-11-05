import { cn } from '../../lib/cn'

/**
 * シンプルなロゴ（みかんモチーフ）。
 * 装飾は控えめにし、情報の読みやすさを邪魔しない。
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="えひめ投票ナビ ロゴ"
    >
      {/* みかん本体 */}
      <circle cx="20" cy="22" r="13" fill="var(--color-accent)" />
      <circle cx="20" cy="22" r="13" fill="url(#mikanShade)" fillOpacity="0.25" />
      {/* ハイライト */}
      <ellipse cx="15.5" cy="17.5" rx="3.5" ry="2.4" fill="#fff" fillOpacity="0.5" />
      {/* ヘタと葉 */}
      <rect x="18.6" y="6" width="2.8" height="4.2" rx="1.2" fill="#7a5230" />
      <path d="M21 8.2c3.2-2.4 6.2-2 6.2-2s-.6 3-3.4 4.1c-1.9.7-2.8-1-2.8-2.1z" fill="#3fae5a" />
      <defs>
        <linearGradient id="mikanShade" x1="20" y1="9" x2="20" y2="35" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="var(--color-accent-dark)" />
        </linearGradient>
      </defs>
    </svg>
  )
}
