import { Link } from 'react-router-dom'
import {
  Users,
  Scale,
  MapPin,
  MessageCircleQuestion,
  CalendarDays,
  BookOpen,
  Bell,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { SetouchiScene } from '../components/decor/SetouchiScene'
import { Logo } from '../components/layout/Logo'
import { currentElection } from '../data/election'
import { formatJpDate, formatShortDate, daysUntil } from '../lib/date'

interface MainAction {
  label: string
  description: string
  path: string
  icon: LucideIcon
}

const MAIN_ACTIONS: MainAction[] = [
  { label: '候補者を知る', description: '立候補者の横顔と政策', path: '/candidates', icon: Users },
  { label: '政策を比較', description: 'テーマ別に見くらべる', path: '/compare', icon: Scale },
  { label: '投票所を探す', description: '当日・期日前投票所', path: '/polling', icon: MapPin },
  { label: 'AIに質問', description: '選挙の疑問をチャット', path: '/chat', icon: MessageCircleQuestion },
]

export function Home() {
  const remaining = daysUntil(currentElection.votingDate)

  return (
    <div className="space-y-6">
      {/* ヒーロー：愛媛らしさを感じる控えめな装飾 */}
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
        <div className="relative">
          <div className="absolute inset-0">
            <SetouchiScene />
          </div>
          <div className="relative flex items-center gap-3 px-5 pb-10 pt-6">
            <Logo className="size-11" />
            <div>
              <h1 className="text-xl font-bold text-ink">えひめ投票ナビ</h1>
              <p className="mt-0.5 text-sm text-ink-soft">
                選挙をもっと身近に、もっとわかりやすく
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* メインの4ボタン（2列） */}
      <section aria-label="主な機能">
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          {MAIN_ACTIONS.map(({ label, description, path, icon: Icon }) => (
            <Link key={path} to={path} className="group">
              <Card
                interactive
                className="flex h-full flex-col items-start gap-3 p-4 md:p-5"
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-primary-light text-primary">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-base font-bold text-ink">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{description}</span>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* 選挙日程カード */}
      <section aria-label="選挙情報">
        <Link to="/schedule" className="block">
          <Card interactive className="p-5">
            <div className="mb-3 flex items-center gap-2 text-primary">
              <CalendarDays className="size-5" aria-hidden="true" />
              <span className="text-sm font-semibold">選挙情報</span>
              {currentElection.isDemo && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-faint">
                  デモ
                </span>
              )}
              <ChevronRight className="ml-auto size-5 text-ink-faint" aria-hidden="true" />
            </div>

            <p className="text-lg font-bold text-ink">{currentElection.name}</p>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="w-20 shrink-0 text-ink-soft">投票日</dt>
                <dd className="font-semibold text-ink">
                  {formatJpDate(currentElection.votingDate)}
                  {remaining !== null && (
                    <span className="ml-2 rounded-full bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent-dark">
                      {remaining === 0 ? '本日' : `あと${remaining}日`}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-20 shrink-0 text-ink-soft">期日前投票</dt>
                <dd className="font-semibold text-ink">
                  {formatShortDate(currentElection.earlyVotingStart)}〜
                  {formatShortDate(currentElection.earlyVotingEnd)}
                </dd>
              </div>
            </dl>
          </Card>
        </Link>
      </section>

      {/* 投票方法ガイド・リマインダーへの導線 */}
      <section aria-label="そのほかの案内" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <QuickLink
          to="/guide"
          icon={BookOpen}
          title="投票方法ガイド"
          description="はじめての方へ。投票の流れをやさしく解説します。"
        />
        <QuickLink
          to="/reminder"
          icon={Bell}
          title="投票日リマインダー"
          description="投票日を忘れないよう、お知らせを設定できます。"
        />
      </section>
    </div>
  )
}

function QuickLink({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <Link to={to} className="block">
      <Card interactive className="flex items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-light text-accent-dark">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-ink">{title}</span>
          <span className="block text-xs text-ink-soft">{description}</span>
        </span>
        <ChevronRight className="ml-auto size-5 shrink-0 text-ink-faint" aria-hidden="true" />
      </Card>
    </Link>
  )
}
