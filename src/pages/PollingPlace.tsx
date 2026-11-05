import { useState } from 'react'
import { MapPin, Search, Navigation, Clock, CalendarRange } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { LoadingState, EmptyState } from '../components/ui/States'
import { dayPollingPlaces, earlyPollingPlaces } from '../data/pollingPlaces'
import type { DayPollingPlace, EarlyPollingPlace } from '../data/types'
import { cn } from '../lib/cn'

type TabKey = 'day' | 'early'

export function PollingPlace() {
  const [tab, setTab] = useState<TabKey>('day')

  return (
    <div>
      <PageTitle
        title="投票所検索"
        description="当日投票所と期日前投票所を調べられます。"
      />

      {/* タブ切り替え */}
      <div
        className="mb-5 grid grid-cols-2 gap-1 rounded-[var(--radius-btn)] bg-surface p-1"
        role="tablist"
        aria-label="投票所の種類"
      >
        <TabButton active={tab === 'day'} onClick={() => setTab('day')}>
          当日投票
        </TabButton>
        <TabButton active={tab === 'early'} onClick={() => setTab('early')}>
          期日前投票
        </TabButton>
      </div>

      {tab === 'day' ? <DayVoting /> : <EarlyVoting />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-11 rounded-[calc(var(--radius-btn)-0.25rem)] text-sm font-semibold transition-colors',
        active ? 'bg-white text-primary shadow-sm' : 'text-ink-soft',
      )}
    >
      {children}
    </button>
  )
}

/* ---------------- 当日投票（地図・経路なし） ---------------- */
function DayVoting() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DayPollingPlace | null>(null)
  const [searched, setSearched] = useState(false)

  const handleSearch = () => {
    if (!address.trim()) return
    setLoading(true)
    setSearched(true)
    // デモ: 実際は住所から指定投票所を判定する（API差し替え箇所）
    setTimeout(() => {
      setResult(dayPollingPlaces[0])
      setLoading(false)
    }, 700)
  }

  return (
    <div>
      <Card className="p-4">
        <label htmlFor="addr" className="mb-1.5 block text-sm font-semibold text-ink">
          お住まいの住所
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="addr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="例: 松山市二番町4-7-2"
            className="h-12 w-full rounded-[var(--radius-btn)] border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
          />
          <Button
            onClick={handleSearch}
            disabled={!address.trim()}
            leftIcon={<Search className="size-5" />}
            className="sm:w-36 sm:shrink-0"
          >
            検索
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          住所に応じた指定の投票所をご案内します。
        </p>
      </Card>

      <div className="mt-4">
        {loading ? (
          <LoadingState label="投票所を検索中…" />
        ) : result ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 text-primary">
              <MapPin className="size-5" aria-hidden="true" />
              <span className="text-sm font-semibold">あなたの指定投票所</span>
            </div>
            <p className="text-lg font-bold text-ink">{result.name}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <InfoRow label="所在地" value={result.address} />
              <InfoRow label="投票時間" value={result.hours} />
            </dl>
          </Card>
        ) : searched ? (
          <EmptyState
            icon={<MapPin className="size-7" />}
            title="投票所が見つかりませんでした"
            description="住所を確認して、もう一度お試しください。"
          />
        ) : null}
      </div>
    </div>
  )
}

/* ---------------- 期日前投票（距離リスト） ---------------- */
function EarlyVoting() {
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<EarlyPollingPlace[] | null>(null)

  const handleLocate = () => {
    setLoading(true)
    // デモ: 実際は現在地を取得して近い順に並べる（API差し替え箇所）
    setTimeout(() => {
      setList([...earlyPollingPlaces].sort((a, b) => a.distanceKm - b.distanceKm))
      setLoading(false)
    }, 800)
  }

  return (
    <div>
      <Card className="p-4">
        <Button
          onClick={handleLocate}
          fullWidth
          size="lg"
          leftIcon={<Navigation className="size-5" />}
        >
          現在地から近い順に表示
        </Button>
        <p className="mt-2 text-center text-xs text-ink-faint">
          位置情報の取得を許可すると、近い投票所から表示します。
        </p>
      </Card>

      <div className="mt-4">
        {loading ? (
          <LoadingState label="近くの投票所を探しています…" />
        ) : list ? (
          list.length === 0 ? (
            <EmptyState title="近くに期日前投票所が見つかりません" />
          ) : (
            <ul className="space-y-3">
              {list.map((p) => (
                <li key={p.id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-bold text-ink">{p.name}</p>
                      <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-bold text-primary-dark">
                        約{p.distanceKm}km
                      </span>
                    </div>
                    <dl className="mt-2.5 space-y-1.5 text-sm">
                      <InfoRow label="所在地" value={p.address} icon={<MapPin className="size-4" />} />
                      <InfoRow
                        label="開設期間"
                        value={p.period}
                        icon={<CalendarRange className="size-4" />}
                      />
                      <InfoRow
                        label="受付時間"
                        value={p.hours}
                        icon={<Clock className="size-4" />}
                      />
                    </dl>
                  </Card>
                </li>
              ))}
            </ul>
          )
        ) : (
          <EmptyState
            icon={<Navigation className="size-7" />}
            title="現在地から投票所を探せます"
            description="上のボタンを押すと、近い順に一覧を表示します。"
          />
        )}
      </div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <dt className="flex w-20 shrink-0 items-center gap-1 text-ink-soft">
        {icon}
        {label}
      </dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}
