import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface TagProps {
  children: ReactNode
  className?: string
}

/**
 * 政策テーマなどを表す小さなタグ。
 * 中立的な配色で統一し、候補者ごとに強調を変えない（指示書 6.デザイン）。
 */
export function Tag({ children, className }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface px-2.5 py-0.5',
        'text-xs font-medium text-ink-soft',
        className,
      )}
    >
      {children}
    </span>
  )
}
