import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, Info } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "../../../shared/ui/Badge.js";
import { NoticeBar } from "../../../shared/ui/NoticeBar.js";
import { SectionCard } from "../../../shared/ui/SectionCard.js";
import { AnswerScale } from "../components/AnswerScale.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import type { AnswerValue } from "../contractTypes.js";
import { VALUES_LABELS } from "../labels.js";
import type { QuestionView, SelectableCode } from "../questionView.js";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, TEXT_BUTTON_CLASS } from "../styles.js";
import { THEME_ICONS } from "../themeIcons.js";
import type { GlossaryEntry } from "../types.js";
import { useHeadingFocus } from "../useHeadingFocus.js";

type ValuesQuestionPageProps = Readonly<{
  /** 表示する質問。null は質問を読み込めなかったとき */
  question: QuestionView | null;
  /** 1始まりの問番号と全問数（全問数は診断セットの質問数。Req 2.2） */
  position: number;
  total: number;
  answer: AnswerValue | undefined;
  glossary: readonly GlossaryEntry[];
  /** デモ用の仮の質問なら true */
  isDemo: boolean;
  onAnswer: (questionId: string, code: SelectableCode) => void;
  onPrevious: () => void;
  /** 次の質問へ。最後の問では結果へ進む */
  onNext: () => void;
  /** 診断をやめる（確認後に呼ぶ。回答を消して開始画面へ戻る） */
  onQuit: () => void;
}>;

const DISCLOSURE_CLASS =
  "group rounded-[var(--radius-btn)] border border-line bg-surface open:bg-white";
const SUMMARY_CLASS =
  "flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-bold text-primary-dark [&::-webkit-details-marker]:hidden";

function GlossaryList({ glossary }: Readonly<{ glossary: readonly GlossaryEntry[] }>) {
  return (
    <dl className="grid gap-3 text-sm leading-6">
      {glossary.map((entry) => (
        <div key={entry.term}>
          <dt className="font-bold text-primary-dark">{entry.term}</dt>
          <dd className="mt-0.5 text-ink">{entry.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * V-02 地域課題の質問。1画面に1問。選んだだけでは進まず、「次の質問へ」で進む。
 * 大切さ質問は5段階、優先条件質問は前提文・方向A/B・5段階を出す（Req 2.3、2.4）。
 */
export function ValuesQuestionPage({
  question,
  position,
  total,
  answer,
  glossary,
  isDemo,
  onAnswer,
  onPrevious,
  onNext,
  onQuit,
}: ValuesQuestionPageProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>(question?.questionId, true);
  const hintId = useId();
  const contextId = useId();
  const [quitDialogOpen, setQuitDialogOpen] = useState(false);

  if (question === null) {
    return (
      <div className="grid gap-4">
        <h1
          className="text-2xl font-black text-primary-dark outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          質問を読み込めませんでした
        </h1>
        <NoticeBar>質問のデータが見つかりません。最初からやり直してください。</NoticeBar>
        <div>
          <button className={PRIMARY_BUTTON_CLASS} onClick={onQuit} type="button">
            診断の最初に戻る
          </button>
        </div>
      </div>
    );
  }

  const isFirst = position <= 1;
  const isLast = position >= total;
  const answered = answer !== undefined && answer !== "UNANSWERED";
  const ThemeIcon = THEME_ICONS[question.themeId];
  const isTradeoff = question.kind === "TRADEOFF";

  const handleNext = () => {
    if (!answered) {
      // aria-disabled のため押せるが、未選択なら進まない（理由はボタンの近くに表示。Req 2.8）
      return;
    }
    onNext();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <section
        aria-label={`質問 ${total}問中${position}問目`}
        className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] sm:p-6"
      >
        {/* テーマと進捗 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-primary-light px-3 text-sm font-bold text-primary-dark">
            <ThemeIcon aria-hidden="true" className="size-4 shrink-0" />
            {question.themeLabel}
            <span className="font-normal text-ink-soft">
              ・{isTradeoff ? "優先条件の質問" : "大切さの質問"}
            </span>
          </p>
          <p className="text-sm font-bold text-ink-soft">
            {total}問中 <span className="text-lg text-primary-dark">{position}</span>問目
          </p>
        </div>
        {/* 進捗バーは飾り。進捗は上の文字で伝える */}
        <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${(position / Math.max(1, total)) * 100}%` }}
          />
        </div>

        {isDemo ? (
          <div className="mt-4">
            <Badge>デモ用の仮の質問</Badge>
          </div>
        ) : null}
        <h1
          className="mt-2 text-xl font-bold leading-8 text-ink outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          {question.text}
        </h1>

        {/* 解説（Req 2.7）。スマホ・タブレットでは質問のすぐ下、PCでは右側に表示 */}
        <div className="mt-3 grid gap-2 lg:hidden">
          <details className={DISCLOSURE_CLASS}>
            <summary className={SUMMARY_CLASS}>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 transition group-open:rotate-180"
              />
              この質問の解説を読む
            </summary>
            <p className="px-4 pb-4 text-sm leading-6 text-ink">{question.explanation}</p>
          </details>
          {glossary.map((entry) => (
            <details className={DISCLOSURE_CLASS} key={entry.term}>
              <summary className={SUMMARY_CLASS}>
                <BookOpen aria-hidden="true" className="size-4 shrink-0" />
                用語：<span className="underline underline-offset-4">{entry.term}</span>
              </summary>
              <p className="px-4 pb-4 text-sm leading-6 text-ink">{entry.description}</p>
            </details>
          ))}
        </div>

        {/* 優先条件質問：前提文 → 方向の説明 → 選択肢（Req 2.4） */}
        {isTradeoff ? (
          <div className="mt-5 grid gap-3" id={contextId}>
            {question.premise === null ? null : (
              <p className="rounded-[var(--radius-btn)] bg-surface px-4 py-3 text-sm font-bold leading-6 text-ink">
                {question.premise}
              </p>
            )}
            {question.directions === null ? null : (
              <ul className="grid gap-2 sm:grid-cols-2" role="list">
                {question.directions.map((direction) => (
                  <li
                    className="flex gap-3 rounded-[var(--radius-btn)] border-2 border-line bg-white p-3"
                    key={direction.side}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-primary-dark font-black text-primary-dark"
                    >
                      {direction.side}
                    </span>
                    <span className="min-w-0 text-sm leading-6 text-ink">
                      <span className="sr-only">方向{direction.side}：</span>
                      {direction.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="mt-5">
          <AnswerScale
            describedBy={isTradeoff ? contextId : undefined}
            name={`values-${question.questionId}`}
            onChange={(code) => onAnswer(question.questionId, code)}
            options={question.options}
            value={answer}
          />
        </div>

        <div className="mt-6 border-t border-line pt-4">
          {answered ? null : (
            <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-soft" id={hintId}>
              <Info aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {VALUES_LABELS.selectRequired}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={isFirst}
              onClick={onPrevious}
              type="button"
            >
              <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
              前の質問へ
            </button>
            <button
              aria-describedby={answered ? undefined : hintId}
              aria-disabled={answered ? undefined : true}
              className={PRIMARY_BUTTON_CLASS}
              onClick={handleNext}
              type="button"
            >
              {isLast ? "結果を見る" : "次の質問へ"}
              <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
            </button>
          </div>
          <div className="mt-3 text-center sm:text-left">
            <button
              className={TEXT_BUTTON_CLASS}
              onClick={() => setQuitDialogOpen(true)}
              type="button"
            >
              診断をやめる
            </button>
          </div>
        </div>
      </section>

      {/* PC（1024px以上）：解説と用語を右側に開いた状態で表示 */}
      <div className="hidden gap-4 lg:grid">
        <SectionCard icon={Info} title="この質問の解説">
          <p className="text-sm leading-6 text-ink">{question.explanation}</p>
        </SectionCard>
        {glossary.length > 0 ? (
          <SectionCard icon={BookOpen} title="用語">
            <GlossaryList glossary={glossary} />
          </SectionCard>
        ) : null}
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
    </div>
  );
}
