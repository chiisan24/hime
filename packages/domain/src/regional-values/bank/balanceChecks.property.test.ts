import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FIXED_IMPORTANCE_LABELS,
  approvalSpecArbitrary,
  bankFromSetSpec,
  bankFromSwapAndDirection,
  bankWithApproval,
  bankWithDirectionLengths,
  bankWithImportanceLabels,
  codePoints,
  expectedApprovalValid,
  expectedCompositionViolation,
  expectedDirectionViolation,
  expectedSwapViolation,
  labelsOfLengths,
  setSpecArbitrary,
  swapAndDirectionArbitrary,
  validSetArbitrary,
} from "../../../../../tests/harness/regional-values/balanceInjection.js";
import { TEST_NEUTRALITY_CONFIG } from "../../../../../tests/harness/regional-values/bankInjection.js";
import { checkBalance, type BalanceViolation } from "./balanceChecks.js";

/** Fixed seeds: a green run repeats and a failure can be replayed. */
const PARAMETERS_19 = { seed: 350_019, numRuns: 200 };
const PARAMETERS_20 = { seed: 350_020, numRuns: 200 };
const PARAMETERS_21 = { seed: 350_021, numRuns: 200 };

const CONFIG = TEST_NEUTRALITY_CONFIG;

function violationsOf(check: BalanceViolation["check"], violations: readonly BalanceViolation[]): BalanceViolation[] {
  return violations.filter((violation) => violation.check === check);
}

/** A length of 1 to 60 characters, which is what a direction can have. */
const directionLengthArbitrary = fc.integer({ min: 1, max: 60 });

describe("checkBalance: properties (Property 19)", () => {
  /** **Validates: Requirements 3.7, 12.4** */
  it("reports DIRECTION_LENGTH exactly when the two directions differ by more than the limit", () => {
    const boundaryCase = fc
      .record({ limit: fc.integer({ min: 0, max: 40 }), lengthA: directionLengthArbitrary, delta: fc.constantFrom(-2, -1, 0, 1, 2) })
      .map(({ limit, lengthA, delta }) => ({ limit, lengthA, lengthB: lengthA + limit + delta }))
      .filter(({ lengthB }) => lengthB >= 1 && lengthB <= 60);
    const anyCase = fc.record({
      limit: fc.integer({ min: 0, max: 40 }),
      lengthA: directionLengthArbitrary,
      lengthB: directionLengthArbitrary,
    });
    fc.assert(
      fc.property(fc.oneof(boundaryCase, anyCase), ({ limit, lengthA, lengthB }) => {
        const config = { ...CONFIG, directionLengthDiffMax: limit };
        const result = violationsOf("DIRECTION_LENGTH", checkBalance(bankWithDirectionLengths(lengthA, lengthB), config));
        expect(result.length === 1).toBe(Math.abs(lengthA - lengthB) > limit);
      }),
      PARAMETERS_19,
    );
  });

  /** **Validates: Requirements 3.7, 12.4** */
  it("has the boundary at a difference of 20 and 21 for the limit of 20", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 39 }), fc.boolean(), (shorter, firstIsShorter) => {
        const [lengthA, lengthB] = firstIsShorter ? [shorter, shorter + 20] : [shorter + 20, shorter];
        const [overA, overB] = firstIsShorter ? [shorter, shorter + 21] : [shorter + 21, shorter];
        expect(violationsOf("DIRECTION_LENGTH", checkBalance(bankWithDirectionLengths(lengthA, lengthB), CONFIG))).toEqual([]);
        expect(violationsOf("DIRECTION_LENGTH", checkBalance(bankWithDirectionLengths(overA, overB), CONFIG))).toHaveLength(1);
      }),
      PARAMETERS_19,
    );
  });

  /** **Validates: Requirements 3.6, 12.4** */
  it("reports LABEL_SYMMETRY exactly when a label is not the fixed wording or the pairs differ by more than the limit", () => {
    const labelLength = fc.oneof({ weight: 3, arbitrary: fc.constant(null) }, { weight: 2, arbitrary: fc.integer({ min: 1, max: 20 }) });
    fc.assert(
      fc.property(fc.tuple(labelLength, labelLength, labelLength, labelLength, labelLength), fc.integer({ min: 0, max: 12 }), (lengths, limit) => {
        const labels = labelsOfLengths(lengths);
        const [l0, l1, , l3, l4] = labels;
        const notFixed = labels.some((label, index) => label !== FIXED_IMPORTANCE_LABELS[index]);
        const expected =
          notFixed || Math.abs(codePoints(l0) - codePoints(l4)) > limit || Math.abs(codePoints(l1) - codePoints(l3)) > limit;
        const config = { ...CONFIG, labelLengthDiffMax: limit };
        const result = violationsOf("LABEL_SYMMETRY", checkBalance(bankWithImportanceLabels(labels), config));
        expect(result.length === 1).toBe(expected);
      }),
      PARAMETERS_19,
    );
  });

  /** **Validates: Requirements 3.6, 12.4** */
  it("judges the fixed wording by the limit alone: the +1 and -1 labels differ by 6", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12 }), (limit) => {
        const labels = labelsOfLengths([null, null, null, null, null]);
        const config = { ...CONFIG, labelLengthDiffMax: limit };
        expect(violationsOf("LABEL_SYMMETRY", checkBalance(bankWithImportanceLabels(labels), config)).length === 1).toBe(6 > limit);
      }),
      PARAMETERS_19,
    );
  });

  /** **Validates: Requirements 3.8, 3.9, 12.4** */
  it("reports SWAP_BALANCE and DIRECTION_BALANCE exactly when the counts differ by more than 1", () => {
    fc.assert(
      fc.property(swapAndDirectionArbitrary, (spec) => {
        const result = checkBalance(bankFromSwapAndDirection(spec), CONFIG);
        expect(violationsOf("SWAP_BALANCE", result).length === 1).toBe(expectedSwapViolation(spec));
        expect(violationsOf("DIRECTION_BALANCE", result).length === 1).toBe(expectedDirectionViolation(spec));
      }),
      PARAMETERS_19,
    );
  });
});

describe("checkBalance: properties (Property 20)", () => {
  /** **Validates: Requirements 2.1, 3.2, 12.12** */
  it("judges the composition of a set as the independent expectation from its description does", () => {
    fc.assert(
      fc.property(setSpecArbitrary, (spec) => {
        const result = violationsOf("SET_COMPOSITION", checkBalance(bankFromSetSpec(spec), CONFIG));
        expect(result.length === 1).toBe(expectedCompositionViolation(spec));
        expect(result.length).toBeLessThanOrEqual(1);
      }),
      PARAMETERS_20,
    );
  });

  /** **Validates: Requirements 2.1, 3.2, 12.12** */
  it("accepts QUICK for any three themes and FULL for the six, so that the themes of QUICK are data", () => {
    fc.assert(
      fc.property(validSetArbitrary, (spec) => {
        expect(violationsOf("SET_COMPOSITION", checkBalance(bankFromSetSpec(spec), CONFIG))).toEqual([]);
        expect(expectedCompositionViolation(spec)).toBe(false);
      }),
      PARAMETERS_20,
    );
  });

  /** **Validates: Requirements 3.2, 12.12** */
  it("names the diagnostic set and no question in a violation", () => {
    fc.assert(
      fc.property(setSpecArbitrary, (spec) => {
        for (const violation of violationsOf("SET_COMPOSITION", checkBalance(bankFromSetSpec(spec), CONFIG))) {
          expect(violation).toEqual({ check: "SET_COMPOSITION", setKind: spec.setKind });
        }
      }),
      PARAMETERS_20,
    );
  });
});

describe("the generated data of Properties 19 to 21", () => {
  const SAMPLES = 400;
  const atLeast = 40;

  /** Both outcomes must be common, or a property that passes would prove little. */
  function bothOutcomes<T>(arbitrary: fc.Arbitrary<T>, rejected: (value: T) => boolean, seed: number): [number, number] {
    const values = fc.sample(arbitrary, { seed, numRuns: SAMPLES });
    const rejectedCount = values.filter(rejected).length;
    return [rejectedCount, values.length - rejectedCount];
  }

  it("contain many accepted and many rejected compositions", () => {
    const [rejected, accepted] = bothOutcomes(setSpecArbitrary, expectedCompositionViolation, 350_020);
    expect(rejected).toBeGreaterThanOrEqual(atLeast);
    expect(accepted).toBeGreaterThanOrEqual(atLeast);
  });

  it("contain many accepted and many rejected approvals", () => {
    const [rejected, accepted] = bothOutcomes(approvalSpecArbitrary, (spec) => !expectedApprovalValid(spec), 350_021);
    expect(rejected).toBeGreaterThanOrEqual(atLeast);
    expect(accepted).toBeGreaterThanOrEqual(atLeast);
  });

  it("contain many accepted and many rejected swap and direction counts", () => {
    const [swapRejected, swapAccepted] = bothOutcomes(swapAndDirectionArbitrary, expectedSwapViolation, 350_019);
    const [directionRejected, directionAccepted] = bothOutcomes(swapAndDirectionArbitrary, expectedDirectionViolation, 350_019);
    for (const count of [swapRejected, swapAccepted, directionRejected, directionAccepted]) {
      expect(count).toBeGreaterThanOrEqual(atLeast);
    }
  });
});

describe("checkBalance: properties (Property 21)", () => {
  /** **Validates: Requirements 3.10, 12.4** */
  it("accepts an approval only for the current version and at or after the review", () => {
    fc.assert(
      fc.property(approvalSpecArbitrary, (spec) => {
        const result = violationsOf("REVIEW_APPROVAL", checkBalance(bankWithApproval(spec), CONFIG));
        expect(result.length === 1).toBe(!expectedApprovalValid(spec));
      }),
      PARAMETERS_21,
    );
  });

  /** **Validates: Requirements 3.10** */
  it("does not carry the record of an earlier version over to a raised version", () => {
    fc.assert(
      fc.property(
        approvalSpecArbitrary.filter((spec) => expectedApprovalValid(spec)),
        fc.integer({ min: 1, max: 3 }),
        (approved, raise) => {
          expect(violationsOf("REVIEW_APPROVAL", checkBalance(bankWithApproval(approved), CONFIG))).toEqual([]);
          const raised = { ...approved, version: approved.version + raise };
          expect(violationsOf("REVIEW_APPROVAL", checkBalance(bankWithApproval(raised), CONFIG))).toHaveLength(1);
          // A review and an approval for the raised version make it valid again.
          const again =
            approved.approval === null ? approved : { version: raised.version, approval: { ...approved.approval, forVersion: raised.version } };
          expect(violationsOf("REVIEW_APPROVAL", checkBalance(bankWithApproval(again), CONFIG))).toEqual([]);
        },
      ),
      PARAMETERS_21,
    );
  });
});
