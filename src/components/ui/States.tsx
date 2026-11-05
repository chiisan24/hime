import type { ReactNode } from 'react'
import { AlertCircle, Inbox, Loader2 } from 'lucide-react'
import { Button } from './Button'

/** 読み込み中表示（指示書 共通デザイン） */
export function LoadingState({ label = '読み込み中…' }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-ink-soft"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/** データなし表示 */
export function EmptyState({
  title = 'データがありません',
  description,
  icon,
}: {
  title?: string
  description?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 grid size-14 place-items-center rounded-full bg-surface text-ink-faint">
        {icon ?? <Inbox className="size-7" aria-hidden="true" />}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-soft">{description}</p>}
    </div>
  )
}

/** エラー表示（再試行ボタン付き） */
export function ErrorState({
  title = '読み込みに失敗しました',
  description = '通信状況を確認して、もう一度お試しください。',
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
      role="alert"
    >
      <div className="grid size-14 place-items-center rounded-full bg-accent-light text-accent-dark">
        <AlertCircle className="size-7" aria-hidden="true" />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="max-w-xs text-sm text-ink-soft">{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-1">
          再読み込み
        </Button>
      )}
    </div>
  )
}
