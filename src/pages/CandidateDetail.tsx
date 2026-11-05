import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, ExternalLink, FileText } from 'lucide-react'
import { getCandidateById } from '../data/candidates'
import { themeLabel } from '../data/policyThemes'
import { Card } from '../components/ui/Card'
import { Tag } from '../components/ui/Tag'
import { Avatar } from '../components/ui/Avatar'
import { AiSummaryLabel } from '../components/ui/AiSummaryLabel'
import { EmptyState } from '../components/ui/States'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/cn'

export function CandidateDetail() {
  const { id } = useParams()
  const candidate = id ? getCandidateById(id) : undefined
  const [activeTheme, setActiveTheme] = useState(candidate?.policies[0]?.themeId ?? '')

  if (!candidate) {
    return (
      <div>
        <BackLink />
        <EmptyState
          title="候補者が見つかりません"
          description="一覧から選び直してください。"
        />
      </div>
    )
  }

  const activePolicy =
    candidate.policies.find((p) => p.themeId === activeTheme) ?? candidate.policies[0]

  return (
    <div className="space-y-5">
      <BackLink />

      {/* プロフィールヘッダー */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <Avatar name={candidate.name} photoUrl={candidate.photoUrl} className="size-20" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink md:text-2xl">{candidate.name}</h1>
            {candidate.kana && (
              <p className="text-xs text-ink-faint">{candidate.kana}</p>
            )}
            <p className="mt-1 text-sm text-ink-soft">
              {candidate.party}・{candidate.age}歳
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.mainThemeIds.map((t) => (
                <Tag key={t}>{themeLabel(t)}</Tag>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* AI政策要約（全体） */}
      <Card className="p-5">
        <AiSummaryLabel />
        <p className="mt-2 leading-relaxed text-ink-soft">{candidate.aiSummary}</p>
      </Card>

      {/* プロフィール・経歴 */}
      {(candidate.profile || candidate.career?.length) && (
        <Card className="p-5">
          <h2 className="mb-2 text-base font-bold text-ink">プロフィール・経歴</h2>
          {candidate.profile && (
            <p className="leading-relaxed text-ink-soft">{candidate.profile}</p>
          )}
          {candidate.career && candidate.career.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {candidate.career.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-ink-soft">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/50" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 主な政策（テーマ別タブ） */}
      <section>
        <h2 className="mb-3 text-base font-bold text-ink">主な政策</h2>

        {/* テーマタブ */}
        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="政策テーマ"
        >
          {candidate.policies.map((p) => {
            const selected = p.themeId === activePolicy?.themeId
            return (
              <button
                key={p.themeId}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTheme(p.themeId)}
                className={cn(
                  'shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  selected
                    ? 'bg-primary text-white'
                    : 'bg-surface text-ink-soft hover:bg-surface-2',
                )}
              >
                {themeLabel(p.themeId)}
              </button>
            )
          })}
        </div>

        {activePolicy && (
          <Card className="p-5" role="tabpanel">
            {/* AI要約 */}
            <AiSummaryLabel />
            <p className="mt-2 leading-relaxed text-ink">{activePolicy.aiSummary}</p>

            {/* 政策の原文 */}
            <div className="mt-4 rounded-[var(--radius-btn)] bg-surface p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                <FileText className="size-4" aria-hidden="true" />
                政策の原文
              </div>
              <p className="text-sm leading-relaxed text-ink-soft">
                {activePolicy.originalText}
              </p>
            </div>

            {/* 出典 */}
            {activePolicy.sourceUrl && (
              <a
                href={activePolicy.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                {activePolicy.sourceLabel ?? '出典を見る'}
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            )}
          </Card>
        )}
      </section>

      <div className="pt-1">
        <Link to="/compare">
          <Button variant="ghost">他の候補者と政策を比較する →</Button>
        </Link>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/candidates"
      className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-primary"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      候補者一覧へ戻る
    </Link>
  )
}
