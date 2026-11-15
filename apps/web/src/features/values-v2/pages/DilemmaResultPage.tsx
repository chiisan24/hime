import { ListChecks, Map as MapIcon, Radar, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { ConfirmDialog } from "../../values/components/ConfirmDialog.js";
import { SECONDARY_BUTTON_CLASS, TEXT_BUTTON_CLASS } from "../../values/styles.js";
import { THEME_ICONS } from "../../values/themeIcons.js";
import { useHeadingFocus } from "../../values/useHeadingFocus.js";
import { IssuePosition } from "../components/IssuePosition.js";
import { DILEMMA_PROMPT, DILEMMA_SCALE } from "../demoDilemmas.js";
import type { DilemmaAnswer, DilemmaAnswers, UiDilemmaQuestion } from "../uiTypes.js";
import { summarizeDilemmaAnswers } from "../useDilemmaAnswers.js";

type DilemmaResultPageProps = Readonly<{
  questions: readonly UiDilemmaQuestion[];
  answers: DilemmaAnswers;
  isDemo: boolean;
  /** 指定した問い（0始まり）に戻って答え直す。回答は残す */
  onEdit: (index: number) => void;
  /** 回答を消して、1問目からやり直す */
  onRestart: () => void;
}>;

/** 回答の振り返りの文。回答の事実だけを述べ、性格や思想を推測しない */
function reflectionOf(answer: DilemmaAnswer | undefined): string {
  if (answer === undefined) {
    return "未回答です（回答なし）。";
  }
  if (answer === "SKIPPED") {
    return "スキップしました（回答なし）。";
  }
  const label = DILEMMA_SCALE.find((option) => option.code === answer)?.label ?? "";
  return `「${label}」を選びました。`;
}

/**
 * v2 の結果画面。中心は地域課題マップ（1問＝1行）。
 * テーマの回答を合算せず、スキップ・未回答は「回答なし」として0点に変えない。
 * 判断に迷った・回答しなかった・判定できない・未出題の4枚のカードは置かず、回答状況を1行にまとめる。
 */
export function DilemmaResultPage({ questions, answers, isDemo, onEdit, onRestart }: DilemmaResultPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("dilemma-result", true);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const summary = summarizeDilemmaAnswers(questions, answers);

  const statusParts = [
    summary.skipped > 0 ? `スキップ ${summary.skipped}問` : null,
    summary.unanswered > 0 ? `未回答 ${summary.unanswered}問` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="grid gap-4 md:gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="text-2xl font-black leading-tight tracking-tight text-primary-dark outline-none sm:text-3xl"
            ref={headingRef}
            tabIndex={-1}
          >
            あなたの地域課題マップ
          </h1>
          {isDemo ? <Badge>デモ版</Badge> : null}
        </div>
        <NoticeBar>
          この結果は、自己理解のための参考です。投票先の推奨ではありません。性格や政治思想を判定するものでもありません。
        </NoticeBar>
        <p className="text-base font-bold text-ink" role="status">
          {summary.total}問中{summary.answered}問に回答しました
          {statusParts.length > 0 ? (
            <span className="font-normal text-ink-soft">（{statusParts.join("、")}）</span>
          ) : null}
        </p>
      </div>

      <SectionCard icon={MapIcon} title="地域課題マップ">
        <p className="mb-4 text-sm leading-6 text-ink-soft">
          地域課題ごとに、2つの考え方のどちらをどのくらい重視したかを示します。テーマの回答は合計していません。帯の位置は順位や点数ではありません。
        </p>
        <ol className="grid gap-3 lg:grid-cols-2" role="list">
          {questions.map((question, index) => {
            const answer = answers[question.questionId];
            const Icon = THEME_ICONS[question.themeId];
            const level = DILEMMA_SCALE.findIndex((option) => option.code === answer);
            return (
              <li
                className="rounded-[var(--radius-btn)] border border-line bg-white p-4"
                data-answer={answer ?? "UNANSWERED"}
                data-position={level >= 0 ? String(level) : "none"}
                data-question-id={question.questionId}
                key={question.questionId}
              >
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-primary-dark">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  {question.themeLabel}
                </h3>
                <p className="mt-1 text-sm leading-6 text-ink">{question.situation}</p>
                <p className="sr-only">{DILEMMA_PROMPT}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs leading-5">
                  <div className="rounded-lg bg-surface p-2">
                    <dt className="font-black text-primary-dark">A</dt>
                    <dd className="text-ink">{question.optionA.text}</dd>
                  </div>
                  <div className="rounded-lg bg-surface p-2">
                    <dt className="font-black text-primary-dark">B</dt>
                    <dd className="text-ink">{question.optionB.text}</dd>
                  </div>
                </dl>
                <IssuePosition value={answer} />
                <p className="mt-2 text-sm font-bold leading-6 text-ink">
                  <span className="font-normal text-ink-soft">回答の振り返り：</span>
                  {reflectionOf(answer)}
                </p>
                <button
                  className={`${TEXT_BUTTON_CLASS} mt-1 -ml-3`}
                  onClick={() => onEdit(index)}
                  type="button"
                >
                  <Undo2 aria-hidden="true" className="size-4 shrink-0" />
                  この質問に答え直す
                  <span className="sr-only">（{question.themeLabel}）</span>
                </button>
              </li>
            );
          })}
        </ol>
      </SectionCard>

      <SectionCard aside={<Badge>準備中</Badge>} icon={Radar} title="価値観レーダー">
        <p className="text-sm leading-6 text-ink-soft">
          回答をもとに、考え方の傾きを図にする機能を準備しています。考え方の軸の定義と計算方法が決まってから表示します。今は、回答から計算した値はありません。
        </p>
      </SectionCard>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button className={SECONDARY_BUTTON_CLASS} onClick={() => onEdit(0)} type="button">
          <ListChecks aria-hidden="true" className="size-4 shrink-0" />
          回答を見直す
        </button>
        <button className={SECONDARY_BUTTON_CLASS} onClick={() => setRestartDialogOpen(true)} type="button">
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          最初からやり直す
        </button>
      </div>

      <ConfirmDialog
        cancelLabel="結果に戻る"
        confirmLabel="回答を消して最初から"
        onCancel={() => setRestartDialogOpen(false)}
        onConfirm={() => {
          setRestartDialogOpen(false);
          onRestart();
        }}
        open={restartDialogOpen}
        title="最初からやり直しますか？"
      >
        今の回答は消えて、1問目に戻ります。回答を変えたいだけなら「この質問に答え直す」を使ってください。
      </ConfirmDialog>
    </div>
  );
}
