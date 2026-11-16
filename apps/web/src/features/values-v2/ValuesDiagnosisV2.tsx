import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { analyzeValueAxes } from "./axisAnalysis.js";
import { DEMO_DILEMMAS, UI_VALUE_AXES } from "./demoDilemmas.js";
import { DilemmaQuestionPage } from "./pages/DilemmaQuestionPage.js";
import { DilemmaResultPage } from "./pages/DilemmaResultPage.js";
import { DilemmaStartPage } from "./pages/DilemmaStartPage.js";
import type { UiAxisAnalyzer, UiDilemmaQuestion, UiValueAxis } from "./uiTypes.js";
import { useDilemmaAnswers } from "./useDilemmaAnswers.js";

/*
 * 地域課題ジレンマ診断（v2）の流れ（開始 → 質問 → 結果）。
 * - v1（features/values）とは独立した部品。どのルートにも登録していない（/values は v1 のまま）。
 * - URL は変えず、画面の中の状態で切り替える。回答はこの部品の state にだけ持つ。
 * - 質問は UI 専用の仮データ（demoDilemmas.ts）。正式な v2 の契約ができたら差し替える。
 * - 結果画面の価値観レーダーの値は analyzeAxes が回答から作る。既定の analyzeValueAxes（axisAnalysis.ts）は、
 *   回答から6軸を計算する。答え直すと、結果画面を開くたびに今の回答から計算し直す（前の結果を持ち越さない）。
 */

type Step =
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "question"; index: number }>
  | Readonly<{ kind: "result" }>;

type ValuesDiagnosisV2Props = Readonly<{
  questions?: readonly UiDilemmaQuestion[];
  /** 価値観の6軸（レーダーの軸の順番） */
  axes?: readonly UiValueAxis[];
  /** 回答から価値観6軸を分析する関数。既定は analyzeValueAxes */
  analyzeAxes?: UiAxisAnalyzer;
}>;

/** デモ用の架空データの常時表示（v1 と同じ見た目。768px以上は共通ナビの下に固定） */
function DemoDataBanner() {
  return (
    <p
      className="sticky top-0 z-30 -mx-4 mb-4 flex items-center justify-center gap-1.5 border-b border-accent/40 bg-accent-light px-4 py-1.5 text-center text-xs font-bold leading-5 text-accent-dark sm:-mx-6 md:top-[61px] lg:-mx-8"
      role="note"
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      デモ用の架空データです
    </p>
  );
}

/** 回答があるあいだ、再読み込み・タブを閉じる操作でブラウザー標準の確認を出す */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const handle = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [active]);
}

export function ValuesDiagnosisV2({
  questions = DEMO_DILEMMAS,
  axes = UI_VALUE_AXES,
  analyzeAxes = analyzeValueAxes,
}: ValuesDiagnosisV2Props) {
  const { answers, answer, skip, reset } = useDilemmaAnswers();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [hasMoved, setHasMoved] = useState(false);
  const isDemo = questions.some((question) => question.isDemo);
  const total = questions.length;

  useLeaveGuard(Object.keys(answers).length > 0);

  const goTo = (next: Step) => {
    setHasMoved(true);
    setStep(next);
  };
  const advanceFrom = (index: number) =>
    goTo(index + 1 >= total ? { kind: "result" } : { kind: "question", index: index + 1 });

  let screen;
  if (step.kind === "start") {
    screen = (
      <DilemmaStartPage
        focusHeading={hasMoved}
        isDemo={isDemo}
        onStart={() => goTo({ kind: "question", index: 0 })}
        questions={questions}
      />
    );
  } else if (step.kind === "question") {
    const question = questions[step.index];
    screen =
      question === undefined ? null : (
        <DilemmaQuestionPage
          answer={answers[question.questionId]}
          onAnswer={answer}
          onNext={() => advanceFrom(step.index)}
          onPrevious={() => goTo({ kind: "question", index: Math.max(0, step.index - 1) })}
          onQuit={() => {
            reset();
            goTo({ kind: "start" });
          }}
          onSkip={(questionId) => {
            skip(questionId);
            advanceFrom(step.index);
          }}
          position={step.index + 1}
          question={question}
          total={total}
        />
      );
  } else {
    screen = (
      <DilemmaResultPage
        analyzeAxes={analyzeAxes}
        answers={answers}
        axes={axes}
        isDemo={isDemo}
        onEdit={(index) => goTo({ kind: "question", index })}
        onRestart={() => {
          reset();
          goTo({ kind: "question", index: 0 });
        }}
        questions={questions}
      />
    );
  }

  return (
    <div>
      {isDemo ? <DemoDataBanner /> : null}
      {screen}
    </div>
  );
}
