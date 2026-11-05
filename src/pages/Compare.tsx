import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { Card } from '../components/ui/Card'
import { Avatar } from '../components/ui/Avatar'
import { AiSummaryLabel } from '../components/ui/AiSummaryLabel'
import { EmptyState } from '../components/ui/States'
import { candidates } from '../data/candidates'
import { policyThemes, themeLabel } from '../data/policyThemes'
import type { Candidate, CandidatePolicy } from '../data/types'
import { cn } from '../lib/cn'

export function Compare() {
  // 少なくとも1人の候補者が政策を持つテーマのみ選択肢にする
  const availableThemes = useMemo(
    () =>
      policyThemes.filter((t) =>
        candidates.some((c) => c.policies.some((p) => p.themeId === t.id)),
      ),
    [],
  )

  const [themeId, setThemeId] = useState(availableThemes[0]?.id ?? '')

  // 選択テーマについて、各候補者の政策を並べる
  const rows = useMemo(
    () =>
      candidates.map((c) => ({
        candidate: c,
        policy: c.policies.find((p) => p.themeId === themeId),
      })),
    [themeId],
  )

  return (
    <div>
      <PageTitle
        title="政策比較"
        description="テーマを選ぶと、候補者の政策を並べて比べられます。"
      />

      {/* テーマ選択（タブ）＋プルダウン補助 */}
      <div className="mb-5">
        <label className="mb-1.5 block text-sm font-semibold text-ink">比べるテーマ</label>
        {/* スマホ向けプルダウン */}
        <select
          value={themeId}
          onChange={(e) => setThemeId(e.target.value)}
          className="mb-3 h-12 w-full rounded-[var(--radius-btn)] border border-line bg-white px-3 text-[15px] text-ink focus:border-primary focus:outline-none sm:hidden"
        >
          {availableThemes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {/* タブ（sm以上） */}
        <div
          className="hidden flex-wrap gap-2 sm:flex"
          role="tablist"
          aria-label="比べるテーマ"
        >
          {availableThemes.map((t) => {
            const selected = t.id === themeId
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setThemeId(t.id)}
                className={cn(
                  'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  selected
                    ? 'bg-primary text-white'
                    : 'bg-surface text-ink-soft hover:bg-surface-2',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {availableThemes.length === 0 ? (
        <EmptyState title="比較できる政策がありません" />
      ) : (
        <>
          {/* 注記: 並び順は中立。優劣を示すものではない */}
          <p className="mb-3 text-xs text-ink-faint">
            ※ 表示順は候補者名簿の順です。優劣やおすすめを示すものではありません。
          </p>

          {/* スマホ: 候補者ごとの縦並びカード */}
          <div className="space-y-4 lg:hidden">
            {rows.map(({ candidate, policy }) => (
              <CompareCard key={candidate.id} candidate={candidate} policy={policy} />
            ))}
          </div>

          {/* PC: 比較表 */}
          <div className="hidden lg:block">
            <Card className="overflow-hidden p-0">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface">
                    <th className="w-56 px-4 py-3 text-sm font-semibold text-ink">候補者</th>
                    <th className="px-4 py-3 text-sm font-semibold text-ink">
                      AI政策要約（{themeLabel(themeId)}）
                    </th>
                    <th className="w-32 px-4 py-3 text-sm font-semibold text-ink">原文</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ candidate, policy }) => (
                    <tr key={candidate.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={candidate.name}
                            photoUrl={candidate.photoUrl}
                            className="size-11"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-ink">{candidate.name}</p>
                            <p className="text-xs text-ink-soft">{candidate.party}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {policy ? (
                          <p className="text-sm leading-relaxed text-ink-soft">{policy.aiSummary}</p>
                        ) : (
                          <p className="text-sm text-ink-faint">
                            このテーマの政策情報はありません。
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {policy?.sourceUrl ? (
                          <a
                            href={policy.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                          >
                            原文
                            <ExternalLink className="size-4" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="text-sm text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="mt-2 text-xs text-ink-faint">
              AI政策要約はAIが生成した要約です。詳しくは各原文をご確認ください。
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function CompareCard({
  candidate,
  policy,
}: {
  candidate: Candidate
  policy?: CandidatePolicy
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar name={candidate.name} photoUrl={candidate.photoUrl} className="size-12" />
        <div className="min-w-0">
          <p className="font-bold text-ink">{candidate.name}</p>
          <p className="text-xs text-ink-soft">{candidate.party}</p>
        </div>
      </div>

      <div className="mt-3">
        {policy ? (
          <>
            <AiSummaryLabel />
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{policy.aiSummary}</p>
            {policy.sourceUrl && (
              <a
                href={policy.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                {policy.sourceLabel ?? '原文を見る'}
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-faint">このテーマの政策情報はありません。</p>
        )}
      </div>
    </Card>
  )
}
