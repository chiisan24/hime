import { NavLink, Link } from 'react-router-dom'
import { PRIMARY_NAV, SECONDARY_NAV } from '../../config/nav'
import { Logo } from './Logo'
import { cn } from '../../lib/cn'

/**
 * PC用の左サイドバーナビ（指示書 4：PCでは画面幅に応じて最適化）。
 * スマートフォン（md未満）では下部ナビを使うため非表示。
 */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white md:flex">
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5" aria-label="えひめ投票ナビ ホーム">
        <Logo className="size-9" />
        <span className="text-xl font-bold tracking-tight text-ink">えひめ投票ナビ</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="メインナビゲーション">
        <ul className="space-y-1">
          {PRIMARY_NAV.map(({ label, path, icon: Icon }) => (
            <li key={path}>
              <SidebarLink to={path} end={path === '/'} label={label} Icon={Icon} />
            </li>
          ))}
        </ul>

        <p className="px-3 pb-2 pt-6 text-xs font-semibold text-ink-faint">その他のメニュー</p>
        <ul className="space-y-1">
          {SECONDARY_NAV.map(({ label, path, icon: Icon }) => (
            <li key={path}>
              <SidebarLink to={path} label={label} Icon={Icon} />
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}

function SidebarLink({
  to,
  end,
  label,
  Icon,
}: {
  to: string
  end?: boolean
  label: string
  Icon: typeof PRIMARY_NAV[number]['icon']
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-[var(--radius-btn)] px-3 py-2.5 text-[15px] font-medium transition-colors',
          isActive
            ? 'bg-primary-light text-primary-dark'
            : 'text-ink-soft hover:bg-surface hover:text-ink',
        )
      }
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  )
}
