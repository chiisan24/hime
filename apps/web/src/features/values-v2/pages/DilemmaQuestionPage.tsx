import { ArrowLeft, ArrowRight, Info, SkipForward } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { ConfirmDialog } from "../../values/components/ConfirmDialog.js";
import type { TradeoffCode } from "../../values/contractTypes.js";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, TEXT_BUTTON_CLASS } from "../../values/styles.js";
import { THEME_ICONS } from "../../values/themeIcons.js";
import { useHeadingFocus } from "../../values/useHeadingFocus.js";
import { DilemmaScale } from "../components/DilemmaScale.js";
import { DILEMMA_PROMPT } from "../demoDilemmas.js";
import type { DilemmaAnswer, UiDilemmaQuestion } from "../uiTypes.js";

type DilemmaQuestionPageProps = Readonly<{
  question: UiDilemmaQuestion;
  /** 1始まりの問番号と全問数 */
  position: number;
  total: number;
  answer: DilemmaAnswer | undefined;
  onAnswer: (questionId: string, code: TradeoffCode) => void;
  /** スキップして次へ（最後の問では結果へ） */
  onSkip: (questionId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onQuit: () => void;
}>;

/**
 * v2 の質問画面。1画面に1問。状況文、考え方A・B、5段階、スキップ、前後の移動、進捗を出す。
 * 5段階を選んだだけでは進まず、「次の質問へ」で進む。スキップはその場で次へ進む。
 */
export function DilemmaQuestionPage({
  question,
  position,
  total,
  answer,
  onAnswer,
  onSkip,
  onPrevious,
  onNext,
  onQuit,
}: DilemmaQuestionPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>(question.questionId, true);
  const hintId = useId();
  const optionsId = useId();
  const [quitDialogOpen, setQuitDialogOpen] = useState(false);
  const ThemeIcon = THEME_ICONS[question.themeId];
  const isFirst = position <= 1;
  const isLast = position >= total;
  const decided = answer !== undefined;
  const skipped = answer === "SKIPPED";

  const handleNext = () => {
    if (!decided) {
      return;
    }
    onNext();
  };

  return (
    <section
      aria-label={`質問 ${total}問中${position}問目`}
      className="mx-auto max-w-[44rem] rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-primary-light px-3 text-sm font-bold text-primary-dark">
          <ThemeIcon aria-hidden="true" className="size-4 shrink-0" />
          {question.themeLabel}
        </p>
        <p className="text-sm font-bold text-ink-soft">
          {total}問中 <span className="text-lg text-primary-dark">{position}</span>問目
        </p>
      </div>
      <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${(position / Math.max(1, total)) * 100}%` }}
        />
      </div>

      {question.isDemo ? (
        <div className="mt-4">
          <Badge>デモ用の仮の質問</Badge>
        </div>
      ) : null}
      <h1
        className="mt-2 text-xl font-bold leading-8 text-ink outline-none"
        ref={headingRef}
        tabIndex={-1}
      >
        {question.situation}
      </h1>
      <p className="mt-1 text-sm font-bold leading-6 text-ink-soft">{DILEMMA_PROMPT}</p>

      {/* 考え方A・B（左右に並べ、5段階の両端と向きをそろえる） */}
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:gap-3" id={optionsId} role="list">
        {(
          [
            ["A", question.optionA.text],
            ["B", question.optionB.text],
          ] as const
        ).map(([side, text]) => (
          <li
            className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-btn)] border-2 border-line bg-white p-3"
            key={side}
          >
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-full border-2 border-primary-dark font-black text-primary-dark"
            >
              {side}
            </span>
            <span className="min-w-0 text-sm leading-6 text-ink">
              <span className="sr-only">考え方{side}：</span>
              {text}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <DilemmaScale
          describedBy={optionsId}
          name={`dilemma-${question.questionId}`}
          onChange={(code) => onAnswer(question.questionId, code)}
          optionAText={question.optionA.text}
          optionBText={question.optionB.text}
          value={answer}
        />
      </div>

      {skipped ? (
        <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm leading-6 text-ink" role="status">
          この質問はスキップしました。5段階から選ぶと、回答に置き換わります。
        </p>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        {decided ? null : (
          <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-soft" id={hintId}>
            <Info aria-hidden="true" className="size-4 shrink-0 text-primary" />
            5段階から選ぶか、スキップしてください
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className={SECONDARY_BUTTON_CLASS} disabled={isFirst} onClick={onPrevious} type="button">
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            前の質問へ
          </button>
          <button
            aria-describedby={decided ? undefined : hintId}
            aria-disabled={decided ? undefined : true}
            className={PRIMARY_BUTTON_CLASS}
            onClick={handleNext}
            type="button"
          >
            {isLast ? "結果を見る" : "次の質問へ"}
            <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button className={SECONDARY_BUTTON_CLASS} onClick={() => onSkip(question.questionId)} type="button">
            <SkipForward aria-hidden="true" className="size-4 shrink-0" />
            スキップ
          </button>
          <button className={TEXT_BUTTON_CLASS} onClick={() => setQuitDialogOpen(true)} type="button">
            診断をやめる
          </button>
        </div>
      </div>

      <ConfirmDialog
        cancelLabel="質問に戻る"
        confirmLabel="回答を消してやめる"
        onCancel={() => setQuitDialogOpen(false)}
        onConfirm={() => {
          setQuitDialogOpen(false);
          onQuit();
        }}
        open={quitDialogOpen}
        title="診断をやめますか？"
      >
        ここまでの回答は消えて、診断の最初の画面に戻ります。
      </ConfirmDialog>
    </section>
  );
}
