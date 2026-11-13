import { QuestionBankSchema } from "@ehime-vote-navigator/contracts";
import type { NeutralityConfig, Question, QuestionBank } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";

import type {
  TextCheckId,
  TextCheckViolation,
} from "../../../packages/domain/src/regional-values/bank/textChecks.js";

/**
 * Test harness for the question bank checks (8.3, reused by 8.4 and 8.5).
 *
 * - a question bank that passes every check, built here and not read from the fixtures;
 * - test-only settings for the checks (no real name, no production word list);
 * - the injection of one kind of violation into a passing bank;
 * - the expected result of an injection, computed from the injection alone and never by
 *   calling the check under test.
 *
 * The check order and the word lists are written out here and not imported from the code
 * under test, so that the harness does not depend on it.
 */

type ImportanceQuestion = Extract<Question, { kind: "IMPORTANCE" }>;
type TradeoffQuestion = Extract<Question, { kind: "TRADEOFF" }>;
type ThemeId = ImportanceQuestion["themeId"];
type OpinionLabels = ImportanceQuestion["opinionLabels"];
type Category = TradeoffQuestion["directionA"]["category"];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The text checks in definition order. A result lists violations in this order. */
export const TEXT_CHECK_ORDER: readonly TextCheckId[] = [
  "NAME_FREE",
  "SINGLE_ISSUE",
  "LOADED_TERMS",
  "IMPORTANCE_PATTERN",
  "PREMISE",
  "POSITIVE_FRAMING",
  "NON_EXCLUSIVE",
  "NO_FACT_NUMBERS",
];

/** The one premise template of the passing bank. */
export const STANDARD_PREMISE = "限られた予算や人手の中で、どちらかを先に進める場面を考えてください";

function padTo(sentence: string, length: number): string {
  const missing = length - Array.from(sentence).length;
  if (missing < 0) {
    throw new Error("The sentence is longer than the requested length");
  }
  return sentence + "あ".repeat(missing);
}

/** A premise template of exactly 60 characters (allowed) and one of 61 characters (too long). */
export const PREMISE_60 = padTo(STANDARD_PREMISE, 60);
export const PREMISE_61 = padTo(STANDARD_PREMISE, 61);

/** A candidate or party name that is written in ASCII, so that a full-width spelling can be injected. */
export const ASCII_NAME = "ParX";
export const FULLWIDTH_ASCII_NAME = "ＰａｒＸ";

/**
 * Test-only settings. Every word is fictional or a generic word list entry; none is a
 * production value, which stays approval-gated (13.1).
 */
export const TEST_NEUTRALITY_CONFIG: NeutralityConfig = {
  candidateAndPartyNames: ["試験候補甲", "試験政党乙", ASCII_NAME],
  incumbencyWords: ["現職", "新人", "元職"],
  doubleQuestionWords: ["かつ", "同時に"],
  loadedWords: ["優劣語", "推奨語", "投票語"],
  labelLengthDiffMax: 6,
  directionLengthDiffMax: 20,
  policyNames: ["試験施策丙"],
  budgetStanceWords: ["予算", "べき", "賛成", "反対"],
  importanceTemplate: "{テーマ名}は、あなたの暮らしにとってどのくらい大切ですか",
  premiseTemplates: [STANDARD_PREMISE, PREMISE_60, PREMISE_61],
  negationWords: ["しない", "せず", "やめる", "より", "ではなく"],
  exclusiveWords: ["だけ", "のみ", "しか"],
  disparagingWords: ["重視していません", "軽視", "どうでもよい"],
  // The initial proposal of the banned words, and the fictional words of the three categories.
  bannedWords: ["優劣語", "推奨語", "投票語", "一致率", "一致度", "ランキング", "おすすめ", "保守", "革新", "右派", "左派", "タイプ"],
  numeralExemptWords: ["一方", "万全"],
  wordCategories: {
    SUPERIORITY: ["優劣語"],
    RECOMMENDATION: ["推奨語"],
    VOTE_URGING: ["投票語"],
  },
  guidanceNames: ["試験名称丁", "松山市", "今治市", "新居浜市", "自由民主党", "立憲民主党"],
  choiceEncouragingWords: ["すべき", "してください", "がおすすめ", "に投票"],
  userClaimPatterns: ["あなたは.+な人です", ".+派です", ".+主義です"],
};

/**
 * The numbers and years of the fact items in the tests. "一" is here so that a kanji numeral
 * can be shown to be allowed inside an exempt word ("一方") and rejected outside one.
 */
export const TEST_FACT_NUMERALS: ReadonlySet<string> = new Set(["12", "2020", "令和6年", "一"]);

// ---------------------------------------------------------------------------
// A passing question bank
// ---------------------------------------------------------------------------

const THEME_ORDER: readonly ThemeId[] = [
  "TRANSPORT",
  "EDUCATION_CHILDCARE",
  "ECONOMY_EMPLOYMENT",
  "HEALTHCARE_WELFARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
];

/** The themes of the QUICK set. They are data of the bank's set definition, not fixed by the checks. */
export const PASSING_QUICK_THEMES: readonly ThemeId[] = [
  "EDUCATION_CHILDCARE",
  "DISASTER_PREVENTION",
  "POPULATION_REVITALIZATION",
];

const THEME_LABEL: Readonly<Record<ThemeId, string>> = {
  TRANSPORT: "地域交通",
  EDUCATION_CHILDCARE: "教育・子育て",
  ECONOMY_EMPLOYMENT: "地域経済・雇用",
  HEALTHCARE_WELFARE: "医療・福祉",
  DISASTER_PREVENTION: "防災",
  POPULATION_REVITALIZATION: "人口減少・地域活性化",
};

const THEME_SLUG: Readonly<Record<ThemeId, string>> = {
  TRANSPORT: "transport",
  EDUCATION_CHILDCARE: "education",
  ECONOMY_EMPLOYMENT: "economy",
  HEALTHCARE_WELFARE: "healthcare",
  DISASTER_PREVENTION: "disaster",
  POPULATION_REVITALIZATION: "population",
};

/**
 * Which trade-off questions swap the display position, and what direction A means. In both
 * the QUICK set (ED, DP, PR) and the FULL set the counts differ by at most 1.
 */
const SWAPS: Readonly<Record<ThemeId, boolean>> = {
  TRANSPORT: false,
  EDUCATION_CHILDCARE: true,
  ECONOMY_EMPLOYMENT: false,
  HEALTHCARE_WELFARE: true,
  DISASTER_PREVENTION: false,
  POPULATION_REVITALIZATION: true,
};

const DIRECTION_A: Readonly<Record<ThemeId, Category>> = {
  TRANSPORT: "CHANGE",
  EDUCATION_CHILDCARE: "CONTINUE",
  ECONOMY_EMPLOYMENT: "CONTINUE",
  HEALTHCARE_WELFARE: "CHANGE",
  DISASTER_PREVENTION: "CHANGE",
  POPULATION_REVITALIZATION: "CONTINUE",
};

/** The five labels of an importance question, in answer-value order (+2 to -2). */
export const PASSING_IMPORTANCE_LABELS: OpinionLabels = [
  "とても大切",
  "大切",
  "どちらともいえない",
  "あまり大切でない",
  "大切でない",
];

/** The five labels of a trade-off question, in answer-value order (A strong to B strong). */
export const PASSING_TRADEOFF_LABELS: OpinionLabels = [
  "方向Aを強く優先",
  "方向Aをやや優先",
  "どちらも同じくらい大切",
  "方向Bをやや優先",
  "方向Bを強く優先",
];

/**
 * A bias review before the approval, and the approval for the stated version. The dates are
 * plain strings here and become typed values when the whole bank is parsed.
 */
export function approvalFor(version: number): {
  forVersion: number;
  review: { modelId: string; reviewedAt: string; verdict: "NO_BIAS_FOUND"; findings: string[] };
  approverId: string;
  approvedAt: string;
} {
  return {
    forVersion: version,
    review: {
      modelId: "test-neutrality-review-v1",
      reviewedAt: "2026-01-02T09:00:00Z",
      verdict: "NO_BIAS_FOUND",
      findings: [],
    },
    approverId: "test-approver-v1",
    approvedAt: "2026-01-03T09:00:00Z",
  };
}

function importanceId(theme: ThemeId): string {
  return `test-${THEME_SLUG[theme]}-importance-v1`;
}

function tradeoffId(theme: ThemeId): string {
  return `test-${THEME_SLUG[theme]}-tradeoff-v1`;
}

export const PASSING_PICK_ID = "test-priority-pick-v1";

function opposite(category: Category): Category {
  return category === "CHANGE" ? "CONTINUE" : "CHANGE";
}

function importanceQuestion(theme: ThemeId) {
  const label = THEME_LABEL[theme];
  return {
    questionId: importanceId(theme),
    dataKind: "FIXTURE",
    author: "HUMAN",
    createdOn: "2026-01-01",
    version: 1,
    kind: "IMPORTANCE",
    themeId: theme,
    text: TEST_NEUTRALITY_CONFIG.importanceTemplate.replace("{テーマ名}", label),
    explanation: `${label}は、地域の暮らしを支える分野のひとつです。ここでは、暮らしを考える材料として、あなたにとっての大切さをたずねます。`,
    opinionLabels: PASSING_IMPORTANCE_LABELS,
    unsureLabel: "わからない",
    declineLabel: "回答しない",
    weight: 1,
    swapDirections: false,
    approval: approvalFor(1),
  };
}

function tradeoffQuestion(theme: ThemeId) {
  const label = THEME_LABEL[theme];
  return {
    questionId: tradeoffId(theme),
    dataKind: "FIXTURE",
    author: "HUMAN",
    createdOn: "2026-01-01",
    version: 1,
    kind: "TRADEOFF",
    themeId: theme,
    text: `${label}について、限られた条件でどちらを先に進めたいですか`,
    explanation: `${label}の取り組みには、情報を届ける方法と、場所を整える方法があります。ここでは、両立が難しい場面での考えをたずねます。`,
    opinionLabels: PASSING_TRADEOFF_LABELS,
    unsureLabel: "わからない",
    declineLabel: "回答しない",
    weight: 1,
    swapDirections: SWAPS[theme],
    premise: STANDARD_PREMISE,
    directionA: { text: `${label}の情報を届ける取り組み`, category: DIRECTION_A[theme] },
    directionB: { text: `${label}の場所を整える取り組み`, category: opposite(DIRECTION_A[theme]) },
    approval: approvalFor(1),
  };
}

function pickQuestion() {
  return {
    questionId: PASSING_PICK_ID,
    dataKind: "FIXTURE",
    author: "HUMAN",
    createdOn: "2026-01-01",
    version: 1,
    kind: "PRIORITY_PICK",
    themeIds: [...THEME_ORDER],
    maxSelect: 2,
    text: "あなたが先に進めたいと考える分野を選んでください",
    explanation:
      "複数の分野のうち、あなたが先に進めたいと考える分野を選びます。ここでは、暮らしの中で大切にしたい分野についての考えをたずねます。",
    unsureLabel: "わからない",
    declineLabel: "回答しない",
    weight: 1,
    swapDirections: false,
    approval: approvalFor(1),
  };
}

/**
 * A question bank that passes every check of the bank: 13 questions (six themes with an
 * importance and a trade-off question each, and one priority pick), a QUICK set of three
 * themes and a FULL set. It is `FIXTURE` data of fictional wording.
 */
export function buildPassingBank(): QuestionBank {
  const questions = [
    ...THEME_ORDER.flatMap((theme) => [importanceQuestion(theme), tradeoffQuestion(theme)]),
    pickQuestion(),
  ];
  const quickThemes = THEME_ORDER.filter((theme) => PASSING_QUICK_THEMES.includes(theme));
  // Parsing makes the dates typed and shows at once that the bank satisfies the contract.
  return QuestionBankSchema.parse({
    schemaVersion: 1,
    dataKind: "FIXTURE",
    themes: THEME_ORDER.map((themeId) => ({ themeId, label: THEME_LABEL[themeId] })),
    questions,
    diagnosticSets: [
      {
        setKind: "QUICK",
        themeIds: quickThemes,
        questionIds: quickThemes.flatMap((theme) => [importanceId(theme), tradeoffId(theme)]),
      },
      {
        setKind: "FULL",
        themeIds: [...THEME_ORDER],
        questionIds: questions.map((question) => question.questionId),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Injection of one kind of text violation
// ---------------------------------------------------------------------------

type FreeField = "text" | "explanation" | "directionA" | "directionB";

/** The sentences into which a word can be appended without touching a fixed form. */
function freeFields(question: Question): readonly FreeField[] {
  switch (question.kind) {
    case "IMPORTANCE":
      // The question text of an importance question is a fixed form, so only the explanation is free.
      return ["explanation"];
    case "TRADEOFF":
      return ["text", "explanation", "directionA", "directionB"];
    case "PRIORITY_PICK":
      return ["text", "explanation"];
  }
}

function pickFrom<T>(items: readonly T[], pick: number): T {
  const item = items[pick % items.length];
  if (item === undefined) {
    throw new Error("The list is empty");
  }
  return item;
}

/** Appends a short suffix. A direction stays far inside the allowed length difference of 20. */
function appendToField(question: Question, field: FreeField, suffix: string): Question {
  switch (field) {
    case "text":
      return { ...question, text: question.text + suffix };
    case "explanation":
      return { ...question, explanation: question.explanation + suffix };
    case "directionA":
      if (question.kind !== "TRADEOFF") {
        throw new Error("Only a trade-off question has directions");
      }
      return { ...question, directionA: { ...question.directionA, text: question.directionA.text + suffix } };
    case "directionB":
      if (question.kind !== "TRADEOFF") {
        throw new Error("Only a trade-off question has directions");
      }
      return { ...question, directionB: { ...question.directionB, text: question.directionB.text + suffix } };
  }
}

function appendToFreeField(question: Question, suffix: string, pick: number): Question {
  return appendToField(question, pickFrom(freeFields(question), pick), suffix);
}

function appendToDirection(question: Question, suffix: string, pick: number): Question {
  return appendToField(question, pickFrom(["directionA", "directionB"] as const, pick), suffix);
}

function asTradeoff(question: Question): TradeoffQuestion {
  if (question.kind !== "TRADEOFF") {
    throw new Error("A trade-off question is required");
  }
  return question;
}

function asImportance(question: Question): ImportanceQuestion {
  if (question.kind !== "IMPORTANCE") {
    throw new Error("An importance question is required");
  }
  return question;
}

function replaceLabel(labels: OpinionLabels, index: number, value: string): OpinionLabels {
  return [
    index === 0 ? value : labels[0],
    index === 1 ? value : labels[1],
    index === 2 ? value : labels[2],
    index === 3 ? value : labels[3],
    index === 4 ? value : labels[4],
  ];
}

const isTradeoff = (question: Question): boolean => question.kind === "TRADEOFF";
const isImportance = (question: Question): boolean => question.kind === "IMPORTANCE";
const isFreeTextQuestion = (question: Question): boolean => question.kind !== "IMPORTANCE";
const anyQuestion = (): boolean => true;

export type TextInjectionCase = Readonly<{
  /** What the case does, for the title of a test. */
  name: string;
  /** The checks that must report the injected question and no other check. Empty: the change is allowed. */
  expected: readonly TextCheckId[];
  /** The questions that the case can be applied to. */
  eligible: (question: Question) => boolean;
  /** `a` and `b` choose among the words and places of the case. */
  apply: (question: Question, a: number, b: number) => Question;
}>;

const NAME_WORDS: readonly string[] = [
  ...TEST_NEUTRALITY_CONFIG.candidateAndPartyNames,
  ...TEST_NEUTRALITY_CONFIG.incumbencyWords,
  FULLWIDTH_ASCII_NAME,
];

const SECOND_SENTENCES: readonly string[] = [
  "。あなたの考えをたずねます",
  "？あなたの考えをたずねます",
  "！あなたの考えをたずねます",
  "\nあなたの考えをたずねます",
];

const REPLACED_IMPORTANCE_TEXTS: readonly string[] = [
  "あなたは暮らしをどう考えますか",
  "暮らしの大切さを教えてください",
  "大切ですか",
];

const OUTSIDE_PREMISES: readonly string[] = [
  "限られた条件で、どちらかを選ぶ場面を考えてください",
  "どちらを先に進めるか考えてください",
  `${STANDARD_PREMISE}。あなたの考えをたずねます`,
];

const NEGATION_SUFFIXES: readonly string[] = ["しない", "せず", "やめる", "より", "ではなく"];

const EXCLUSIVE_SUFFIXES: readonly string[] = ["だけ", "のみ", "しか"];

const OTHER_BALANCED_LABELS: readonly string[] = ["どちらでもない", "どちらも同じ", "同じくらい"];

/** Spellings of a fact number or year: half-width, full-width, with and without 年, and an era year. */
const FACT_NUMBER_SPELLINGS: readonly string[] = ["12", "１２", "2020", "2020年", "２０２０年", "令和6年", "令和６年"];

/** Numbers that are not in the fact items, so that a number alone is not a violation. */
const OTHER_NUMBERS: readonly string[] = ["37", "３７", "2019年", "十二"];

const EXEMPT_WORDS: readonly string[] = ["一方", "万全"];

export const TEXT_INJECTION_CASES: readonly TextInjectionCase[] = [
  {
    name: "a candidate name, a party name or an incumbency word",
    expected: ["NAME_FREE"],
    eligible: anyQuestion,
    apply: (question, a, b) => appendToFreeField(question, pickFrom(NAME_WORDS, a), b),
  },
  {
    name: "a double-question word in the question text",
    expected: ["SINGLE_ISSUE"],
    eligible: isFreeTextQuestion,
    apply: (question, a) =>
      appendToField(question, "text", pickFrom(TEST_NEUTRALITY_CONFIG.doubleQuestionWords, a)),
  },
  {
    name: "a second sentence in the question text",
    expected: ["SINGLE_ISSUE"],
    eligible: isFreeTextQuestion,
    apply: (question, a) => appendToField(question, "text", pickFrom(SECOND_SENTENCES, a)),
  },
  {
    name: "a loaded word",
    expected: ["LOADED_TERMS"],
    eligible: anyQuestion,
    apply: (question, a, b) => appendToFreeField(question, pickFrom(TEST_NEUTRALITY_CONFIG.loadedWords, a), b),
  },
  {
    name: "an importance question text other than the form",
    expected: ["IMPORTANCE_PATTERN"],
    eligible: isImportance,
    apply: (question, a) => ({ ...asImportance(question), text: pickFrom(REPLACED_IMPORTANCE_TEXTS, a) }),
  },
  {
    name: "the name of another theme in the importance question form",
    expected: ["IMPORTANCE_PATTERN"],
    eligible: isImportance,
    apply: (question, a) => {
      const importance = asImportance(question);
      const others = THEME_ORDER.filter((theme) => theme !== importance.themeId);
      return {
        ...importance,
        text: TEST_NEUTRALITY_CONFIG.importanceTemplate.replace("{テーマ名}", THEME_LABEL[pickFrom(others, a)]),
      };
    },
  },
  {
    name: "a policy name, a budget stance word or a number after the importance question",
    expected: ["IMPORTANCE_PATTERN"],
    eligible: isImportance,
    apply: (question, a) =>
      appendToField(
        question,
        "text",
        pickFrom(
          [...TEST_NEUTRALITY_CONFIG.policyNames, ...TEST_NEUTRALITY_CONFIG.budgetStanceWords, "37", "３７", "三"],
          a,
        ),
      ),
  },
  {
    name: "a premise outside the template list",
    expected: ["PREMISE"],
    eligible: isTradeoff,
    apply: (question, a) => ({ ...asTradeoff(question), premise: pickFrom(OUTSIDE_PREMISES, a) }),
  },
  {
    name: "a premise of 61 characters, although it is in the template list",
    expected: ["PREMISE"],
    eligible: isTradeoff,
    apply: (question) => ({ ...asTradeoff(question), premise: PREMISE_61 }),
  },
  {
    name: "a negation word in a direction",
    expected: ["POSITIVE_FRAMING"],
    eligible: isTradeoff,
    apply: (question, a, b) => appendToDirection(question, pickFrom(NEGATION_SUFFIXES, a), b),
  },
  {
    name: "a label other than the balanced label",
    expected: ["NON_EXCLUSIVE"],
    eligible: isTradeoff,
    apply: (question, a) => {
      const tradeoff = asTradeoff(question);
      return { ...tradeoff, opinionLabels: replaceLabel(tradeoff.opinionLabels, 2, pickFrom(OTHER_BALANCED_LABELS, a)) };
    },
  },
  {
    name: "an exclusive word in a direction or in a label",
    expected: ["NON_EXCLUSIVE"],
    eligible: isTradeoff,
    apply: (question, a, b) => {
      const tradeoff = asTradeoff(question);
      const word = pickFrom(EXCLUSIVE_SUFFIXES, a);
      if (b % 3 === 0) {
        return appendToDirection(tradeoff, word, b);
      }
      // Labels 0, 1, 3 and 4. The balanced label (2) has its own case above.
      const index = pickFrom([0, 1, 3, 4], b);
      const label = tradeoff.opinionLabels[index];
      if (label === undefined) {
        throw new Error("Unknown label index");
      }
      return { ...tradeoff, opinionLabels: replaceLabel(tradeoff.opinionLabels, index, label + word) };
    },
  },
  {
    name: "a number or year of the fact items, in any spelling",
    expected: ["NO_FACT_NUMBERS"],
    eligible: isTradeoff,
    apply: (question, a, b) => appendToFreeField(question, pickFrom(FACT_NUMBER_SPELLINGS, a), b),
  },
  {
    name: "a premise of 60 characters, which is allowed",
    expected: [],
    eligible: isTradeoff,
    apply: (question) => ({ ...asTradeoff(question), premise: PREMISE_60 }),
  },
  {
    name: "a number that is not in the fact items",
    expected: [],
    eligible: isTradeoff,
    apply: (question, a, b) => appendToFreeField(question, pickFrom(OTHER_NUMBERS, a), b),
  },
  {
    name: "an exempt word that contains a kanji numeral of the fact items",
    expected: [],
    eligible: isTradeoff,
    apply: (question, a, b) => appendToFreeField(question, pickFrom(EXEMPT_WORDS, a), b),
  },
];

/** One injection: which case, into which question, with which choices of word and place. */
export type TextInjection = Readonly<{
  caseIndex: number;
  questionIndex: number;
  a: number;
  b: number;
}>;

function caseAt(caseIndex: number): TextInjectionCase {
  const injectionCase = TEXT_INJECTION_CASES[caseIndex];
  if (injectionCase === undefined) {
    throw new Error("Unknown injection case");
  }
  return injectionCase;
}

/** The indexes of the questions that the case can be applied to. */
export function eligibleQuestionIndexes(bank: QuestionBank, caseIndex: number): number[] {
  const { eligible } = caseAt(caseIndex);
  return bank.questions.flatMap((question, index) => (eligible(question) ? [index] : []));
}

/** Returns a new bank with the injections applied. The input bank is not changed. */
export function injectTextViolations(bank: QuestionBank, injections: readonly TextInjection[]): QuestionBank {
  const questions = bank.questions.map((question, index) =>
    injections
      .filter((injection) => injection.questionIndex === index)
      .reduce(
        (current, injection) => caseAt(injection.caseIndex).apply(current, injection.a, injection.b),
        question,
      ),
  );
  return { ...bank, questions };
}

/** The bank with the one injection applied. */
export function injectTextViolation(bank: QuestionBank, injection: TextInjection): QuestionBank {
  return injectTextViolations(bank, [injection]);
}

/**
 * The violations that the injections must produce, ordered by check definition and then by bank
 * definition. It is computed from the cases alone and does not call the checks.
 */
export function expectedTextViolations(
  bank: QuestionBank,
  injections: readonly TextInjection[],
): TextCheckViolation[] {
  const expected = injections.flatMap((injection) => {
    const question = bank.questions[injection.questionIndex];
    if (question === undefined) {
      throw new Error("Unknown injection target");
    }
    return caseAt(injection.caseIndex).expected.map((check) => ({
      check,
      questionId: question.questionId,
      questionIndex: injection.questionIndex,
    }));
  });
  return expected
    .sort(
      (left, right) =>
        TEXT_CHECK_ORDER.indexOf(left.check) - TEXT_CHECK_ORDER.indexOf(right.check) ||
        left.questionIndex - right.questionIndex,
    )
    .map(({ check, questionId }) => ({ check, questionId }));
}

/** A random injection into a question that the chosen case can be applied to. */
export function textInjectionArbitrary(bank: QuestionBank): fc.Arbitrary<TextInjection> {
  return fc
    .record({
      caseIndex: fc.nat({ max: TEXT_INJECTION_CASES.length - 1 }),
      target: fc.nat(),
      a: fc.nat({ max: 99 }),
      b: fc.nat({ max: 99 }),
    })
    .map(({ caseIndex, target, a, b }) => {
      const indexes = eligibleQuestionIndexes(bank, caseIndex);
      return { caseIndex, questionIndex: pickFrom(indexes, target), a, b };
    });
}
