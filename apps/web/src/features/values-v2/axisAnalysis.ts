import type {
  DilemmaAnswers,
  UiAxisAnalyzer,
  UiAxisDisplayValue,
  UiAxisTrace,
  UiDilemmaQuestion,
  UiValueAxis,
} from "./uiTypes.js";

/*
 * 価値観6軸の分析と、回答と軸の対応（v2）。
 *
 * 【計算はしない】6軸の定義と計算方法は未確定（uiTypes.ts）。計算の案（平均と丸め、1問だけの軸、
 * 「同程度」の扱いなど）は共同開発者が決める（.kiro/specs/regional-values-map/records/
 * real-data-readiness-review.md の 4.6・4.7）。決まるまでは、独自の計算式を作らず、
 * analyzeValueAxes は PENDING を返す。結果画面は、レーダーをサンプル表示にして、分析結果ではないことを示す。
 * 正式な計算ができたら、analyzeValueAxes の中身を差し替える（画面と部品は変えなくてよい）。
 */

/** 回答から価値観6軸を分析する。計算方法が未確定のため、回答にかかわらず PENDING を返す */
export const analyzeValueAxes: UiAxisAnalyzer = () => ({ status: "PENDING" });

/**
 * レーダーのサンプル表示の値（表示の見本。分析結果ではない）。
 * 回答に関係しない固定の値で、分析できない軸（点線と「分析できません」）と、1問からの軸の見え方も含める。
 */
export const SAMPLE_AXIS_VALUES: readonly UiAxisDisplayValue[] = [
  { axisId: "FAIRNESS", state: "DETERMINED", level: 2, usableQuestions: 2 },
  { axisId: "STABILITY", state: "DETERMINED", level: -1, usableQuestions: 2 },
  { axisId: "FUTURE", state: "DETERMINED", level: 0, usableQuestions: 2 },
  { axisId: "OPPORTUNITY", state: "UNDETERMINED" },
  { axisId: "COMMUNITY", state: "DETERMINED", level: 1, usableQuestions: 1 },
  { axisId: "INFRASTRUCTURE", state: "DETERMINED", level: -2, usableQuestions: 2 },
];

/**
 * 軸ごとに、その軸がA側またはB側に現れる質問と、その質問への回答を、質問の提示順で並べる。
 * 回答は変えずにそのまま持つ（スキップは "SKIPPED"、未回答は undefined。0点や中立にしない）。
 */
export function traceAxisAnswers(
  questions: readonly UiDilemmaQuestion[],
  axes: readonly UiValueAxis[],
  answers: DilemmaAnswers,
): readonly UiAxisTrace[] {
  return axes.map((axis) => ({
    axis,
    links: questions.flatMap((question) => {
      const answer = answers[question.questionId];
      const sides = [
        question.optionA.valueAxisId === axis.axisId ? ("A" as const) : null,
        question.optionB.valueAxisId === axis.axisId ? ("B" as const) : null,
      ].filter((side): side is "A" | "B" => side !== null);
      return sides.map((side) => ({ question, side, answer }));
    }),
  }));
}
