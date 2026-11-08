import type { ReactNode } from "react";

type BadgeTone = "neutral" | "primary";

type BadgeProps = Readonly<{
  children: ReactNode;
  /** neutral: 「準備中」「終了済み」などの状態。primary: 「AI要約」などの種別 */
  tone?: BadgeTone;
  id?: string;
}>;

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-soft",
  primary: "bg-primary text-white",
};

/**
 * 小さな状態・種別のラベル（見た目だけの部品）。
 * 候補者ごとに色を変える設定は持たせない。
 */
export function Badge({ children, tone = "neutral", id }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold leading-5 ${TONE_CLASS[tone]}`}
      id={id}
    >
      {children}
    </span>
  );
}
