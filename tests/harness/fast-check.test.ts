import { check, constant, property } from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FAST_CHECK_ENVIRONMENT,
  MIN_PROPERTY_RUNS,
  createFastCheckParameters,
} from "./fast-check.js";

describe("fast-check common configuration", () => {
  it("enforces at least 100 runs and keeps detailed failure output", () => {
    const parameters = createFastCheckParameters({
      [FAST_CHECK_ENVIRONMENT.numRuns]: "12",
    });

    expect(parameters.numRuns).toBe(MIN_PROPERTY_RUNS);
    expect(parameters.verbose).toBe(2);
    expect(parameters).not.toHaveProperty("reporter");
  });

  it("accepts a higher run count and replay seed/path", () => {
    expect(
      createFastCheckParameters({
        [FAST_CHECK_ENVIRONMENT.numRuns]: "250",
        [FAST_CHECK_ENVIRONMENT.path]: "3:1:0",
        [FAST_CHECK_ENVIRONMENT.seed]: "424242",
      }),
    ).toEqual({
      numRuns: 250,
      path: "3:1:0",
      seed: 424242,
      verbose: 2,
    });
  });

  it("retains a failing seed, counterexample, and replay path", () => {
    const details = check(
      property(constant("fixture-counterexample"), () => false),
      { numRuns: 1, seed: 424_242 },
    );

    expect(details.failed).toBe(true);
    expect(details.seed).toBe(424_242);
    expect(details.counterexample).toEqual(["fixture-counterexample"]);
    expect(details.counterexamplePath).toEqual(expect.any(String));
  });

  it("rejects malformed run counts and seeds", () => {
    expect(() =>
      createFastCheckParameters({
        [FAST_CHECK_ENVIRONMENT.numRuns]: "0",
      }),
    ).toThrow(/positive/);
    expect(() =>
      createFastCheckParameters({
        [FAST_CHECK_ENVIRONMENT.seed]: "not-an-integer",
      }),
    ).toThrow(/safe integer/);
  });
});
