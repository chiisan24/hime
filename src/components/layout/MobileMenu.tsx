import { X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { PRIMARY_NAV, SECONDARY_NAV } from '../../config/nav'
import { cn } from '../../lib/cn'

/**
 * モバイルのメニューボタンから開くドロワー。
 * 下部ナビに入りきらない補助メニュー（AI質問・日程・ガイド・設定など）へ誘導する。
 */
export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className={cn('fixed inset-0 z-40 md:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')}
      aria-hidden={!open}
    >
      {/* オーバーレイ */}
      <div
        className={cn(
          'absolute inset-0 bg-ink/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      {/* パネル */}
      <div
        className={cn(
          'absolute right-0 top-0 flex h-full w-80 max-w-[85%] flex-col bg-white shadow-xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
      >
        <div className="flex h-14 items-center justify-between border-b border-line px-4">
          <span className="font-bold text-ink">メニュー</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="メニューを閉じる"
            className="grid size-10 place-items-center rounded-[var(--radius-btn)] text-ink-soft hover:bg-surface"
          >
            <X className="size-6" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="全メニュー">
          <ul className="space-y-1">
            {[...PRIMARY_NAV, ...SECONDARY_NAV].map(({ label, path, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  end={path === '/'}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-[var(--radius-btn)] px-3 py-3 text-[15px] font-medium',
                      isActive
                        ? 'bg-primary-light text-primary-dark'
                        : 'text-ink-soft hover:bg-surface',
                    )
                  }
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
