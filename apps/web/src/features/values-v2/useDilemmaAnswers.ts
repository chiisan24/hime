import { useCallback, useReducer } from "react";

import type { TradeoffCode } from "../values/contractTypes.js";
import type { DilemmaAnswer, DilemmaAnswers, UiDilemmaQuestion } from "./uiTypes.js";

/*
 * v2 の回答の状態管理。回答は React の state（ブラウザーのメモリー）にだけ持つ。
 * localStorage・URL・サーバー・AIには入れない。再読み込みすると消える。
 * スキップは "SKIPPED" として記録し、中立（BALANCED）や0点には変換しない。
 * 正式には共同開発者の v2 の状態機械に置き換える。
 */

type Action =
  | Readonly<{ type: "answer"; questionId: string; code: TradeoffCode }>
  | Readonly<{ type: "skip"; questionId: string }>
  | Readonly<{ type: "reset" }>;

const EMPTY: DilemmaAnswers = {};

function reducer(state: DilemmaAnswers, action: Action): DilemmaAnswers {
  switch (action.type) {
    case "answer":
      // 回答の変更も、スキップした質問への回答も、最新の1件で置き換える
      return { ...state, [action.questionId]: action.code };
    case "skip":
      return { ...state, [action.questionId]: "SKIPPED" };
    case "reset":
      return EMPTY;
  }
}

export function useDilemmaAnswers() {
  const [answers, dispatch] = useReducer(reducer, EMPTY);
  const answer = useCallback((questionId: string, code: TradeoffCode) => {
    dispatch({ type: "answer", questionId, code });
  }, []);
  const skip = useCallback((questionId: string) => {
    dispatch({ type: "skip", questionId });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);
  return { answers, answer, skip, reset } as const;
}

export type DilemmaAnswerSummary = Readonly<{
  total: number;
  /** 5段階のどれかを選んだ問数 */
  answered: number;
  skipped: number;
  /** 回答もスキップもしていない問数 */
  unanswered: number;
}>;

export function summarizeDilemmaAnswers(
  questions: readonly UiDilemmaQuestion[],
  answers: DilemmaAnswers,
): DilemmaAnswerSummary {
  let answered = 0;
  let skipped = 0;
  let unanswered = 0;
  for (const question of questions) {
    const value: DilemmaAnswer | undefined = answers[question.questionId];
    if (value === undefined) {
      unanswered += 1;
    } else if (value === "SKIPPED") {
      skipped += 1;
    } else {
      answered += 1;
    }
  }
  return { total: questions.length, answered, skipped, unanswered };
}
