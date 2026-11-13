import type { NeutralityConfig, Question, QuestionBank } from "@ehime-vote-navigator/contracts";

import { containsAny, lengthOf, numeralForms, numericTokens, sentencesOf } from "./textMetrics.js";

/** The text checks, in definition order. A result lists the violations in this order (Req 3.12). */
export const TEXT_CHECK_IDS = [
  "NAME_FREE",
  "SINGLE_ISSUE",
  "LOADED_TERMS",
  "IMPORTANCE_PATTERN",
  "PREMISE",
  "POSITIVE_FRAMING",
  "NON_EXCLUSIVE",
  "NO_FACT_NUMBERS",
] as const;

export type TextCheckId = (typeof TEXT_CHECK_IDS)[number];

export type TextCheckViolation = Readonly<{ check: TextCheckId; questionId: string }>;

/** The longest premise sentence of a trade-off question (Req 3.14). */
export const PREMISE_MAX_CHARS = 60;

/** The only label that a trade-off question may give to the balanced answer (Req 3.16). */
export const BALANCED_LABEL = "どちらも同じくらい大切";

/** The place of the theme name in the importance question template (Req 3.13). */
const THEME_PLACEHOLDER = "{テーマ名}";

type CheckContext = Readonly<{
  config: NeutralityConfig;
  themeLabels: ReadonlyMap<string, string>;
  factNumerals: ReadonlySet<string>;
}>;

type TradeoffQuestion = Extract<Question, { kind: "TRADEOFF" }>;

/** The sentences that the name, loaded-word and number checks read (Req 3.3): text, explanation, premise and directions. */
function inspectedTexts(question: Question): string[] {
  if (question.kind === "TRADEOFF") {
    return [question.text, question.explanation, question.premise, question.directionA.text, question.directionB.text];
  }
  return [question.text, question.explanation];
}

function containsAnyIn(texts: readonly string[], words: readonly string[]): boolean {
  return texts.some((text) => containsAny(text, words));
}

function matchesFactNumeral(question: TradeoffQuestion, context: CheckContext): boolean {
  const facts = new Set([...context.factNumerals].flatMap(numeralForms));
  return inspectedTexts(question).some((text) =>
    numericTokens(text, context.config.numeralExemptWords).some((token) =>
      numeralForms(token).some((form) => facts.has(form)),
    ),
  );
}

function violatesImportancePattern(question: Question, context: CheckContext): boolean {
  if (question.kind !== "IMPORTANCE") {
    return false;
  }
  const { config, themeLabels } = context;
  const label = themeLabels.get(question.themeId);
  if (label === undefined) {
    return true;
  }
  return (
    question.text !== config.importanceTemplate.replaceAll(THEME_PLACEHOLDER, () => label) ||
    containsAny(question.text, [...config.policyNames, ...config.budgetStanceWords]) ||
    numericTokens(question.text, config.numeralExemptWords).length !== 0
  );
}

/**
 * One predicate per check. The predicates read only the question kind, the question
 * text and the settings. They never read the theme, the data kind or the author, and
 * there is no exemption (Req 3.11).
 */
const CHECKS: Readonly<Record<TextCheckId, (question: Question, context: CheckContext) => boolean>> = {
  NAME_FREE: (question, { config }) =>
    containsAnyIn(inspectedTexts(question), [...config.candidateAndPartyNames, ...config.incumbencyWords]),

  SINGLE_ISSUE: (question, { config }) =>
    sentencesOf(question.text).length !== 1 || containsAny(question.text, config.doubleQuestionWords),

  LOADED_TERMS: (question, { config }) => containsAnyIn(inspectedTexts(question), config.loadedWords),

  IMPORTANCE_PATTERN: violatesImportancePattern,

  PREMISE: (question, { config }) =>
    question.kind === "TRADEOFF" &&
    (!config.premiseTemplates.includes(question.premise) ||
      sentencesOf(question.premise).length !== 1 ||
      lengthOf(question.premise) > PREMISE_MAX_CHARS),

  POSITIVE_FRAMING: (question, { config }) =>
    question.kind === "TRADEOFF" &&
    containsAnyIn([question.premise, question.directionA.text, question.directionB.text], config.negationWords),

  NON_EXCLUSIVE: (question, { config }) =>
    question.kind === "TRADEOFF" &&
    (question.opinionLabels[2] !== BALANCED_LABEL ||
      containsAnyIn([...question.opinionLabels, question.directionA.text, question.directionB.text], config.exclusiveWords)),

  NO_FACT_NUMBERS: (question, context) => question.kind === "TRADEOFF" && matchesFactNumeral(question, context),
};

/**
 * Runs the deterministic text checks on every question and returns all violations, ordered by
 * the check definition and then by the bank definition. It calls no AI, does not change the
 * bank, and returns the same result for the same input.
 *
 * `factNumerals` holds the numbers and survey years of the fact items as they would be written
 * in a sentence ("12", "2020", "令和6年"). It is a plain set, so this module does not depend on
 * the fact item type.
 */
export function checkQuestionTexts(
  bank: QuestionBank,
  config: NeutralityConfig,
  factNumerals: ReadonlySet<string>,
): TextCheckViolation[] {
  const context: CheckContext = {
    config,
    themeLabels: new Map(bank.themes.map((theme) => [theme.themeId, theme.label])),
    factNumerals,
  };
  return TEXT_CHECK_IDS.flatMap((check) =>
    bank.questions
      .filter((question) => CHECKS[check](question, context))
      .map((question) => ({ check, questionId: question.questionId })),
  );
}
