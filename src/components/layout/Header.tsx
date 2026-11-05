import { Menu } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from './Logo'

/**
 * モバイル用ヘッダー（指示書 4.ヘッダー）。
 * アプリ名・ロゴ・メニューボタンを配置。PCではサイドバーを使うため非表示。
 */
export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2" aria-label="えひめ投票ナビ ホーム">
          <Logo className="size-8" />
          <span className="text-lg font-bold tracking-tight text-ink">えひめ投票ナビ</span>
        </Link>
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="メニューを開く"
          className="grid size-10 place-items-center rounded-[var(--radius-btn)] text-ink-soft hover:bg-surface"
        >
          <Menu className="size-6" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
