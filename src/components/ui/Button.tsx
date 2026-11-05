import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'accent' | 'outline' | 'ghost'
type Size = 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** 先頭に表示するアイコン */
  leftIcon?: ReactNode
  /** 末尾に表示するアイコン */
  rightIcon?: ReactNode
  fullWidth?: boolean
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark active:bg-primary-dark',
  accent: 'bg-accent text-white hover:bg-accent-dark active:bg-accent-dark',
  outline:
    'bg-white text-primary border border-primary/40 hover:bg-primary-light active:bg-primary-light',
  ghost: 'bg-transparent text-ink-soft hover:bg-surface active:bg-surface-2',
}

const sizeClass: Record<Size, string> = {
  // ボタンは十分な大きさ（指示書 共通デザイン）
  md: 'min-h-11 px-4 text-[15px] gap-2',
  lg: 'min-h-13 px-5 text-base gap-2.5',
}

export function Button({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-btn)] font-semibold',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}
