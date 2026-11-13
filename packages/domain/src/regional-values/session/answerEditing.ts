import {
  ImportanceCodeSchema,
  TradeoffCodeSchema,
  type Answers,
  type ImportanceCode,
  type ThemeId,
  type TradeoffCode,
} from "@ehime-vote-navigator/contracts";

import type { Hint, QuestionId, SessionQuestion } from "./sessionTypes.js";

/**
 * Rules for editing the answers, as pure functions. None changes its input: each
 * returns the same object when nothing changes, and a new object otherwise.
 */

type Selectable = ImportanceCode | TradeoffCode | "UNSURE" | "DECLINE";

/** Whether the question has an answer, of any kind (an UNSURE or DECLINE counts). */
export function isAnswered(answers: Answers, questionId: QuestionId): boolean {
  return Object.hasOwn(answers, questionId);
}

/**
 * The value as something SELECT_ANSWER may store for a question of this kind: an
 * importance code or a trade-off code of the matching family, or UNSURE or DECLINE.
 * The priority-theme question is answered with `togglePick` only.
 */
function selectable(question: SessionQuestion, value: string): Selectable | undefined {
  if (question.kind === "PRIORITY_PICK") {
    return undefined;
  }
  if (value === "UNSURE" || value === "DECLINE") {
    return value;
  }
  if (question.kind === "IMPORTANCE") {
    const parsed = ImportanceCodeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }
  const parsed = TradeoffCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function matchesKind(question: SessionQuestion, value: string): boolean {
  return selectable(question, value) !== undefined;
}

/** Replaces the answer of the question. A value that does not fit the question is ignored. */
export function selectAnswer(answers: Answers, question: SessionQuestion, value: string): Answers {
  const chosen = selectable(question, value);
  return chosen === undefined ? answers : { ...answers, [question.questionId]: chosen };
}

/** Removes the answer of the question (the question becomes unanswered). */
export function clearAnswer(answers: Answers, questionId: QuestionId): Answers {
  if (!isAnswered(answers, questionId)) {
    return answers;
  }
  return Object.fromEntries(Object.entries(answers).filter(([key]) => key !== questionId));
}

export type PickResult = Readonly<{ answers: Answers; hint: Hint }>;

function chosenThemes(answers: Answers, questionId: QuestionId): readonly string[] {
  const value = Object.hasOwn(answers, questionId) ? answers[questionId] : undefined;
  return typeof value === "object" && value !== null ? value.pick : [];
}

/**
 * Toggles one item of the priority-theme question. The selection is always one of
 * five forms: one theme, two themes, UNSURE only, DECLINE only, or nothing.
 *  - UNSURE or DECLINE clears the chosen themes; choosing it again clears it.
 *  - A theme clears a chosen UNSURE or DECLINE; choosing a chosen theme again clears it.
 *  - A third theme leaves the selection as it is and gives PICK_LIMIT.
 * The themes are stored in theme definition order.
 */
export function togglePick(
  answers: Answers,
  question: SessionQuestion,
  item: string,
  themeOrder: readonly ThemeId[],
): PickResult {
  const questionId = question.questionId;
  if (question.kind !== "PRIORITY_PICK") {
    return { answers, hint: "NONE" };
  }

  if (item === "UNSURE" || item === "DECLINE") {
    const current = Object.hasOwn(answers, questionId) ? answers[questionId] : undefined;
    return {
      answers: current === item ? clearAnswer(answers, questionId) : { ...answers, [questionId]: item },
      hint: "NONE",
    };
  }

  const theme = themeOrder.find((candidate) => candidate === item);
  if (theme === undefined) {
    return { answers, hint: "NONE" };
  }
  const chosen = chosenThemes(answers, questionId);
  if (chosen.includes(theme)) {
    const remaining = themeOrder.filter((candidate) => candidate !== theme && chosen.includes(candidate));
    return {
      answers: remaining.length === 0 ? clearAnswer(answers, questionId) : { ...answers, [questionId]: { pick: remaining } },
      hint: "NONE",
    };
  }
  if (chosen.length >= 2) {
    return { answers, hint: "PICK_LIMIT" };
  }
  const added = themeOrder.filter((candidate) => candidate === theme || chosen.includes(candidate));
  return { answers: { ...answers, [questionId]: { pick: added } }, hint: "NONE" };
}