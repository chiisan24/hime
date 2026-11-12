import type { MapInput } from "@ehime-vote-navigator/contracts";

/**
 * Test-only question banks at the level of `MapInput` (no question text).
 * They are fictional and used by the golden tests, the reference
 * implementation and the property tests of the map generation.
 */

export type MapBank = MapInput["bank"];
export type BankQuestion = MapBank["questions"][number];
export type BankSet = MapBank["sets"][number];
export type ThemeValue = MapBank["themeOrder"][number];
export type SetKindValue = MapInput["setKind"];
export type Thresholds = MapInput["thresholds"];

export const TR: ThemeValue = "TRANSPORT";
export const ED: ThemeValue = "EDUCATION_CHILDCARE";
export const EC: ThemeValue = "ECONOMY_EMPLOYMENT";
export const HC: ThemeValue = "HEALTHCARE_WELFARE";
export const DP: ThemeValue = "DISASTER_PREVENTION";
export const PR: ThemeValue = "POPULATION_REVITALIZATION";

/** The theme definition order (not a ranking). */
export const THEME_ORDER: readonly ThemeValue[] = [TR, ED, EC, HC, DP, PR];

/** The initial thresholds of `config/regional-values/map.json`. */
export const DEFAULT_THRESHOLDS: Thresholds = { t1: 50, t2: 150 };

const ABBREVIATION: Readonly<Record<ThemeValue, string>> = {
  TRANSPORT: "tr",
  EDUCATION_CHILDCARE: "ed",
  ECONOMY_EMPLOYMENT: "ec",
  HEALTHCARE_WELFARE: "hc",
  DISASTER_PREVENTION: "dp",
  POPULATION_REVITALIZATION: "pr",
};

export function importanceId(theme: ThemeValue): string {
  return `q-${ABBREVIATION[theme]}-imp`;
}

export function tradeoffId(theme: ThemeValue): string {
  return `q-${ABBREVIATION[theme]}-tra`;
}

export const PICK_ID = "q-pick";

function importanceQuestion(questionId: string, themeId: ThemeValue, weight = 1): BankQuestion {
  return { questionId, kind: "IMPORTANCE", themeId, weight };
}

function tradeoffQuestion(questionId: string, themeId: ThemeValue, weight = 1): BankQuestion {
  return { questionId, kind: "TRADEOFF", themeId, weight };
}

const PICK_QUESTION: BankQuestion = {
  questionId: PICK_ID,
  kind: "PRIORITY_PICK",
  themeId: null,
  weight: 1,
};

function pairFor(theme: ThemeValue): BankQuestion[] {
  return [
    importanceQuestion(importanceId(theme), theme),
    tradeoffQuestion(tradeoffId(theme), theme),
  ];
}

export const QUICK_THEMES: readonly ThemeValue[] = [ED, DP, PR];

const QUICK_QUESTIONS: BankQuestion[] = QUICK_THEMES.flatMap(pairFor);

const QUICK_SET: BankSet = {
  setKind: "QUICK",
  themeIds: [...QUICK_THEMES],
  questionIds: QUICK_QUESTIONS.map((question) => question.questionId),
};

/** QUICK: ED, DP and PR, an importance and a trade-off question each (six questions, weight 1). */
export const TB_QUICK: MapBank = {
  themeOrder: [...THEME_ORDER],
  questions: QUICK_QUESTIONS,
  sets: [QUICK_SET],
};

const FULL_QUESTIONS: BankQuestion[] = [...THEME_ORDER.flatMap(pairFor), PICK_QUESTION];

/** FULL: six themes x (importance, trade-off) and the priority-theme question (13 questions, weight 1), plus the QUICK set. */
export const TB_FULL: MapBank = {
  themeOrder: [...THEME_ORDER],
  questions: FULL_QUESTIONS,
  sets: [
    {
      setKind: "FULL",
      themeIds: [...THEME_ORDER],
      questionIds: FULL_QUESTIONS.map((question) => question.questionId),
    },
    QUICK_SET,
  ],
};

const WEIGHTED_QUESTIONS: BankQuestion[] = [
  importanceQuestion("q1", ED, 1),
  importanceQuestion("q2", ED, 3),
  importanceQuestion("q3", DP, 1),
  importanceQuestion("q4", DP, 3),
  importanceQuestion("q5", PR, 1),
  importanceQuestion("q6", PR, 3),
  importanceQuestion("tr-w1", TR, 1),
  importanceQuestion("tr-w3", TR, 3),
  importanceQuestion("ec-w1", EC, 1),
  importanceQuestion("ec-w2", EC, 2),
  importanceQuestion("hc-w3a", HC, 3),
  importanceQuestion("hc-w3b", HC, 3),
  importanceQuestion("hc-w2", HC, 2),
];

/**
 * Weighted: several importance questions for one theme. The QUICK set is the V04 set
 * (q1 to q6 for ED, DP, PR); the FULL set holds every question. V05 to V08 use
 * `bankWithSet` to ask the questions of one theme only.
 */
export const TB_W: MapBank = {
  themeOrder: [...THEME_ORDER],
  questions: WEIGHTED_QUESTIONS,
  sets: [
    {
      setKind: "QUICK",
      themeIds: [ED, DP, PR],
      questionIds: ["q1", "q2", "q3", "q4", "q5", "q6"],
    },
    {
      setKind: "FULL",
      themeIds: [...THEME_ORDER],
      questionIds: WEIGHTED_QUESTIONS.map((question) => question.questionId),
    },
  ],
};

/** The bank with exactly one diagnostic set that asks the given questions. */
export function bankWithSet(
  bank: MapBank,
  setKind: SetKindValue,
  questionIds: readonly string[],
): MapBank {
  const themeIds = THEME_ORDER.filter((theme) =>
    bank.questions.some(
      (question) => question.themeId === theme && questionIds.includes(question.questionId),
    ),
  );
  return { ...bank, sets: [{ setKind, themeIds, questionIds: [...questionIds] }] };
}

export function mapInput(
  bank: MapBank,
  setKind: SetKindValue,
  answers: Record<string, unknown>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): MapInput {
  return { setKind, bank, answers, thresholds };
}

/** The questions of a diagnostic set, in the bank's definition order. */
export function questionsOfSet(bank: MapBank, setKind: SetKindValue): BankQuestion[] {
  const set = bank.sets.find((candidate) => candidate.setKind === setKind);
  const ids = new Set(set === undefined ? [] : set.questionIds);
  return bank.questions.filter((question) => ids.has(question.questionId));
}