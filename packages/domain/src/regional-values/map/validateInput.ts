import {
  AnswerValueSchema,
  IMPORTANCE_VALUE,
  TRADEOFF_VALUE,
  type MapError,
  type MapInput,
  type MapQuestion,
  type NonOpinionCode,
  type ThemeId,
} from "@ehime-vote-navigator/contracts";

import type { Result } from "../../result.js";

/**
 * Input validation for the map generation, in the order of the design:
 *   1. INVALID_CONFIG       thresholds are not integers with 0 < t1 < t2 <= 200,
 *                           or the diagnostic set / its questions cannot be used
 *   2. UNKNOWN_QUESTION     an answer key is not a question of the diagnostic set
 *   3. INVALID_ANSWER       a value does not fit the kind of its question
 *   4. (a question without a key is UNANSWERED)
 *   5. NO_OPINION_ANSWERS   every question of the set has a non-opinion answer
 * A question ID list in an error is sorted in ascending order (UTF-16 code units),
 * so it does not depend on the order in which the answers were listed. An error
 * never carries a partial result. The input is not changed.
 */

/** An answer, reduced to what the calculation needs. */
export type NormalizedAnswer =
  | Readonly<{ kind: "OPINION"; value: number }>
  | Readonly<{ kind: "NON_OPINION"; reason: NonOpinionCode }>
  | Readonly<{ kind: "PICK"; themeIds: readonly ThemeId[] }>;

export type ResolvedQuestion = Readonly<{
  question: MapQuestion;
  answer: NormalizedAnswer;
}>;

export type ValidatedMapInput = Readonly<{
  setKind: MapInput["setKind"];
  thresholds: Readonly<{ t1: number; t2: number }>;
  /** Theme definition order (not a ranking). */
  themeOrder: readonly ThemeId[];
  /** The questions of the diagnostic set, in the bank's definition order, with their answers. */
  questions: readonly ResolvedQuestion[];
}>;

const IMPORTANCE_BY_CODE: ReadonlyMap<string, number> = new Map(Object.entries(IMPORTANCE_VALUE));
const TRADEOFF_BY_CODE: ReadonlyMap<string, number> = new Map(Object.entries(TRADEOFF_VALUE));

function fail(error: MapError): Result<never, MapError> {
  return { ok: false, error };
}

function hasValidThresholds(thresholds: MapInput["thresholds"]): boolean {
  const { t1, t2 } = thresholds;
  return Number.isInteger(t1) && Number.isInteger(t2) && t1 >= 1 && t1 < t2 && t2 <= 200;
}

/** A question of the set that the calculation can attribute to a theme and weigh. */
function isUsableQuestion(question: MapQuestion, themeOrder: readonly ThemeId[]): boolean {
  if (!Number.isSafeInteger(question.weight) || question.weight < 1) {
    return false;
  }
  if (question.kind === "PRIORITY_PICK") {
    return true;
  }
  return question.themeId !== null && themeOrder.includes(question.themeId);
}

/** The answer in calculation form, or undefined when the value does not fit the question kind. */
function normalize(kind: MapQuestion["kind"], value: unknown): NormalizedAnswer | undefined {
  const parsed = AnswerValueSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const answer = parsed.data;
  if (typeof answer === "object") {
    return kind === "PRIORITY_PICK" ? { kind: "PICK", themeIds: answer.pick } : undefined;
  }
  if (answer === "UNSURE" || answer === "DECLINE" || answer === "UNANSWERED") {
    return { kind: "NON_OPINION", reason: answer };
  }
  if (kind === "IMPORTANCE" || kind === "TRADEOFF") {
    const table = kind === "IMPORTANCE" ? IMPORTANCE_BY_CODE : TRADEOFF_BY_CODE;
    const numeric = table.get(answer);
    return numeric === undefined ? undefined : { kind: "OPINION", value: numeric };
  }
  return undefined;
}

export function validateMapInput(input: MapInput): Result<ValidatedMapInput, MapError> {
  const { bank, thresholds } = input;

  // 1. configuration
  const set = bank.sets.find((candidate) => candidate.setKind === input.setKind);
  if (!hasValidThresholds(thresholds) || set === undefined) {
    return fail({ code: "INVALID_CONFIG" });
  }
  const bankIds = new Set(bank.questions.map((question) => question.questionId));
  const setIds = new Set(set.questionIds);
  const setQuestions = bank.questions.filter((question) => setIds.has(question.questionId));
  if (
    set.questionIds.some((questionId) => !bankIds.has(questionId)) ||
    setQuestions.filter((question) => question.kind === "PRIORITY_PICK").length > 1 ||
    setQuestions.some((question) => !isUsableQuestion(question, bank.themeOrder))
  ) {
    return fail({ code: "INVALID_CONFIG" });
  }

  // 2. answer keys that are not questions of the set (own enumerable keys only)
  const entries = Object.entries(input.answers);
  const unknownKeys = entries
    .map(([key]) => key)
    .filter((key) => !bankIds.has(key) || !setIds.has(key))
    .sort();
  if (unknownKeys.length > 0) {
    return fail({ code: "UNKNOWN_QUESTION", questionIds: unknownKeys });
  }

  // 3. values that do not fit the kind of their question
  const kindById = new Map(setQuestions.map((question) => [question.questionId, question.kind]));
  const normalized = new Map<string, NormalizedAnswer>();
  const invalidKeys: string[] = [];
  for (const [key, value] of entries) {
    const kind = kindById.get(key);
    const answer = kind === undefined ? undefined : normalize(kind, value);
    if (answer === undefined) {
      invalidKeys.push(key);
    } else {
      normalized.set(key, answer);
    }
  }
  if (invalidKeys.length > 0) {
    return fail({ code: "INVALID_ANSWER", questionIds: invalidKeys.sort() });
  }

  // 4. a question without a key is unanswered
  const questions = setQuestions.map(
    (question): ResolvedQuestion => ({
      question,
      answer: normalized.get(question.questionId) ?? { kind: "NON_OPINION", reason: "UNANSWERED" },
    }),
  );

  // 5. nothing but non-opinion answers
  if (questions.every((row) => row.answer.kind === "NON_OPINION")) {
    return fail({ code: "NO_OPINION_ANSWERS" });
  }

  return {
    ok: true,
    value: {
      setKind: input.setKind,
      thresholds: { t1: thresholds.t1, t2: thresholds.t2 },
      themeOrder: [...bank.themeOrder],
      questions,
    },
  };
}