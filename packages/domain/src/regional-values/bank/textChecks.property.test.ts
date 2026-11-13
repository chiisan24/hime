import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TEST_FACT_NUMERALS,
  TEST_NEUTRALITY_CONFIG,
  buildPassingBank,
  expectedTextViolations,
  injectTextViolations,
  textInjectionArbitrary,
} from "../../../../../tests/harness/regional-values/bankInjection.js";
import { checkQuestionTexts } from "./textChecks.js";

// Feature: regional-values-map, Property 18: 質問バンクの文字列の検査

/** Fixed seed: a green run repeats and a failure can be replayed. */
const PARAMETERS = { seed: 350_018, numRuns: 200 };

const BANK = buildPassingBank();
const CONFIG = TEST_NEUTRALITY_CONFIG;
const injectionArbitrary = textInjectionArbitrary(BANK);

/**
 * One injection, or a few into different questions. The expected result is computed by the
 * harness from the injections alone; it never calls the check under test.
 */
const injectionsArbitrary = fc.uniqueArray(injectionArbitrary, {
  minLength: 1,
  maxLength: 6,
  selector: (injection) => injection.questionIndex,
});

describe("checkQuestionTexts: properties (Property 18)", () => {
  /** **Validates: Requirements 3.3, 3.4, 3.5, 3.13, 3.14, 3.15, 3.16, 3.17, 12.4** */
  it("returns only the injected check and question for one injection, and nothing for the other questions", () => {
    fc.assert(
      fc.property(injectionArbitrary, (injection) => {
        const injected = injectTextViolations(BANK, [injection]);
        expect(checkQuestionTexts(injected, CONFIG, TEST_FACT_NUMERALS)).toEqual(
          expectedTextViolations(BANK, [injection]),
        );
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 3.3, 3.4, 3.5, 3.13, 3.14, 3.15, 3.16, 3.17, 3.12, 12.4** */
  it("returns every injected violation, in check definition order and then bank order, for injections into different questions", () => {
    fc.assert(
      fc.property(injectionsArbitrary, (injections) => {
        const injected = injectTextViolations(BANK, injections);
        expect(checkQuestionTexts(injected, CONFIG, TEST_FACT_NUMERALS)).toEqual(
          expectedTextViolations(BANK, injections),
        );
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 3.12, 12.4** */
  it("gives the same result for the same input and leaves the bank as it was", () => {
    fc.assert(
      fc.property(injectionsArbitrary, (injections) => {
        const injected = injectTextViolations(BANK, injections);
        const before = structuredClone(injected);
        const first = checkQuestionTexts(injected, CONFIG, TEST_FACT_NUMERALS);
        const second = checkQuestionTexts(structuredClone(injected), CONFIG, TEST_FACT_NUMERALS);
        expect(second).toEqual(first);
        expect(injected).toEqual(before);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 3.3, 3.11** */
  it("does not depend on the order in which the fact numbers are listed", () => {
    fc.assert(
      fc.property(injectionsArbitrary, fc.boolean(), (injections, reversed) => {
        const injected = injectTextViolations(BANK, injections);
        const facts = reversed ? new Set([...TEST_FACT_NUMERALS].reverse()) : TEST_FACT_NUMERALS;
        expect(checkQuestionTexts(injected, CONFIG, facts)).toEqual(
          checkQuestionTexts(injected, CONFIG, TEST_FACT_NUMERALS),
        );
      }),
      PARAMETERS,
    );
  });
});
