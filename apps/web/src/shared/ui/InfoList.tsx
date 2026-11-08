import type { ReactNode } from "react";

export type InfoListItem = Readonly<{
  label: string;
  value: ReactNode;
  /** 項目名の下に出す短い説明（専門用語の補足など） */
  note?: string;
}>;

type InfoListProps = Readonly<{
  items: readonly InfoListItem[];
}>;

/**
 * 「項目名：値」の一覧（見た目だけの部品）。
 * 置かれた枠の幅で並べ方を決める（コンテナクエリ）。
 * 枠が28rem未満なら項目名の下に値、28rem以上なら項目名を左・値を右に並べる。
 * 2列のカードの中など、画面幅が広くても枠が狭い場所で値が細く折り返さないようにするため。
 */
export function InfoList({ items }: InfoListProps) {
  return (
    <dl className="@container divide-y divide-line">
      {items.map((item) => (
        <div
          className="grid gap-1 py-3 first:pt-0 last:pb-0 @md:grid-cols-[10rem_1fr] @md:gap-4"
          key={item.label}
        >
          <dt className="text-sm font-bold text-ink-soft">
            {item.label}
            {item.note === undefined ? null : (
              <span className="mt-0.5 block text-xs font-normal leading-5">
                {item.note}
              </span>
            )}
          </dt>
          <dd className="min-w-0 break-words text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
