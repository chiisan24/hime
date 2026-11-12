import type { MapInput } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";

import {
  TB_FULL,
  TB_QUICK,
  TB_W,
  THEME_ORDER,
  questionsOfSet,
  type BankQuestion,
  type MapBank,
  type SetKindValue,
  type Thresholds,
} from "./testBanks.js";

/**
 * fast-check generators for the map generation. Answer codes are written out
 * here and not imported, so that the generators do not depend on the code under
 * test.
 */

const IMPORTANCE_CODES = [
  "VERY_IMPORTANT",
  "IMPORTANT",
  "NEUTRAL",
  "NOT_VERY_IMPORTANT",
  "NOT_IMPORTANT",
] as const;
const TRADEOFF_CODES = ["A_STRONG", "A_LEAN", "BALANCED", "B_LEAN", "B_STRONG"] as const;
export const NON_OPINION_CODES = ["UNSURE", "DECLINE", "UNANSWERED"] as const;

export type BankCase = Readonly<{ name: string; bank: MapBank; setKind: SetKindValue }>;

/** Every bank and diagnostic set the properties run on (all themes, all question kinds, QUICK and FULL). */
export const BANK_CASES: readonly BankCase[] = [
  { name: "TB-QUICK / QUICK", bank: TB_QUICK, setKind: "QUICK" },
  { name: "TB-FULL / FULL", bank: TB_FULL, setKind: "FULL" },
  { name: "TB-FULL / QUICK", bank: TB_FULL, setKind: "QUICK" },
  { name: "TB-W / QUICK", bank: TB_W, setKind: "QUICK" },
  { name: "TB-W / FULL", bank: TB_W, setKind: "FULL" },
];

export const bankCaseArb: fc.Arbitrary<BankCase> = fc.constantFrom(...BANK_CASES);

/** 0 < t1 < t2 <= 200, integers. */
export const thresholdsArb: fc.Arbitrary<Thresholds> = fc
  .integer({ min: 1, max: 199 })
  .chain((t1) => fc.integer({ min: t1 + 1, max: 200 }).map((t2) => ({ t1, t2 })));

/** Thresholds that are not an integer pair with 0 < t1 < t2 <= 200. */
export const invalidThresholdsArb: fc.Arbitrary<Thresholds> = fc.oneof(
  fc.constantFrom<Thresholds>(
    { t1: 0, t2: 150 },
    { t1: 50, t2: 50 },
    { t1: 150, t2: 50 },
    { t1: 50, t2: 201 },
    { t1: 50.5, t2: 150 },
    { t1: 50, t2: Number.NaN },
    { t1: -1, t2: 150 },
    { t1: Number.POSITIVE_INFINITY, t2: 200 },
  ),
  fc.record({ t1: fc.integer({ min: -50, max: 400 }), t2: fc.integer({ min: -50, max: 400 }) }).filter(
    ({ t1, t2 }) => !(t1 >= 1 && t1 < t2 && t2 <= 200),
  ),
);

/** One or two distinct themes, in any order. */
export const pickAnswerArb: fc.Arbitrary<{ pick: string[] }> = fc
  .shuffledSubarray([...THEME_ORDER], { minLength: 1, maxLength: 2 })
  .map((pick) => ({ pick }));

/** An answer value that fits the question kind, or a non-opinion code. */
export function answerValueArb(kind: BankQuestion["kind"]): fc.Arbitrary<unknown> {
  const nonOpinion = fc.constantFrom(...NON_OPINION_CODES);
  const opinion: fc.Arbitrary<unknown> =
    kind === "IMPORTANCE"
      ? fc.constantFrom(...IMPORTANCE_CODES)
      : kind === "TRADEOFF"
        ? fc.constantFrom(...TRADEOFF_CODES)
        : pickAnswerArb;
  return fc.oneof({ weight: 3, arbitrary: opinion }, { weight: 1, arbitrary: nonOpinion });
}

/** True for an importance code, a trade-off code or a priority pick. */
export function isOpinionValue(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      (IMPORTANCE_CODES as readonly string[]).includes(value) ||
      (TRADEOFF_CODES as readonly string[]).includes(value)
    );
  }
  return typeof value === "object" && value !== null;
}

/** For each question: an answer that fits it, or no key at all (unanswered). */
export function answersArb(questions: readonly BankQuestion[]): fc.Arbitrary<Record<string, unknown>> {
  return fc
    .tuple(
      ...questions.map((question) =>
        fc.option(answerValueArb(question.kind), { nil: undefined, freq: 6 }),
      ),
    )
    .map((values) => {
      const answers: Record<string, unknown> = {};
      questions.forEach((question, index) => {
        const value = values[index];
        if (value !== undefined) {
          answers[question.questionId] = value;
        }
      });
      return answers;
    });
}

/** A valid input: valid thresholds, a set that exists, and at least one opinion answer. */
export const validInputArb: fc.Arbitrary<MapInput> = bankCaseArb.chain(({ bank, setKind }) =>
  fc
    .tuple(
      answersArb(questionsOfSet(bank, setKind)).filter((answers) =>
        Object.values(answers).some(isOpinionValue),
      ),
      thresholdsArb,
    )
    .map(([answers, thresholds]) => ({ setKind, bank, answers, thresholds })),
);

/** The same answers with the keys inserted in the given order. */
export function withAnswerOrder(
  answers: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const reordered: Record<string, unknown> = {};
  for (const key of order) {
    if (Object.hasOwn(answers, key)) {
      reordered[key] = answers[key];
    }
  }
  return reordered;
}

/** A permutation of the items. */
export function permutationArb<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

/** One valid answer for a question, for replacing the answer of that question. */
export function replacementArb(question: BankQuestion): fc.Arbitrary<unknown> {
  return answerValueArb(question.kind);
}

/**
 * A value that is a valid answer for no question kind: a made-up word, a number,
 * null, a wrongly shaped pick.
 */
export const invalidAnswerValueArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  "MAYBE",
  "very_important",
  "",
  42,
  null,
  true,
  { pick: [] },
  { pick: ["TRANSPORT", "TRANSPORT"] },
  { pick: ["TRANSPORT", "EDUCATION_CHILDCARE", "ECONOMY_EMPLOYMENT"] },
  { pick: ["NOT_A_THEME"] },
  { pick: ["TRANSPORT"], extra: 1 },
);

/**
 * An input that may be valid or may have one or more faults: thresholds, a
 * missing set, an answer key that is not a question of the set, a value that does
 * not fit the question kind, a code of the wrong family, or no opinion answer. The
 * expected result is decided by the reference implementation, not here.
 */
export const anyInputArb: fc.Arbitrary<MapInput> = fc
  .tuple(
    bankCaseArb.chain(({ bank, setKind }) =>
      answersArb(questionsOfSet(bank, setKind)).map((answers) => ({ bank, setKind, answers })),
    ),
    fc.boolean(),
    fc.oneof(thresholdsArb, invalidThresholdsArb),
    fc.constantFrom<SetKindValue>("QUICK", "FULL"),
    fc.array(
      fc.oneof(
        fc.constantFrom("not-in-the-bank", "", "__proto__", "toString", "z".repeat(100)),
        fc.constantFrom(...TB_FULL.questions.map((question) => question.questionId)),
      ),
      { maxLength: 3 },
    ),
    fc.array(
      fc.tuple(fc.nat(30), invalidAnswerValueArb, fc.constantFrom(...IMPORTANCE_CODES, ...TRADEOFF_CODES)),
      { maxLength: 3 },
    ),
  )
  .map(([base, useBaseSetKind, thresholds, otherSetKind, extraKeys, replacements]) => {
    const answers: Record<string, unknown> = { ...base.answers };
    const ids = Object.keys(answers);
    for (const key of extraKeys) {
      Object.defineProperty(answers, key, {
        value: "IMPORTANT",
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    for (const [index, invalid, wrongFamily] of replacements) {
      const target = ids[index % Math.max(ids.length, 1)];
      if (target !== undefined) {
        answers[target] = index % 2 === 0 ? invalid : wrongFamily;
      }
    }
    return {
      setKind: useBaseSetKind ? base.setKind : otherSetKind,
      bank: base.bank,
      answers,
      thresholds,
    };
  });