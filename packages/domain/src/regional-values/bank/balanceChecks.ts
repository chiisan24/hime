import { THEME_IDS } from "@ehime-vote-navigator/contracts";
import type { DiagnosticSet, NeutralityConfig, Question, QuestionBank, SetKind } from "@ehime-vote-navigator/contracts";

import { lengthOf } from "./textMetrics.js";

/** The balance, composition and approval checks, in definition order. A result lists violations in this order. */
export const BALANCE_CHECK_IDS = [
  "LABEL_SYMMETRY",
  "DIRECTION_LENGTH",
  "SWAP_BALANCE",
  "DIRECTION_BALANCE",
  "SET_COMPOSITION",
  "REVIEW_APPROVAL",
] as const;

export type BalanceCheckId = (typeof BALANCE_CHECK_IDS)[number];
export type QuestionBalanceCheckId = "LABEL_SYMMETRY" | "DIRECTION_LENGTH" | "REVIEW_APPROVAL";
export type SetBalanceCheckId = "SWAP_BALANCE" | "DIRECTION_BALANCE" | "SET_COMPOSITION";

/** A violation of one question, or of one diagnostic set (Req 3.12: a set has no question ID). */
export type BalanceViolation =
  | Readonly<{ check: QuestionBalanceCheckId; questionId: string }>
  | Readonly<{ check: SetBalanceCheckId; setKind: SetKind }>;

/** The labels of every importance question, in answer-value order +2, +1, 0, -1, -2 (Req 3.6). */
export const IMPORTANCE_LABELS = ["とても大切", "大切", "どちらともいえない", "あまり大切でない", "大切でない"] as const;

/** The themes of the QUICK set. Which three themes is the data of the set, not a fixed value. */
export const QUICK_THEME_COUNT = 3;

type ImportanceQuestion = Extract<Question, { kind: "IMPORTANCE" }>;
type TradeoffQuestion = Extract<Question, { kind: "TRADEOFF" }>;

const isImportance = (question: Question): question is ImportanceQuestion => question.kind === "IMPORTANCE";
const isTradeoff = (question: Question): question is TradeoffQuestion => question.kind === "TRADEOFF";

function lengthDifference(first: string, second: string): number {
  return Math.abs(lengthOf(first) - lengthOf(second));
}

/** Req 3.6: the fixed labels, and the length difference of +2 and -2 and of +1 and -1. */
function violatesLabelSymmetry(question: Question, config: NeutralityConfig): boolean {
  if (!isImportance(question)) {
    return false;
  }
  const labels = question.opinionLabels;
  return (
    labels.some((label, index) => label !== IMPORTANCE_LABELS[index]) ||
    lengthDifference(labels[0], labels[4]) > config.labelLengthDiffMax ||
    lengthDifference(labels[1], labels[3]) > config.labelLengthDiffMax
  );
}

/** Req 3.7: the length difference of the two directions. */
function violatesDirectionLength(question: Question, config: NeutralityConfig): boolean {
  return (
    isTradeoff(question) &&
    lengthDifference(question.directionA.text, question.directionB.text) > config.directionLengthDiffMax
  );
}

/**
 * Req 3.10: the approval is for the current version of the question, and the approval is
 * not earlier than the bias review. An approval of an earlier version is not carried over.
 * The compare is on instants, not on strings, so a different offset or fraction of a second
 * does not change the result. An instant that cannot be read gives NaN, and a compare with
 * NaN is false, so it is not a valid approval.
 */
export function hasCurrentApproval(question: Question): boolean {
  const { approval } = question;
  if (approval === null || approval.forVersion !== question.version) {
    return false;
  }
  return Date.parse(approval.approvedAt) >= Date.parse(approval.review.reviewedAt);
}

/** The questions of a set that exist in the bank, once each, and whether every listed ID is such a question. */
type SetMembers = Readonly<{ questions: readonly Question[]; complete: boolean }>;

function membersOf(set: DiagnosticSet, byId: ReadonlyMap<string, Question>): SetMembers {
  const unique = [...new Set(set.questionIds)];
  const questions = unique.flatMap((id) => {
    const question = byId.get(id);
    return question === undefined ? [] : [question];
  });
  return { questions, complete: unique.length === set.questionIds.length && questions.length === unique.length };
}

/** Req 3.8: the numbers of swapped and not swapped trade-off questions differ by at most 1. */
function violatesSwapBalance({ questions }: SetMembers): boolean {
  const tradeoffs = questions.filter(isTradeoff);
  const swapped = tradeoffs.filter((question) => question.swapDirections).length;
  return Math.abs(swapped - (tradeoffs.length - swapped)) > 1;
}

/** Req 3.9: the numbers of CHANGE and CONTINUE in direction A differ by at most 1. NEUTRAL is not counted. */
function violatesDirectionBalance({ questions }: SetMembers): boolean {
  const tradeoffs = questions.filter(isTradeoff);
  const change = tradeoffs.filter((question) => question.directionA.category === "CHANGE").length;
  const keep = tradeoffs.filter((question) => question.directionA.category === "CONTINUE").length;
  return Math.abs(change - keep) > 1;
}

/**
 * Req 3.2. QUICK: three different themes with one importance and one trade-off question each,
 * no priority pick, six questions. FULL: the six themes with one importance and one trade-off
 * question each and exactly one priority pick, 13 questions. Every weight is 1. The themes of
 * the set must be the themes of its questions, and every listed ID must be a question of the
 * bank, listed once. The three themes of QUICK are read from the set, never fixed here.
 */
function violatesComposition(set: DiagnosticSet, { questions, complete }: SetMembers): boolean {
  const themeCount = set.setKind === "QUICK" ? QUICK_THEME_COUNT : THEME_IDS.length;
  const pickCount = set.setKind === "QUICK" ? 0 : 1;
  const themes = new Set(set.themeIds);
  if (!complete || themes.size !== set.themeIds.length || themes.size !== themeCount) {
    return true;
  }
  if (questions.some((question) => question.weight !== 1)) {
    return true;
  }
  if (questions.filter((question) => question.kind === "PRIORITY_PICK").length !== pickCount) {
    return true;
  }
  // Two questions for each of the themes, and the priority picks: nothing else is in the set.
  if (questions.length !== themeCount * 2 + pickCount) {
    return true;
  }
  return !set.themeIds.every(
    (theme) =>
      questions.filter((question) => isImportance(question) && question.themeId === theme).length === 1 &&
      questions.filter((question) => isTradeoff(question) && question.themeId === theme).length === 1,
  );
}

/**
 * The diagnostic sets of the bank that break the composition rule (Req 3.2), in the order of the
 * bank. It needs no setting, so the assembly of a bundle can refuse such a set whatever its kind,
 * even if a caller did not run the checks of the bank.
 */
export function setsBreakingComposition(bank: QuestionBank): SetKind[] {
  const byId = new Map(bank.questions.map((question) => [question.questionId, question]));
  return bank.diagnosticSets
    .filter((set) => violatesComposition(set, membersOf(set, byId)))
    .map((set) => set.setKind);
}

/**
 * Runs the deterministic balance, composition and approval checks and returns every violation,
 * ordered by the check definition and then by the bank definition (questions, then sets). It
 * calls no AI, does not change the bank, and returns the same result for the same input. No
 * check reads the theme, the data kind or the author (Req 3.11).
 */
export function checkBalance(bank: QuestionBank, config: NeutralityConfig): BalanceViolation[] {
  const byId = new Map(bank.questions.map((question) => [question.questionId, question]));
  const members = new Map(bank.diagnosticSets.map((set) => [set, membersOf(set, byId)]));

  const questionViolations = (
    check: QuestionBalanceCheckId,
    violates: (question: Question) => boolean,
  ): BalanceViolation[] =>
    bank.questions.filter(violates).map((question) => ({ check, questionId: question.questionId }));

  const setViolations = (
    check: SetBalanceCheckId,
    violates: (set: DiagnosticSet, setMembers: SetMembers) => boolean,
  ): BalanceViolation[] =>
    bank.diagnosticSets
      .filter((set) => violates(set, members.get(set) ?? { questions: [], complete: false }))
      .map((set) => ({ check, setKind: set.setKind }));

  return [
    ...questionViolations("LABEL_SYMMETRY", (question) => violatesLabelSymmetry(question, config)),
    ...questionViolations("DIRECTION_LENGTH", (question) => violatesDirectionLength(question, config)),
    ...setViolations("SWAP_BALANCE", (_set, setMembers) => violatesSwapBalance(setMembers)),
    ...setViolations("DIRECTION_BALANCE", (_set, setMembers) => violatesDirectionBalance(setMembers)),
    ...setViolations("SET_COMPOSITION", violatesComposition),
    ...questionViolations("REVIEW_APPROVAL", (question) => !hasCurrentApproval(question)),
  ];
}
