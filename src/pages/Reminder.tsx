import { useState } from 'react'
import { Bell, Check } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { currentElection } from '../data/election'
import { formatJpDate } from '../lib/date'
import { cn } from '../lib/cn'

const TIMING_OPTIONS = [
  { id: 'd7', label: '1週間前' },
  { id: 'd3', label: '3日前' },
  { id: 'd1', label: '前日' },
  { id: 'd0', label: '当日の朝' },
]

export function Reminder() {
  const [selected, setSelected] = useState<string[]>(['d1', 'd0'])
  const [saved, setSaved] = useState(false)

  const toggle = (id: string) => {
    setSaved(false)
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <div className="space-y-5">
      <PageTitle
        title="投票日リマインダー"
        description="投票日を忘れないよう、お知らせのタイミングを選べます。"
      />

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-light text-accent-dark">
            <Bell className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-ink">{currentElection.name}</p>
            <p className="text-sm text-ink-soft">
              投票日：{formatJpDate(currentElection.votingDate)}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-bold text-ink">お知らせのタイミング</h2>
        <div className="grid grid-cols-2 gap-3">
          {TIMING_OPTIONS.map((opt) => {
            const on = selected.includes(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(opt.id)}
                className={cn(
                  'flex items-center justify-between rounded-[var(--radius-btn)] border px-4 py-3 text-sm font-semibold transition-colors',
                  on
                    ? 'border-primary bg-primary-light text-primary-dark'
                    : 'border-line bg-white text-ink-soft hover:bg-surface',
                )}
              >
                {opt.label}
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded-full border',
                    on ? 'border-primary bg-primary text-white' : 'border-line text-transparent',
                  )}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <div className="space-y-2">
        <Button
          fullWidth
          size="lg"
          disabled={selected.length === 0}
          onClick={() => setSaved(true)}
        >
          この内容でリマインダーを設定
        </Button>
        {saved && (
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-primary">
            <Check className="size-4" aria-hidden="true" />
            リマインダーを設定しました（デモ）。
          </p>
        )}
        <p className="text-center text-xs text-ink-faint">
          ※ デモ版です。実際の通知機能は今後対応予定です。
        </p>
      </div>
    </div>
  )
}
