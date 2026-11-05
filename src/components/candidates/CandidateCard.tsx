import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { Candidate } from '../../data/types'
import { themeLabel } from '../../data/policyThemes'
import { Card } from '../ui/Card'
import { Tag } from '../ui/Tag'
import { Avatar } from '../ui/Avatar'
import { AiSummaryLabel } from '../ui/AiSummaryLabel'
import { Button } from '../ui/Button'

/**
 * 候補者カード（指示書 6）。
 * 全候補者で同一レイアウト・同一配色とし、強調の度合いを変えない。
 */
export function CandidateCard({ candidate }: { candidate: Candidate }) {
  const themes = candidate.mainThemeIds.slice(0, 3)

  return (
    <Card className="flex h-full flex-col p-4">
      {/* 顔写真・氏名を目立たせる */}
      <div className="flex items-center gap-3">
        <Avatar name={candidate.name} photoUrl={candidate.photoUrl} className="size-16" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{candidate.name}</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {candidate.party}・{candidate.age}歳
          </p>
        </div>
      </div>

      {/* 主な政策テーマ（小さなタグ、最大3つ） */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {themes.map((id) => (
          <Tag key={id}>{themeLabel(id)}</Tag>
        ))}
      </div>

      {/* AI政策要約 */}
      <div className="mt-3">
        <AiSummaryLabel />
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{candidate.aiSummary}</p>
      </div>

      {/* 詳細を見る */}
      <div className="mt-4 pt-1">
        <Link to={`/candidates/${candidate.id}`} className="block">
          <Button variant="outline" fullWidth rightIcon={<ChevronRight className="size-4" />}>
            詳細を見る
          </Button>
        </Link>
      </div>
    </Card>
  )
}
