import type { Level } from "../contractTypes.js";
import { LEVEL_ORDER } from "../labels.js";

type TradeoffPositionProps = Readonly<{
  level: Level;
  directionA: string;
  directionB: string;
}>;

/**
 * 優先条件の位置の印（飾り）。左端が方向A寄り（+2）、真ん中が「どちらも同じくらい大切」（0）、
 * 右端が方向B寄り（−2）。どちらの側も同じ色で描き、良い・悪いの印象を付けない。
 * 意味は、上に出す結果解説の文（固定文言）で伝えるため、この印は aria-hidden にする。
 */
export function TradeoffPosition({ level, directionA, directionB }: TradeoffPositionProps) {
  const position = LEVEL_ORDER.indexOf(level);
  return (
    <div aria-hidden="true" className="mt-2">
      <div className="flex gap-1">
        {LEVEL_ORDER.map((candidate, index) => (
          <span
            className={`flex h-6 flex-1 items-center justify-center rounded-md border text-[11px] font-bold ${
              index === position
                ? "border-primary bg-primary text-white"
                : "border-line bg-white text-ink-soft"
            }`}
            key={candidate}
          >
            {index === 0 ? "A" : index === LEVEL_ORDER.length - 1 ? "B" : index === 2 ? "＝" : ""}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs leading-5 text-ink-soft">
        <span>A：{directionA}</span>
        <span className="text-right">B：{directionB}</span>
      </div>
    </div>
  );
}
