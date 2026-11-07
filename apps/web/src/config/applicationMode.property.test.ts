import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { resolveApplicationMode } from "./applicationMode.js";

const analystCaseOrWhitespaceVariantArbitrary = fc.oneof(
  fc.constantFrom("ANALYST", "Analyst", "aNaLySt"),
  fc
    .tuple(
      fc.constantFrom(" ", "\t", "\n", "\r\n"),
      fc.constantFrom("", " ", "\t", "\n"),
    )
    .map(([prefix, suffix]) => `${prefix}analyst${suffix}`),
  fc
    .tuple(
      fc.constantFrom("", " ", "\t", "\n"),
      fc.constantFrom(" ", "\t", "\n", "\r\n"),
    )
    .map(([prefix, suffix]) => `${prefix}analyst${suffix}`),
);

const nonStringModeArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.bigInt(),
  fc.array(fc.jsonValue()),
  fc.dictionary(fc.string(), fc.jsonValue()),
);

const modeInputArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.constant("analyst"),
  analystCaseOrWhitespaceVariantArbitrary,
  nonStringModeArbitrary,
);

const runtimeLikeValuesArbitrary = fc.record({
  queryString: fc.string().map((value) => `?${value}`),
  hash: fc.string().map((value) => `#${value}`),
  cookie: fc.string(),
  localStorage: fc.dictionary(fc.string(), fc.string()),
  sessionStorage: fc.dictionary(fc.string(), fc.string()),
  uiEvent: fc.record({
    type: fc.string(),
    detail: fc.jsonValue(),
  }),
  apiResponse: fc.record({
    status: fc.integer({ min: 100, max: 599 }),
    body: fc.jsonValue(),
  }),
});

describe("Property 1: fail-closed mode resolution", () => {
  // Feature: visitor-analyst-mode-separation, Property 1: fail-closed mode resolution
  // **Validates: Requirements 1.1, 1.4, 1.6, 1.7**
  it("selects ANALYST only for the exact token regardless of unrelated runtime-like values", () => {
    fc.assert(
      fc.property(
        modeInputArbitrary,
        runtimeLikeValuesArbitrary,
        runtimeLikeValuesArbitrary,
        (mode, firstRuntimeValues, secondRuntimeValues) => {
          const expected = mode === "analyst" ? "ANALYST" : "VISITOR";
          const resultsAcrossRuntimeVariations = [
            firstRuntimeValues,
            secondRuntimeValues,
          ].map(() => resolveApplicationMode(mode));

          expect(resultsAcrossRuntimeVariations).toEqual([expected, expected]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
