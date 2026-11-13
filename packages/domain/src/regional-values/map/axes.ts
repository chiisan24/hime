import type { AxisState, NonOpinionCode, ThemeId } from "@ehime-vote-navigator/contracts";

import { levelOf, roundRatio } from "./rounding.js";
import type { ResolvedQuestion, ValidatedMapInput } from "./validateInput.js";

/**
 * The state, score and level of each axis (importance, trade-off) of each theme.
 * The two axes are computed from separate lists of questions, so an answer to a
 * trade-off question can never move an importance score, and the reverse.
 */

export type ThemeAxes = Readonly<{
  themeId: ThemeId;
  importance: AxisState;
  tradeoff: AxisState;
}>;

const REASON_ORDER: readonly NonOpinionCode[] = ["UNSURE", "DECLINE", "UNANSWERED"];

/**
 * - no question in the set       -> NOT_ASKED
 * - no question with an opinion  -> UNDETERMINED, with the reasons in the order
 *                                   UNSURE, DECLINE, UNANSWERED (no score: not 0)
 * - otherwise                    -> DETERMINED, score = R(sum of w x s, sum of w),
 *                                   where only the questions with an opinion count
 */
function axisState(
  questions: readonly ResolvedQuestion[],
  thresholds: ValidatedMapInput["thresholds"],
): AxisState {
  if (questions.length === 0) {
    return { state: "NOT_ASKED" };
  }

  let numerator = 0;
  let denominator = 0;
  const reasons = new Set<NonOpinionCode>();
  for (const { question, answer } of questions) {
    if (answer.kind === "OPINION") {
      numerator += question.weight * answer.value;
      denominator += question.weight;
    } else if (answer.kind === "NON_OPINION") {
      reasons.add(answer.reason);
    }
  }

  if (denominator === 0) {
    return { state: "UNDETERMINED", reasons: REASON_ORDER.filter((reason) => reasons.has(reason)) };
  }
  const score = roundRatio(numerator, denominator);
  return { state: "DETERMINED", score, level: levelOf(score, thresholds.t1, thresholds.t2) };
}

/** One entry per theme, in theme definition order. */
export function computeAxes(input: ValidatedMapInput): readonly ThemeAxes[] {
  const forAxis = (themeId: ThemeId, kind: "IMPORTANCE" | "TRADEOFF"): ResolvedQuestion[] =>
    input.questions.filter(
      (row) => row.question.kind === kind && row.question.themeId === themeId,
    );

  return input.themeOrder.map((themeId) => ({
    themeId,
    importance: axisState(forAxis(themeId, "IMPORTANCE"), input.thresholds),
    tradeoff: axisState(forAxis(themeId, "TRADEOFF"), input.thresholds),
  }));
}