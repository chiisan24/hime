import { Compass, ListChecks, Map as MapIcon, Radar, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { ConfirmDialog } from "../../values/components/ConfirmDialog.js";
import { SECONDARY_BUTTON_CLASS, TEXT_BUTTON_CLASS } from "../../values/styles.js";
import { THEME_ICONS } from "../../values/themeIcons.js";
import { useHeadingFocus } from "../../values/useHeadingFocus.js";
import { analyzeValueAxes, SAMPLE_AXIS_VALUES, traceAxisAnswers } from "../axisAnalysis.js";
import { IssuePosition } from "../components/IssuePosition.js";
import { ValueAxisRadar } from "../components/ValueAxisRadar.js";
import { DILEMMA_PROMPT, DILEMMA_SCALE, UI_VALUE_AXES } from "../demoDilemmas.js";
import type {
  DilemmaAnswer,
  DilemmaAnswers,
  UiAxisAnalyzer,
  UiDilemmaQuestion,
  UiValueAxis,
} from "../uiTypes.js";
import { summarizeDilemmaAnswers } from "../useDilemmaAnswers.js";

type DilemmaResultPageProps = Readonly<{
  questions: readonly UiDilemmaQuestion[];
  answers: DilemmaAnswers;
  isDemo: boolean;
  /** 指定した問い（0始まり）に戻って答え直す。回答は残す */
  onEdit: (index: number) => void;
  /** 回答を消して、1問目からやり直す */
  onRestart: () => void;
  /** 価値観の6軸（この順番で描く。値の大きい順に並べ替えない） */
  axes?: readonly UiValueAxis[];
  /** 回答から価値観6軸を分析する関数。計算方法が未確定のため、既定は PENDING を返す（axisAnalysis.ts） */
  analyzeAxes?: UiAxisAnalyzer;
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

/** 軸の説明に出す、その質問への回答の短い表示。スキップと未回答は「回答なし」とし、0点や中立にしない */
function answerLabelOf(answer: DilemmaAnswer | undefined): string {
  if (answer === undefined) {
    return "未回答（回答なし）";
  }
  if (answer === "SKIPPED") {
    return "スキップ（回答なし）";
  }
  return DILEMMA_SCALE.find((option) => option.code === answer)?.label ?? "";
}

/**
 * v2 の結果画面。上から、見出し → 価値観レーダー → 6つの考え方（軸の説明と、回答との対応）
 * → 地域課題ごとの回答の振り返り（地域課題マップ。1問＝1行）→ 答え直しとやり直しの操作。
 * テーマの回答を合算せず、順位も付けない。スキップ・未回答は「回答なし」として0点に変えない。
 * 判断に迷った・回答しなかった・判定できない・未出題の4枚のカードは置かず、回答状況を1行にまとめる。
 *
 * レーダーの値は analyzeAxes が返す。計算方法が未確定のあいだは PENDING が返り、
 * レーダーは見本の値のサンプル表示にして、あなたの回答の分析結果ではないことを示す。
 */
export function DilemmaResultPage({
  questions,
  answers,
  isDemo,
  onEdit,
  onRestart,
  axes = UI_VALUE_AXES,
  analyzeAxes = analyzeValueAxes,
}: DilemmaResultPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>("dilemma-result", true);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const summary = summarizeDilemmaAnswers(questions, answers);
  const analysis = analyzeAxes({ questions, axes, answers });
  const traces = traceAxisAnswers(questions, axes, answers);
  const axisLabels = new Map(axes.map((axis) => [axis.axisId, axis.label]));

  const statusParts = [
    summary.skipped > 0 ? `スキップ ${summary.skipped}問` : null,
    summary.unanswered > 0 ? `未回答 ${summary.unanswered}問` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="grid gap-4 md:gap-6">
      {/* 1. 診断結果の見出し */}
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

      {/* 2. 六角形の価値観レーダー */}
      <SectionCard
        aside={analysis.status === "PENDING" ? <Badge tone="primary">サンプル表示</Badge> : null}
        icon={Radar}
        title="価値観レーダー"
      >
        {analysis.status === "PENDING" ? (
          <NoticeBar className="mb-4">
            回答から価値観の傾きを計算する方法は、まだ決まっていません（準備中）。下の図は表示の見本（サンプル）で、あなたの回答から計算した結果ではありません。あなたの回答は、下の「6つの考え方」と「地域課題ごとの回答の振り返り」で確かめられます。
          </NoticeBar>
        ) : (
          <p className="mb-4 text-sm leading-6 text-ink-soft">
            あなたの回答から、6つの考え方を比べたときの傾きを図にしました。
          </p>
        )}
        <ValueAxisRadar
          axes={axes}
          sample={analysis.status === "PENDING"}
          values={analysis.status === "PENDING" ? SAMPLE_AXIS_VALUES : analysis.values}
        />
      </SectionCard>

      {/* 3. 6つの考え方（軸の意味と、どの質問の回答と対応するか） */}
      <SectionCard icon={Compass} title="6つの考え方（価値観の軸）">
        <p className="mb-4 text-sm leading-6 text-ink-soft">
          レーダーの6つの軸の意味と、それぞれの軸が出てくる質問、その質問へのあなたの回答です。どの軸も2つの質問に、1回は考え方A、1回は考え方Bとして出てきます。AとBに優劣はありません。
        </p>
        <ul className="grid gap-3 md:grid-cols-2" role="list">
          {traces.map(({ axis, links }) => (
            <li
              className="rounded-[var(--radius-btn)] border border-line bg-white p-4"
              data-axis-trace={axis.axisId}
              key={axis.axisId}
            >
              <h3 className="text-base font-bold text-primary-dark">{axis.label}</h3>
              <p className="mt-1 text-sm leading-6 text-ink">{axis.definition}</p>
              <ul className="mt-3 grid gap-2" role="list">
                {links.map((link) => {
                  const option = link.side === "A" ? link.question.optionA : link.question.optionB;
                  return (
                    <li
                      className="rounded-lg bg-surface px-3 py-2 text-xs leading-5 text-ink"
                      data-trace-answer={link.answer ?? "UNANSWERED"}
                      data-trace-question={link.question.questionId}
                      data-trace-side={link.side}
                      key={`${link.question.questionId}-${link.side}`}
                    >
                      <span className="font-bold text-primary-dark">{link.question.themeLabel}</span>
                      <span className="text-ink-soft">（考え方{link.side}）</span>
                      <span className="block">{option.text}</span>
                      <span className="mt-0.5 block font-bold">
                        <span className="font-normal text-ink-soft">あなたの回答：</span>
                        {answerLabelOf(link.answer)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* 4. 地域課題ごとのA/Bの回答の振り返り（地域課題マップ） */}
      <SectionCard icon={MapIcon} title="地域課題ごとの回答の振り返り">
        <p className="mb-4 text-sm leading-6 text-ink-soft">
          地域課題ごとに、2つの考え方のどちらをどのくらい重視したかを示します（地域課題マップ）。テーマの回答は合計していません。帯の位置は順位や点数ではありません。
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
                  {(
                    [
                      ["A", question.optionA],
                      ["B", question.optionB],
                    ] as const
                  ).map(([side, option]) => (
                    <div className="rounded-lg bg-surface p-2" key={side}>
                      <dt className="font-black text-primary-dark">{side}</dt>
                      <dd className="text-ink">{option.text}</dd>
                      <dd className="mt-1 text-[11px] font-bold text-ink-soft">
                        軸：{axisLabels.get(option.valueAxisId) ?? option.valueAxisId}
                      </dd>
                    </div>
                  ))}
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

      {/* 5. 回答の変更・最初からやり直す操作 */}
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
