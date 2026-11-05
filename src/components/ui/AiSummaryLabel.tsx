import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * 「AIによる要約」であることを明示するラベル（指示書 7）。
 * AI生成文には必ずこのラベルを添える。
 */
export function AiSummaryLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5',
        'text-[11px] font-semibold text-primary-dark',
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      AIによる要約
    </span>
  )
}
