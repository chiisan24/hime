import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import { SECONDARY_NAV } from '../config/nav'

export function More() {
  return (
    <div>
      <PageTitle title="その他" description="各種メニューと設定はこちらから。" />

      <Card className="divide-y divide-line p-0">
        {SECONDARY_NAV.map(({ label, path, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="font-medium text-ink">{label}</span>
            <ChevronRight className="ml-auto size-5 text-ink-faint" aria-hidden="true" />
          </Link>
        ))}
      </Card>

      <p className="mt-6 text-center text-xs text-ink-faint">
        えひめ投票ナビ（デモ版）
      </p>
    </div>
  )
}
