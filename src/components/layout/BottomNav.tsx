import { NavLink } from 'react-router-dom'
import { PRIMARY_NAV } from '../../config/nav'
import { cn } from '../../lib/cn'

/**
 * スマートフォン用の画面下部固定ナビ（指示書 4.ナビゲーション）。
 * PC（md以上）ではサイドバーに切り替えるため非表示。
 */
export function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur md:hidden"
      aria-label="メインナビゲーション"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {PRIMARY_NAV.map(({ label, path, icon: Icon }) => (
          <li key={path} className="flex-1">
            <NavLink
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium',
                  isActive ? 'text-primary' : 'text-ink-faint',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn('size-6', isActive && 'stroke-[2.4]')}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
