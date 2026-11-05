import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** ホバー時に軽く浮かせる（リンクカード用） */
  interactive?: boolean
}

/** 画面共通の角丸カード */
export function Card({ children, interactive, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-white',
        'shadow-[0_1px_2px_rgba(22,41,77,0.04),0_6px_18px_rgba(22,41,77,0.05)]',
        interactive && 'transition-colors hover:border-primary/40 hover:bg-primary-light/30',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
