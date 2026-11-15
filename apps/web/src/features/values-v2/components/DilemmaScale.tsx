import { Check } from "lucide-react";
import { useId, type ChangeEvent } from "react";

import type { TradeoffCode } from "../../values/contractTypes.js";
import { DILEMMA_SCALE } from "../demoDilemmas.js";
import type { DilemmaAnswer } from "../uiTypes.js";

type DilemmaScaleProps = Readonly<{
  /** ラジオボタンのまとまりの名前（質問ごとに変える） */
  name: string;
  value: DilemmaAnswer | undefined;
  optionAText: string;
  optionBText: string;
  onChange: (code: TradeoffCode) => void;
  /** A・Bの説明のまとまりを指す id */
  describedBy?: string | undefined;
}>;

/** 「Aを強く重視」→「Aを」「強く重視」。「同程度」はそのまま */
function splitLabel(label: string): readonly string[] {
  const index = label.indexOf("を");
  return index < 0 ? [label] : [label.slice(0, index + 1), label.slice(index + 1)];
}

/**
 * 5段階の回答（スライダーのように見える横並びの選択）。
 * - 中身は5つのネイティブのラジオボタン。矢印キーで選べ、読み上げでは「Aを強く重視：（Aの文）」のように読む。
 * - 初期状態はどれも選ばれていない。中央の「同程度」を自動で選ばない。
 * - 選んだ位置は、塗りの丸・チェックの印・太い文字で示す（色だけに頼らない）。
 * - 選んでも次の質問へは進まない。
 */
export function DilemmaScale({
  name,
  value,
  optionAText,
  optionBText,
  onChange,
  describedBy,
}: DilemmaScaleProps) {
  const legendId = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const option = DILEMMA_SCALE.find((candidate) => candidate.code === event.target.value);
    if (option !== undefined) {
      onChange(option.code);
    }
  };

  const spokenLabel = (code: TradeoffCode, label: string): string => {
    if (code === "BALANCED") {
      return `${label}：AとBを同じくらい重視`;
    }
    return code.startsWith("A_") ? `${label}：${optionAText}` : `${label}：${optionBText}`;
  };

  return (
    <fieldset aria-describedby={describedBy} aria-labelledby={legendId} className="min-w-0">
      <legend className="sr-only" id={legendId}>
        AとBのどちらを重視するか、5段階で選んでください
      </legend>
      <div className="relative">
        {/* 丸と丸を結ぶ線（飾り） */}
        <span
          aria-hidden="true"
          className="absolute left-[10%] right-[10%] top-[26px] h-1 rounded-full bg-surface-2"
        />
        <ul className="relative grid grid-cols-5" role="list">
          {DILEMMA_SCALE.map((option) => (
            <li className="min-w-0" key={option.code}>
              <label className="group flex min-h-[92px] cursor-pointer flex-col items-center gap-1.5 px-0.5 pt-1 text-center">
                <input
                  aria-label={spokenLabel(option.code, option.label)}
                  checked={value === option.code}
                  className="peer sr-only"
                  name={name}
                  onChange={handleChange}
                  type="radio"
                  value={option.code}
                />
                <span
                  aria-hidden="true"
                  className="flex size-11 items-center justify-center rounded-full border-2 border-line bg-white transition group-hover:border-primary/60 peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-4 peer-focus-visible:ring-primary/40"
                >
                  <Check className="size-5 text-white opacity-0 group-has-[:checked]:opacity-100" />
                </span>
                <span className="text-xs leading-4 text-ink-soft group-has-[:checked]:font-bold group-has-[:checked]:text-primary-dark">
                  {/* 375px で「Aを強く重／視」と途中で折れないよう、「を」の後ろで改行する */}
                  {splitLabel(option.label).map((part) => (
                    <span className="block" key={part}>
                      {part}
                    </span>
                  ))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </fieldset>
  );
}
