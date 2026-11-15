import type { DilemmaAnswer } from "../uiTypes.js";
import { DILEMMA_SCALE } from "../demoDilemmas.js";

type IssuePositionProps = Readonly<{
  value: DilemmaAnswer | undefined;
}>;

/**
 * 地域課題マップの1行で、選んだ5段階の位置を示す帯（飾り。意味は横の文で伝えるため aria-hidden）。
 * 左端がA寄り、右端がB寄り。どちらの側も同じ色で描き、良い・悪いの印象を付けない。
 * スキップ・未回答は点線の帯にし、どの位置も塗らない（中央＝0点として描かない）。
 */
export function IssuePosition({ value }: IssuePositionProps) {
  const position = DILEMMA_SCALE.findIndex((option) => option.code === value);
  const hasAnswer = position >= 0;

  return (
    <div aria-hidden="true" className="mt-3">
      <div className="flex items-center gap-2">
        <span className="w-4 shrink-0 text-center text-xs font-black text-primary-dark">A</span>
        <div
          className={`grid flex-1 grid-cols-5 gap-1 rounded-lg p-1 ${
            hasAnswer ? "bg-surface" : "border border-dashed border-ink-soft/60"
          }`}
        >
          {DILEMMA_SCALE.map((option, index) => (
            <span
              className={`flex h-6 items-center justify-center rounded-md text-[11px] font-bold ${
                index === position
                  ? "bg-primary text-white"
                  : hasAnswer
                    ? "border border-line bg-white text-ink-soft"
                    : "text-ink-soft"
              }`}
              key={option.code}
            >
              {index === position ? "●" : index === 2 && hasAnswer ? "＝" : ""}
            </span>
          ))}
        </div>
        <span className="w-4 shrink-0 text-center text-xs font-black text-primary-dark">B</span>
      </div>
    </div>
  );
}
