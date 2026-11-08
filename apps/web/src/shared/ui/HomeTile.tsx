import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { AppLink } from "../../app/navigation.js";
import { Badge } from "./Badge.js";

type HomeTileProps = Readonly<{
  to: string;
  /** リンクの名前（読み上げとテストで使う）。画面に出す title の文字を含める（WCAG 2.5.3） */
  label: string;
  /** 画面に出す短い名前 */
  title: string;
  /** 名前の下に出す一言の説明 */
  description: string;
  icon: LucideIcon;
  /** 行き先の中身がまだ準備中なら true */
  preparing: boolean;
  /** カードの下に並べる追加のリンク（候補者ごとの詳細など）。ある場合はカード全体ではなく上部がリンクになる */
  subLinks?: ReactNode;
}>;

const PREPARING_LABEL = "準備中";

const CARD_CLASS =
  "flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)] transition";
const BODY_CLASS = "flex flex-col items-center gap-1.5 px-3 py-3 text-center";
/** 押せることが分かる反応（ホバーで枠と影、タップで背景） */
const PRESS_CLASS = "hover:border-primary hover:shadow-md active:bg-primary-light";

/**
 * ホームの大きな機能カード（見た目だけの部品）。
 * どのカードも同じ寸法・配色で、候補者ごとに色や大きさを変える設定は持たせない。
 */
export function HomeTile({
  to,
  label,
  title,
  description,
  icon: Icon,
  preparing,
  subLinks,
}: HomeTileProps) {
  const descriptionId = useId();

  const body = (
    <>
      <span className="grid size-12 place-items-center rounded-2xl bg-primary-light text-primary">
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <span className="text-base font-bold leading-snug text-primary-dark md:text-lg">
        {title}
      </span>
      <span className="text-xs leading-5 text-ink-soft" id={descriptionId}>
        {description}
        {preparing ? <span className="sr-only">、{PREPARING_LABEL}</span> : null}
      </span>
      {preparing ? (
        <span aria-hidden="true" className="mt-auto">
          <Badge>{PREPARING_LABEL}</Badge>
        </span>
      ) : null}
    </>
  );

  if (subLinks === undefined) {
    return (
      <AppLink
        aria-describedby={descriptionId}
        aria-label={label}
        className={`${CARD_CLASS} ${BODY_CLASS} ${PRESS_CLASS} min-h-11 min-w-11`}
        to={to}
      >
        {body}
      </AppLink>
    );
  }

  return (
    <div className={`${CARD_CLASS} hover:border-primary/60`}>
      <AppLink
        aria-describedby={descriptionId}
        aria-label={label}
        className={`${BODY_CLASS} min-h-11 min-w-11 flex-1 rounded-t-[var(--radius-card)] hover:bg-primary-light/50 active:bg-primary-light`}
        to={to}
      >
        {body}
      </AppLink>
      <div className="border-t border-line p-2">{subLinks}</div>
    </div>
  );
}
