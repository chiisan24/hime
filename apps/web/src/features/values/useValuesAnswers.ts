import { useCallback, useReducer } from "react";

import type { AnswerValue, Answers } from "./contractTypes.js";

/*
 * 回答の状態管理。回答は React の state（ブラウザーのメモリー）にだけ持つ（Req 9.1、9.3）。
 * localStorage・sessionStorage・cookie・IndexedDB・URL には入れない。再読み込みすると消える（Req 6.10）。
 * 回答の形は正式な契約の Answers（質問IDごとに最新の1件。未回答の質問はキーを持たない）。
 * 画面は UNANSWERED を書き込まない。キーがないことが「未回答」を表す（design.md「型の使い分け」）。
 *
 * 正式には domain の diagnosticReducer（tasks.md 4.x）に置き換える。
 */

type AnswersAction =
  | Readonly<{ type: "set"; questionId: string; answer: AnswerValue }>
  | Readonly<{ type: "reset" }>;

const EMPTY_ANSWERS: Answers = {};

function answersReducer(state: Answers, action: AnswersAction): Answers {
  switch (action.type) {
    case "set":
      // 回答の変更は、変更後の1件で置き換える（Req 2.10）
      return { ...state, [action.questionId]: action.answer };
    case "reset":
      return EMPTY_ANSWERS;
  }
}

export function useValuesAnswers() {
  const [answers, dispatch] = useReducer(answersReducer, EMPTY_ANSWERS);

  const setAnswer = useCallback((questionId: string, answer: AnswerValue) => {
    dispatch({ type: "set", questionId, answer });
  }, []);

  const resetAnswers = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);

  return { answers, setAnswer, resetAnswers } as const;
}

/** 所要時間の目安（分）。1問あたり約15秒で計算する（requirements.md の仮定。6問で約90秒） */
export function estimateMinutes(questionCount: number): number {
  return Math.max(1, Math.ceil((questionCount * 15) / 60));
}
