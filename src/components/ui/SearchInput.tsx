import { Search, X } from 'lucide-react'

/** 画面上部に置く検索入力欄（指示書 6：検索欄を画面上部に配置） */
export function SearchInput({
  value,
  onChange,
  placeholder = '検索',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-faint"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-12 w-full rounded-[var(--radius-btn)] border border-line bg-white pl-11 pr-11 text-[15px] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="検索語を消す"
          className="absolute right-2.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-faint hover:bg-surface"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
