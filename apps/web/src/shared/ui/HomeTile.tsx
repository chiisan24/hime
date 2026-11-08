import { useId } from "react";
import type { LucideIcon } from "lucide-react";

import { AppLink } from "../../app/navigation.js";
import { Badge } from "./Badge.js";

type HomeTileProps = Readonly<{
  to: string;
  /** リンクの名前。テストと読み上げで使うので、表示文字と同じにする */
  label: string;
  /** タイル上部の小さな問い（いつ？ など） */
  question: string;
  icon: LucideIcon;
  /** 行き先の中身がまだ準備中なら true */
  preparing: boolean;
}>;

const PREPARING_LABEL = "準備中";

/**
 * ホームの大きな機能タイル（見た目だけの部品）。
 * リンクの名前は label のみとし、問いと状態は説明（aria-describedby）として読み上げる。
 * 候補者ごとに色や大きさを変える設定は持たせない。
 */
export function HomeTile({ to, label, question, icon: Icon, preparing }: HomeTileProps) {
  const descriptionId = useId();

  return (
    <AppLink
      aria-describedby={descriptionId}
      aria-label={label}
      className="flex h-full min-h-40 min-w-11 flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-white px-3 py-4 text-center shadow-[var(--shadow-card)] transition hover:border-primary/50 hover:bg-primary-light/40"
      to={to}
    >
      <span className="text-xs font-bold text-ink-soft" id={descriptionId}>
        {question}
        {preparing ? <span className="sr-only">、{PREPARING_LABEL}</span> : null}
      </span>
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-light text-primary">
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <span className="text-base font-bold leading-snug text-ink">{label}</span>
      {preparing ? (
        <span aria-hidden="true" className="mt-auto">
          <Badge>{PREPARING_LABEL}</Badge>
        </span>
      ) : null}
    </AppLink>
  );
}
