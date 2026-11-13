import type { QuestionBank } from "@ehime-vote-navigator/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BALANCE_INJECTION_CASES,
  QUICK_TRADEOFF_ID,
  expectedBalanceViolations,
  relabelThemes,
  themePermutationArbitrary,
  withAttributes,
} from "../../../../../tests/harness/regional-values/balanceInjection.js";
import {
  TEST_FACT_NUMERALS,
  TEST_NEUTRALITY_CONFIG,
  buildPassingBank,
  expectedTextViolations,
  injectTextViolations,
  textInjectionArbitrary,
  type TextInjection,
} from "../../../../../tests/harness/regional-values/bankInjection.js";
import { inspectQuestionBank, type BankViolation, type InspectionContext } from "./inspectQuestionBank.js";

// Feature: regional-values-map, Property 22 and Property 23 (and Property 18 through the aggregate)

/** Fixed seeds: a green run repeats and a failure can be replayed. */
const PARAMETERS_18 = { seed: 350_118, numRuns: 200 };
const PARAMETERS_22 = { seed: 350_022, numRuns: 200 };
const PARAMETERS_23 = { seed: 350_023, numRuns: 200 };

const CONTEXT: InspectionContext = { config: TEST_NEUTRALITY_CONFIG, factNumerals: TEST_FACT_NUMERALS };
const BANK = buildPassingBank();

function violationsOf(bank: QuestionBank): readonly BankViolation[] {
  const result = inspectQuestionBank(bank, CONTEXT);
  return result.ok ? [] : result.error.violations;
}

const textInjectionArb = textInjectionArbitrary(BANK);

/** The bank order of the trade-off question that the direction-length case rewrites. */
const DIRECTION_CASE_NAME = "directions that differ by 21 characters";
const DIRECTION_QUESTION_INDEX = BANK.questions.findIndex((question) => question.questionId === QUICK_TRADEOFF_ID);

/**
 * Some balance cases, each at most once, and text injections into different questions. A text
 * injection is not put into the question whose directions a balance case rewrites, because it
 * would change the length difference that the case was built to have.
 */
const noBalanceCase = BALANCE_INJECTION_CASES.map(() => false);

const mixedArbitrary = fc
  .record({
    // A quarter of the banks have no balance violation, so that a bank without any violation is common.
    balanceMask: fc.oneof(
      { weight: 1, arbitrary: fc.constant(noBalanceCase) },
      {
        weight: 3,
        arbitrary: fc.array(fc.boolean(), {
          minLength: BALANCE_INJECTION_CASES.length,
          maxLength: BALANCE_INJECTION_CASES.length,
        }),
      },
    ),
    texts: fc.uniqueArray(textInjectionArb, { maxLength: 6, selector: (injection) => injection.questionIndex }),
  })
  .map(({ balanceMask, texts }) => {
    const balanceCases = BALANCE_INJECTION_CASES.filter((_, index) => balanceMask[index] === true);
    const rewritesDirections = balanceCases.some((injectionCase) => injectionCase.name === DIRECTION_CASE_NAME);
    const textInjections: TextInjection[] = rewritesDirections
      ? texts.filter((injection) => injection.questionIndex !== DIRECTION_QUESTION_INDEX)
      : texts;
    return { balanceCases, textInjections };
  });

describe("inspectQuestionBank: properties", () => {
  /** Feature: regional-values-map, Property 18. **Validates: Requirements 3.3, 3.4, 3.5, 3.13, 3.14, 3.15, 3.16, 3.17, 12.4** */
  it("returns only the injected check and question for one text injection, and a success value when the change is allowed", () => {
    fc.assert(
      fc.property(textInjectionArb, (injection) => {
        const expected = expectedTextViolations(BANK, [injection]);
        const result = inspectQuestionBank(injectTextViolations(BANK, [injection]), CONTEXT);
        if (expected.length === 0) {
          expect(result).toEqual({ ok: true, value: undefined });
        } else {
          expect(result).toEqual({ ok: false, error: { violations: expected } });
        }
      }),
      PARAMETERS_18,
    );
  });

  /** Feature: regional-values-map, Property 22. **Validates: Requirements 3.12** */
  it("collects every violation of every check, in check definition order and then bank order", () => {
    fc.assert(
      fc.property(mixedArbitrary, ({ balanceCases, textInjections }) => {
        const balanced = balanceCases.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
        const injected = injectTextViolations(balanced, textInjections);
        const expected = [
          ...expectedTextViolations(BANK, textInjections),
          ...expectedBalanceViolations(BANK, balanceCases),
        ];
        expect(violationsOf(injected)).toEqual(expected);
        expect(inspectQuestionBank(injected, CONTEXT).ok).toBe(expected.length === 0);
      }),
      PARAMETERS_22,
    );
  });

  /** Feature: regional-values-map, Property 22. **Validates: Requirements 3.12** */
  it("gives the same result again and leaves the bank, the settings and the fact numbers as they were", () => {
    fc.assert(
      fc.property(mixedArbitrary, ({ balanceCases, textInjections }) => {
        const balanced = balanceCases.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
        const injected = injectTextViolations(balanced, textInjections);
        const bankBefore = structuredClone(injected);
        const configBefore = structuredClone(CONTEXT.config);
        const factsBefore = [...CONTEXT.factNumerals];
        const first = inspectQuestionBank(injected, CONTEXT);
        expect(inspectQuestionBank(structuredClone(injected), CONTEXT)).toEqual(first);
        expect(injected).toEqual(bankBefore);
        expect(CONTEXT.config).toEqual(configBefore);
        expect([...CONTEXT.factNumerals]).toEqual(factsBefore);
      }),
      PARAMETERS_22,
    );
  });

  /** Feature: regional-values-map, Property 23. **Validates: Requirements 3.11** */
  it("does not change the violations when only the data kind and the author of the questions change", () => {
    fc.assert(
      fc.property(
        mixedArbitrary,
        fc.constantFrom("FIXTURE", "REAL_AI"),
        fc.array(fc.constantFrom("HUMAN", "AI_DRAFT"), { minLength: 1, maxLength: 13 }),
        ({ balanceCases, textInjections }, dataKind, authors) => {
          const balanced = balanceCases.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
          const injected = injectTextViolations(balanced, textInjections);
          expect(violationsOf(withAttributes(injected, dataKind, authors))).toEqual(violationsOf(injected));
        },
      ),
      PARAMETERS_23,
    );
  });

  /** Feature: regional-values-map, Property 23. **Validates: Requirements 3.11** */
  it("does not change the violations when the theme IDs are replaced throughout the bank", () => {
    fc.assert(
      fc.property(mixedArbitrary, themePermutationArbitrary, ({ balanceCases, textInjections }, permutation) => {
        const balanced = balanceCases.reduce((bank, injectionCase) => injectionCase.apply(bank), BANK);
        const injected = injectTextViolations(balanced, textInjections);
        expect(violationsOf(relabelThemes(injected, permutation))).toEqual(violationsOf(injected));
      }),
      PARAMETERS_23,
    );
  });

  /** Feature: regional-values-map, Property 23. **Validates: Requirements 3.11** */
  it("reports an injected violation in a question of any theme, kind and author", () => {
    fc.assert(
      fc.property(textInjectionArb, themePermutationArbitrary, fc.constantFrom("HUMAN", "AI_DRAFT"), (injection, permutation, author) => {
        const changed = withAttributes(relabelThemes(BANK, permutation), "REAL_AI", [author]);
        const result = violationsOf(injectTextViolations(changed, [injection]));
        expect(result).toEqual(expectedTextViolations(BANK, [injection]));
      }),
      PARAMETERS_23,
    );
  });
});

describe("the generated data of Properties 22 and 23", () => {
  it("contain many banks with no violation, with one and with several", () => {
    const samples = fc.sample(mixedArbitrary, { seed: 350_022, numRuns: 400 });
    const counts = samples.map(({ balanceCases, textInjections }) => {
      const expected = expectedTextViolations(BANK, textInjections).length + expectedBalanceViolations(BANK, balanceCases).length;
      return expected;
    });
    expect(counts.filter((count) => count === 0).length).toBeGreaterThanOrEqual(5);
    expect(counts.filter((count) => count === 1).length).toBeGreaterThanOrEqual(10);
    expect(counts.filter((count) => count >= 3).length).toBeGreaterThanOrEqual(100);
  });
});
