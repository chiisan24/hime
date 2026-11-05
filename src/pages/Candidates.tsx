import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { PageTitle } from '../components/ui/PageTitle'
import { SearchInput } from '../components/ui/SearchInput'
import { CandidateCard } from '../components/candidates/CandidateCard'
import { EmptyState } from '../components/ui/States'
import { candidates } from '../data/candidates'
import { themeLabel } from '../data/policyThemes'

export function Candidates() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => {
      const haystack = [
        c.name,
        c.kana ?? '',
        c.party,
        ...c.mainThemeIds.map(themeLabel),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [query])

  return (
    <div>
      <PageTitle
        title="候補者一覧"
        description="立候補者の横顔と政策をチェックできます。"
      />

      {/* 検索欄は画面上部に配置 */}
      <div className="mb-5">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="氏名・政党・政策で検索"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="該当する候補者が見つかりません"
          description="検索語を変えてお試しください。"
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-soft">{filtered.length}名の候補者</p>
          {/* スマホは縦並び、PCは画面幅に応じて2〜3列 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <CandidateCard key={c.id} candidate={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
