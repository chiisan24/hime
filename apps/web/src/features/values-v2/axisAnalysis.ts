import type { Level, TradeoffCode } from "../values/contractTypes.js";
import type {
  DilemmaAnswer,
  DilemmaAnswers,
  UiAxisAnalysisInput,
  UiAxisAnalysisIssue,
  UiAxisAnalyzer,
  UiAxisComputation,
  UiAxisDisplayValue,
  UiAxisEvidence,
  UiAxisMissingReason,
  UiAxisResult,
  UiAxisTrace,
  UiDilemmaQuestion,
  UiSignedAnswer,
  UiValueAxis,
} from "./uiTypes.js";

/*
 * 価値観6軸の分析と、回答と軸の対応（v2）。
 *
 * 計算の仕様と判断の理由は .kiro/specs/regional-values-map/records/values-v2-axis-analysis.md にある
 * （Kiro が作成し、UI 担当の指示で採用。共同開発者の承認の記録はまだない）。要点:
 * 1. 回答を符号つきの値にする（A_STRONG +2、A_LEAN +1、BALANCED 0、B_LEAN −1、B_STRONG −2）。
 * 2. 軸が質問の考え方Aなら回答値を、考え方Bなら符号を反転した値を、その軸への寄与にする。
 * 3. 寄与の合計 n と、回答のある質問の数 m から、既存の価値観マップと同じ丸め R(n, m) と
 *    段階の境目（t1 = 50、t2 = 150。config/regional-values/map.json と同じ値）で水準（−2〜+2）を決める。
 * 4. スキップと未回答は計算に入れない（0点や「同程度」にしない）。回答のある質問が0問なら UNDETERMINED、
 *    この軸の質問がなければ NOT_ASKED。
 * 使うのは、質問の考え方と軸の対応と、利用者の回答だけ。事実項目、課題、AI の出力は使わない。
 * 純関数で、時刻、乱数、保存、通信を使わない。入力を書き換えない。
 *
 * 既存の generateValuesMap（packages/domain）は、v1 の質問（大切さと優先条件をテーマごとに分ける）を入力にするため、
 * v2 の質問（1問が2つの軸にかかわる）には使えない。丸めと段階の規則だけを、同じ式でここに持つ
 * （同じ結果になることは axisAnalysis.test.ts が domain の levelOf と比べて確かめる）。
 * web の本番のコードからは domain を読み込まない（web の依存の宣言とバンドルの読み込みは共同開発者が決める）。
 */

/** 回答の符号つきの値（左の A 寄りが正、右の B 寄りが負） */
export const SIGNED_ANSWER: Readonly<Record<TradeoffCode, UiSignedAnswer>> = {
  A_STRONG: 2,
  A_LEAN: 1,
  BALANCED: 0,
  B_LEAN: -1,
  B_STRONG: -2,
};

/** 段階の境目。既存の価値観マップの設定（config/regional-values/map.json の thresholds）と同じ値 */
export const AXIS_THRESHOLDS = { t1: 50, t2: 150 } as const;

const MISSING_ORDER: readonly UiAxisMissingReason[] = ["SKIPPED", "UNANSWERED"];

function isTradeoffCode(value: unknown): value is TradeoffCode {
  return typeof value === "string" && Object.hasOwn(SIGNED_ANSWER, value);
}

function isDilemmaAnswer(value: unknown): value is DilemmaAnswer {
  return value === "SKIPPED" || isTradeoffCode(value);
}

/** 回答のこの軸への寄与。スキップと未回答は null（0にしない） */
export function contributionOf(answer: DilemmaAnswer | undefined, side: "A" | "B"): UiSignedAnswer | null {
  if (answer === undefined || answer === "SKIPPED") {
    return null;
  }
  const value = SIGNED_ANSWER[answer];
  // 0 の符号を反転しても -0 にしない
  return side === "A" || value === 0 ? value : ((-value) as UiSignedAnswer);
}

/**
 * R(n, m) = floor((200n + m) / (2m))。n / m × 100 を整数に丸める（ちょうど 0.5 は正の方向へ）。
 * 既存の価値観マップの roundRatio と同じ式。m は回答のある質問の数で、1以上（0のときは呼ばない）。
 */
export function roundAxisScore(n: number, m: number): number {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(m) || m <= 0) {
    throw new RangeError("n must be an integer and m a positive integer");
  }
  return Math.floor((200 * n + m) / (2 * m));
}

/** 得点（−200〜+200）を水準にする。既存の価値観マップの levelOf と同じ規則 */
export function axisLevelOf(score: number): Level {
  const { t1, t2 } = AXIS_THRESHOLDS;
  if (!Number.isSafeInteger(score) || score < -200 || score > 200) {
    throw new RangeError("score must be an integer from -200 to 200");
  }
  if (score >= t2) {
    return 2;
  }
  if (score >= t1) {
    return 1;
  }
  if (score > -t1) {
    return 0;
  }
  if (score > -t2) {
    return -1;
  }
  return -2;
}

/** 質問、軸、回答の誤りを、入力の順に集める */
export function validateAxisAnalysisInput(
  questions: readonly UiDilemmaQuestion[],
  axes: readonly UiValueAxis[],
  answers: DilemmaAnswers,
): readonly UiAxisAnalysisIssue[] {
  const issues: UiAxisAnalysisIssue[] = [];

  const axisIds = new Set<string>();
  for (const axis of axes) {
    if (axisIds.has(axis.axisId)) {
      issues.push({ code: "DUPLICATE_AXIS_ID", axisId: axis.axisId });
    }
    axisIds.add(axis.axisId);
  }

  const questionIds = new Set<string>();
  for (const question of questions) {
    if (questionIds.has(question.questionId)) {
      issues.push({ code: "DUPLICATE_QUESTION_ID", questionId: question.questionId });
    }
    questionIds.add(question.questionId);
    for (const [side, option] of [
      ["A", question.optionA],
      ["B", question.optionB],
    ] as const) {
      if (!axisIds.has(option.valueAxisId)) {
        issues.push({
          code: "UNKNOWN_AXIS_ID",
          questionId: question.questionId,
          side,
          axisId: option.valueAxisId,
        });
      }
    }
    if (question.optionA.valueAxisId === question.optionB.valueAxisId) {
      issues.push({
        code: "SAME_AXIS_ON_BOTH_SIDES",
        questionId: question.questionId,
        axisId: question.optionA.valueAxisId,
      });
    }
  }

  // 回答の対応の列挙順に結果が左右されないよう、誤りは質問IDの順に並べる
  for (const questionId of Object.keys(answers).sort()) {
    if (!questionIds.has(questionId)) {
      issues.push({ code: "UNKNOWN_QUESTION_ID", questionId });
    } else if (!isDilemmaAnswer((answers as Readonly<Record<string, unknown>>)[questionId])) {
      issues.push({ code: "INVALID_ANSWER_VALUE", questionId });
    }
  }
  return issues;
}

/** 誤りのない入力から、軸ごとの結果を軸の順に作る */
function resultsOf(
  questions: readonly UiDilemmaQuestion[],
  axes: readonly UiValueAxis[],
  answers: DilemmaAnswers,
): readonly UiAxisResult[] {
  return traceAxisAnswers(questions, axes, answers).map(({ axis, links }): UiAxisResult => {
    const evidence = links.map(
      (link): UiAxisEvidence => ({
        questionId: link.question.questionId,
        themeLabel: link.question.themeLabel,
        side: link.side,
        opposingAxisId:
          link.side === "A" ? link.question.optionB.valueAxisId : link.question.optionA.valueAxisId,
        answer: link.answer,
        contribution: contributionOf(link.answer, link.side),
      }),
    );
    if (evidence.length === 0) {
      return { axisId: axis.axisId, state: "NOT_ASKED", evidence };
    }

    const missing = new Set<UiAxisMissingReason>();
    let n = 0;
    let m = 0;
    for (const item of evidence) {
      if (item.contribution === null) {
        missing.add(item.answer === "SKIPPED" ? "SKIPPED" : "UNANSWERED");
      } else {
        n += item.contribution;
        m += 1;
      }
    }
    const reasons = MISSING_ORDER.filter((reason) => missing.has(reason));
    if (m === 0) {
      return { axisId: axis.axisId, state: "UNDETERMINED", reasons, evidence };
    }
    const score = roundAxisScore(n, m);
    return {
      axisId: axis.axisId,
      state: "DETERMINED",
      level: axisLevelOf(score),
      score,
      usableQuestions: m,
      reasons,
      evidence,
    };
  });
}

/**
 * 回答から価値観6軸を計算し、軸ごとの結果を根拠（質問と回答と寄与）つきで返す。
 * 誤りがあれば INVALID を返し、値を作らない。
 * 同じ入力からは、いつも同じ結果を返す（回答の対応の列挙順にもよらない）。
 */
export function computeValueAxes({ questions, axes, answers }: UiAxisAnalysisInput): UiAxisComputation {
  const issues = validateAxisAnalysisInput(questions, axes, answers);
  if (issues.length > 0) {
    return { status: "INVALID", issues };
  }
  return { status: "ANALYZED", values: resultsOf(questions, axes, answers) };
}

/** 結果画面が使う既定の分析（computeValueAxes と同じ。根拠つきの結果は表示用の値としても使える） */
export const analyzeValueAxes: UiAxisAnalyzer = computeValueAxes;

/**
 * レーダーのサンプル表示の値（表示の見本。分析結果ではない）。
 * 回答に関係しない固定の値で、分析できない軸（点線と「分析できません」）と、1問からの軸の見え方も含める。
 * 開発用のプレビュー（#radar-sample）と、分析の関数が PENDING を返したときだけに使う。
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
      const answer = Object.hasOwn(answers, question.questionId) ? answers[question.questionId] : undefined;
      const sides = [
        question.optionA.valueAxisId === axis.axisId ? ("A" as const) : null,
        question.optionB.valueAxisId === axis.axisId ? ("B" as const) : null,
      ].filter((side): side is "A" | "B" => side !== null);
      return sides.map((side) => ({ question, side, answer }));
    }),
  }));
}
