import { Link } from 'react-router-dom'
import { CalendarDays, Vote, Clock3, Bell } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { currentElection } from '../data/election'
import { formatJpDate, formatShortDate, daysUntil } from '../lib/date'

export function Schedule() {
  const remaining = daysUntil(currentElection.votingDate)

  return (
    <div className="space-y-5">
      <PageTitle title="投票日・選挙日程" description="いまの選挙の日程をまとめています。" />

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <CalendarDays className="size-5" aria-hidden="true" />
          <span className="text-sm font-semibold">選挙情報</span>
          {currentElection.isDemo && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-faint">
              デモ
            </span>
          )}
        </div>
        <p className="text-xl font-bold text-ink">{currentElection.name}</p>
        {remaining !== null && (
          <p className="mt-2 inline-block rounded-full bg-accent-light px-3 py-1 text-sm font-bold text-accent-dark">
            投票日まで {remaining === 0 ? '本日' : `あと${remaining}日`}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-ink">
            <Vote className="size-5 text-primary" aria-hidden="true" />
            <h2 className="font-bold">投票日（当日）</h2>
          </div>
          <p className="text-lg font-bold text-ink">
            {formatJpDate(currentElection.votingDate)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-sm text-ink-soft">
            <Clock3 className="size-4" aria-hidden="true" />
            7:00〜20:00（投票所により異なります）
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-ink">
            <Clock3 className="size-5 text-primary" aria-hidden="true" />
            <h2 className="font-bold">期日前投票</h2>
          </div>
          <p className="text-lg font-bold text-ink">
            {formatShortDate(currentElection.earlyVotingStart)}〜
            {formatShortDate(currentElection.earlyVotingEnd)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">投票日に都合がつかない方はこちら。</p>
        </Card>
      </div>

      <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-light text-accent-dark">
            <Bell className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-ink">投票日を忘れないように</p>
            <p className="text-sm text-ink-soft">リマインダーを設定できます。</p>
          </div>
        </div>
        <Link to="/reminder" className="w-full sm:w-auto">
          <Button variant="outline" fullWidth>
            リマインダー設定へ
          </Button>
        </Link>
      </Card>
    </div>
  )
}
