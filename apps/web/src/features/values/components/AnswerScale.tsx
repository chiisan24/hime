import { useId, type ChangeEvent } from "react";

import type { AnswerValue } from "../contractTypes.js";
import type { AnswerOption, SelectableCode } from "../questionView.js";

type AnswerScaleProps = Readonly<{
  /** ラジオボタンのまとまりの名前（質問ごとに変える） */
  name: string;
  /** 表示順の7つの選択肢（5段階、わからない、回答しない） */
  options: readonly AnswerOption[];
  value: AnswerValue | undefined;
  onChange: (code: SelectableCode) => void;
  /** 選択肢のまとまりの説明（優先条件の前提文と方向の説明など）を指す id */
  describedBy?: string | undefined;
}>;

const OPTION_CLASS = [
  "flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-btn)] border border-line bg-white px-4 py-2 text-ink transition",
  "hover:border-primary/60",
  // 選んだ選択肢：太い枠＋薄い青の塗り＋太い文字（色だけに頼らない。Req 11.4）
  "has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-light has-[:checked]:font-bold has-[:checked]:text-primary-dark",
].join(" ");

/**
 * 回答の選択肢（C-04）。大切さ質問と優先条件質問の両方で使う。
 * - 「わからない」「回答しない」も、意見の選択肢と同じ幅・高さ・文字の大きさ・強調で並べる（Req 2.6）。
 * - ネイティブのラジオボタンで、矢印キーで選べる。選んでも次の質問へは進まない。
 * - 「回答しない」を選んでも、理由の入力欄や確認ダイアログを出さない（Req 2.6）。
 */
export function AnswerScale({ name, options, value, onChange, describedBy }: AnswerScaleProps) {
  const legendId = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const option = options.find((candidate) => candidate.code === event.target.value);
    if (option !== undefined) {
      onChange(option.code);
    }
  };

  return (
    <fieldset aria-describedby={describedBy} aria-labelledby={legendId} className="min-w-0">
      <legend className="sr-only" id={legendId}>
        回答を1つ選んでください
      </legend>
      <ul className="grid gap-2" role="list">
        {options.map((option) => (
          <li key={option.code}>
            <label className={OPTION_CLASS}>
              <input
                checked={value === option.code}
                className="size-5 shrink-0 accent-primary"
                name={name}
                onChange={handleChange}
                type="radio"
                value={option.code}
              />
              <span className="min-w-0">{option.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
