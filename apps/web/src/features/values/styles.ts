/*
 * 価値観マップの画面で使うボタンのクラス。
 * 既存の pages.tsx のリンクと同じ見た目（丸いボタン、縦横44px以上）にそろえる。
 */

export const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-soft aria-disabled:cursor-not-allowed aria-disabled:bg-surface-2 aria-disabled:text-ink-soft";

export const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-2 text-sm font-bold text-ink-soft shadow-[var(--shadow-card)] transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-soft";

export const TEXT_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-3 text-sm font-bold text-ink-soft underline underline-offset-4 transition hover:text-primary";
