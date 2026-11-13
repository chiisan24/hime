import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getDiagnosisContent,
  getValuesResult,
  listGlossary,
  listGuidance,
  listResultTexts,
} from "../../services/valuesData.js";
import { NoticeBar } from "../../shared/ui/NoticeBar.js";
import type { SetKind } from "./contractTypes.js";
import { VALUES_LABELS } from "./labels.js";
import { ValuesQuestionPage } from "./pages/ValuesQuestionPage.js";
import { ValuesResultPage } from "./pages/ValuesResultPage.js";
import { ValuesStartPage } from "./pages/ValuesStartPage.js";
import { toQuestionView } from "./questionView.js";
import { useValuesAnswers } from "./useValuesAnswers.js";

/*
 * 価値観診断の流れ（開始 → 質問 → 結果）をまとめる部品。
 * - URL は変えず、画面の中の状態で切り替える（何問目かも回答も URL に入れない。Req 9.2）。
 * - 回答はこの部品の state にだけ持つ。部品が画面から外れる・再読み込みで消える（Req 6.10、9.3）。
 * - ルートへの登録はしていない。正式なルート案は design.md「ルート案（h）」の案A
 *   （リリース用ターゲットの src/app/values-map/routes.tsx の "/"）で、共同開発者の承認後に行う。
 * - 正式には domain の diagnosticReducer（tasks.md 4.x）で状態を持つ形に置き換える。
 */

type DiagnosisStep =
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "question"; index: number }>
  | Readonly<{ kind: "result" }>;

type ValuesDiagnosisProps = Readonly<{
  /** 出題する診断セット。MVP はクイック版だけ */
  setKind?: SetKind;
}>;

/**
 * デモ用の架空データの常時表示（Req 10.12）。スクロールしても表示領域に残り、閉じる操作を持たない。
 * 768px以上では AppShell の共通ナビゲーション（高さ61px）が上に固定されるため、その下に固定する。
 */
function DemoDataBanner() {
  return (
    <p
      className="sticky top-0 z-30 -mx-4 mb-4 md:top-[61px] flex items-center justify-center gap-1.5 border-b border-accent/40 bg-accent-light px-4 py-1.5 text-center text-xs font-bold leading-5 text-accent-dark sm:-mx-6 lg:-mx-8"
      role="note"
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      {VALUES_LABELS.bannerFixture}
    </p>
  );
}

/**
 * 診断の途中で、ページの再読み込み・タブを閉じる操作をしたときに、ブラウザー標準の確認を出す（K-08）。
 * アプリ内の「診断をやめる」「最初からやり直す」は、画面の確認ダイアログで確かめる。
 */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
}

export function ValuesDiagnosis({ setKind = "QUICK" }: ValuesDiagnosisProps) {
  const content = useMemo(() => getDiagnosisContent(setKind), [setKind]);
  const views = useMemo(
    () => content?.questions.map((question) => toQuestionView(question, content.themes)) ?? [],
    [content],
  );
  const { answers, setAnswer, resetAnswers } = useValuesAnswers();
  const [step, setStep] = useState<DiagnosisStep>({ kind: "start" });
  // 最初の表示ではフォーカスを動かさず、画面を切り替えたあとだけ見出しへ移す
  const [hasMoved, setHasMoved] = useState(false);

  useLeaveGuard(Object.keys(answers).length > 0);

  if (content === undefined) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-black text-primary-dark">診断を始められません</h1>
        <NoticeBar>診断のデータを読み込めませんでした。</NoticeBar>
      </div>
    );
  }

  const isDemo = content.dataKind === "FIXTURE";
  const total = content.questions.length;

  const goTo = (next: DiagnosisStep) => {
    setHasMoved(true);
    setStep(next);
  };

  /** 診断をやめる：回答を消して開始画面へ */
  const quit = () => {
    resetAnswers();
    goTo({ kind: "start" });
  };

  /** 最初からやり直す：回答と結果を消して、1問目を選択がない状態で表示する（Req 6.5） */
  const restart = () => {
    resetAnswers();
    goTo({ kind: "question", index: 0 });
  };

  let screen;
  switch (step.kind) {
    case "start":
      screen = (
        <ValuesStartPage
          askedThemes={content.themes.filter((theme) => content.askedThemeIds.includes(theme.themeId))}
          focusHeading={hasMoved}
          isDemo={isDemo}
          onStart={() => goTo({ kind: "question", index: 0 })}
          questionCount={total}
          totalThemeCount={content.themes.length}
        />
      );
      break;
    case "question": {
      const question = content.questions[step.index];
      screen = (
        <ValuesQuestionPage
          answer={question === undefined ? undefined : answers[question.questionId]}
          glossary={question === undefined ? [] : listGlossary(question.questionId)}
          isDemo={isDemo}
          onAnswer={setAnswer}
          onNext={() =>
            goTo(
              step.index + 1 >= total
                ? { kind: "result" }
                : { kind: "question", index: step.index + 1 },
            )
          }
          onPrevious={() => goTo({ kind: "question", index: Math.max(0, step.index - 1) })}
          onQuit={quit}
          position={step.index + 1}
          question={views[step.index] ?? null}
          total={total}
        />
      );
      break;
    }
    case "result": {
      const result = getValuesResult(answers);
      screen = (
        <ValuesResultPage
          answers={answers}
          guidance={result.origin === "ERROR" ? [] : listGuidance(result.guidanceThemeIds)}
          onRestart={restart}
          onReview={() => goTo({ kind: "question", index: 0 })}
          questions={content.questions}
          result={result}
          resultTexts={listResultTexts()}
          themes={content.themes}
        />
      );
      break;
    }
  }

  return (
    <div>
      {isDemo ? <DemoDataBanner /> : null}
      {screen}
    </div>
  );
}
