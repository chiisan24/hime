import { LevelSchema, MapConfigSchema } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { levelOf, roundRatio } from "./rounding.js";

/** Calls a function with arguments of any type, to test the runtime guards. */
function callRaw(fn: (...args: never[]) => unknown, ...args: unknown[]): unknown {
  return Reflect.apply(fn, undefined, args);
}

function throwsRangeError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof RangeError;
  }
}

/**
 * Independent reference for R(n, m), without the formula under test: the one
 * integer k with (2k - 1) m <= 200 n < (2k + 1) m, which is n / m x 100 rounded
 * to the nearest integer, a fraction of exactly 0.5 going up. BigInt only.
 */
function referenceRound(n: number, m: number): number {
  const bigN = BigInt(n);
  const bigM = BigInt(m);
  const matches: number[] = [];
  for (let k = -201; k <= 201; k += 1) {
    const bigK = BigInt(k);
    if ((2n * bigK - 1n) * bigM <= 200n * bigN && 200n * bigN < (2n * bigK + 1n) * bigM) {
      matches.push(k);
    }
  }
  expect(matches).toHaveLength(1);
  return matches[0] ?? Number.NaN;
}

describe("roundRatio: hand-computed examples (design V02, V04 to V09)", () => {
  const cases: [string, number, number, number][] = [
    ["V02 R(2,1) = floor(401/2) = 200", 2, 1, 200],
    ["V02 R(1,1) = floor(201/2) = 100", 1, 1, 100],
    ["V02 R(0,1) = floor(1/2) = 0", 0, 1, 0],
    ["V02 R(-1,1) = floor(-199/2) = -100", -1, 1, -100],
    ["V02 R(-2,1) = floor(-399/2) = -200", -2, 1, -200],
    ["V04 ED, DP: n = 3, m = 3: floor(603/6) = 100", 3, 3, 100],
    ["V04 PR without q6: n = 2, m = 1: floor(401/2) = 200", 2, 1, 200],
    ["V04 PR if q6 were kept: n = 2, m = 4: floor(404/8) = 50", 2, 4, 50],
    ["V05 n = 2 + 3 = 5, m = 4: floor(1004/8) = 125", 5, 4, 125],
    ["V06 n = 1 - 2 = -1, m = 3: floor(-197/6) = -33", -1, 3, -33],
    ["V07 n = 3 - 6 + 4 = 1, m = 8: floor(208/16) = 13 (12.5 up)", 1, 8, 13],
    ["V08 n = -3 + 6 - 4 = -1, m = 8: floor(-192/16) = -12 (-12.5 up)", -1, 8, -12],
    ["V09 R(1,2) = floor(202/4) = 50", 1, 2, 50],
    ["V09 R(3,2) = floor(602/4) = 150", 3, 2, 150],
    ["V09 R(-1,2) = floor(-198/4) = -50", -1, 2, -50],
    ["V09 R(-3,2) = floor(-598/4) = -150", -3, 2, -150],
    ["R(1,3) = floor(203/6) = 33 (33.33)", 1, 3, 33],
    ["R(2,3) = floor(403/6) = 67 (66.67)", 2, 3, 67],
    ["R(-2,3) = floor(-397/6) = -67 (-66.67)", -2, 3, -67],
    ["R(1,200) = floor(400/400) = 1 (0.5 goes up)", 1, 200, 1],
    ["R(-1,200) = floor(0/400) = 0 (-0.5 goes up)", -1, 200, 0],
  ];

  it.each(cases)("%s", (_label, n, m, expected) => {
    expect(roundRatio(n, m)).toBe(expected);
  });
});

describe("roundRatio: rounding rule", () => {
  it("matches an independent BigInt reference for every n in [-2m, 2m], m = 1 to 60", () => {
    for (let m = 1; m <= 60; m += 1) {
      for (let n = -2 * m; n <= 2 * m; n += 1) {
        const rounded = roundRatio(n, m);
        expect(rounded).toBe(referenceRound(n, m));
        expect(Number.isInteger(rounded)).toBe(true);
        expect(rounded).toBeGreaterThanOrEqual(-200);
        expect(rounded).toBeLessThanOrEqual(200);
      }
    }
  });

  it("rounds a fraction of exactly 0.5 toward positive infinity, for positive and negative values", () => {
    let ties = 0;
    for (let m = 1; m <= 60; m += 1) {
      for (let n = -2 * m; n <= 2 * m; n += 1) {
        const scaled = 200 * n;
        const quotient = scaled / m;
        // 100 n / m = k + 0.5 exactly when 200 n / m is an odd integer 2k + 1.
        if (scaled % m === 0 && Math.abs(quotient) % 2 === 1) {
          ties += 1;
          expect(roundRatio(n, m)).toBe((quotient + 1) / 2);
        }
      }
    }
    expect(ties).toBeGreaterThan(0);
    expect(roundRatio(1, 8)).toBe(13);
    expect(roundRatio(-1, 8)).toBe(-12);
  });

  it("is exact where a floating-point division would not be trustworthy", () => {
    // 100 n / m = 100 - 100 / m: just below 100, far above 99.5.
    expect(roundRatio(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).toBe(100);
    expect(roundRatio(-(Number.MAX_SAFE_INTEGER - 1), Number.MAX_SAFE_INTEGER)).toBe(-100);
    expect(roundRatio(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(100);
  });

  it("gives a single question the same score for any weight (the QUICK set has one question per axis)", () => {
    for (const weight of [1, 2, 3]) {
      for (const value of [2, 1, 0, -1, -2]) {
        expect(roundRatio(weight * value, weight)).toBe(roundRatio(value, 1));
      }
    }
  });

  it("never returns -0", () => {
    expect(Object.is(roundRatio(-0, 1), 0)).toBe(true);
    expect(Object.is(roundRatio(-1, 200), 0)).toBe(true);
    expect(Object.is(roundRatio(0, 7), 0)).toBe(true);
  });
});

describe("roundRatio: unknown and unanswered are not a score of 0", () => {
  it("rejects m = 0 (no usable question) instead of returning 0", () => {
    expect(() => roundRatio(0, 0)).toThrow(RangeError);
    expect(() => roundRatio(5, 0)).toThrow(RangeError);
  });

  it("keeps a neutral answer (n = 0, m = 1) as a real score of 0, apart from m = 0", () => {
    expect(roundRatio(0, 1)).toBe(0);
    expect(roundRatio(0, 4)).toBe(0);
    expect(throwsRangeError(() => roundRatio(0, 0))).toBe(true);
    expect(throwsRangeError(() => roundRatio(0, 1))).toBe(false);
  });
});

describe("roundRatio: rejected input (RangeError)", () => {
  const badNumbers: unknown[] = [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1", 1n, null, undefined, true, 2 ** 53];

  for (const value of badNumbers) {
    it(`rejects n = ${String(value)}`, () => {
      expect(() => callRaw(roundRatio, value, 1)).toThrow(RangeError);
    });
  }

  for (const value of [0, -1, ...badNumbers]) {
    it(`rejects m = ${String(value)}`, () => {
      expect(() => callRaw(roundRatio, 1, value)).toThrow(RangeError);
    });
  }

  it("rejects a result that is not a safe integer", () => {
    expect(() => roundRatio(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    expect(() => roundRatio(-Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});

describe("levelOf: thresholds 50 and 150 (design V09)", () => {
  const cases: [number, number][] = [
    [49, 0],
    [50, 1],
    [149, 1],
    [150, 2],
    [-49, 0],
    [-50, -1],
    [-149, -1],
    [-150, -2],
    [0, 0],
    [1, 0],
    [-1, 0],
    [200, 2],
    [-200, -2],
  ];

  it.each(cases)("score %i is level %i", (score, expected) => {
    expect(levelOf(score, 50, 150)).toBe(expected);
  });

  it("agrees with an independent magnitude rule for every score from -200 to 200", () => {
    for (let score = -200; score <= 200; score += 1) {
      const magnitude = Math.abs(score);
      const steps = magnitude < 50 ? 0 : magnitude < 150 ? 1 : 2;
      const expected = steps === 0 ? 0 : score < 0 ? -steps : steps;
      expect(levelOf(score, 50, 150)).toBe(expected);
      expect(LevelSchema.safeParse(levelOf(score, 50, 150)).success).toBe(true);
    }
  });

  it("gives the levels of the scores that come out of roundRatio (V02, V04 to V09)", () => {
    const viaMap: [string, number, number, number][] = [
      ["V02 R(2,1) = 200", 2, 1, 2],
      ["V02 R(1,1) = 100", 1, 1, 1],
      ["V02 R(0,1) = 0", 0, 1, 0],
      ["V02 R(-1,1) = -100", -1, 1, -1],
      ["V02 R(-2,1) = -200", -2, 1, -2],
      ["V04 score 100", 3, 3, 1],
      ["V04 score 200", 2, 1, 2],
      ["V05 score 125", 5, 4, 1],
      ["V06 score -33", -1, 3, 0],
      ["V07 score 13", 1, 8, 0],
      ["V08 score -12", -1, 8, 0],
      ["V09 score 50", 1, 2, 1],
      ["V09 score 150", 3, 2, 2],
      ["V09 score -50", -1, 2, -1],
      ["V09 score -150", -3, 2, -2],
    ];
    for (const [, n, m, expected] of viaMap) {
      expect(levelOf(roundRatio(n, m), 50, 150)).toBe(expected);
    }
  });
});

describe("levelOf: threshold boundaries", () => {
  it("handles thresholds 100 and 200 (design V09)", () => {
    expect(levelOf(100, 100, 200)).toBe(1);
    expect(levelOf(200, 100, 200)).toBe(2);
    expect(levelOf(-100, 100, 200)).toBe(-1);
    expect(levelOf(-200, 100, 200)).toBe(-2);
    expect(levelOf(99, 100, 200)).toBe(0);
    expect(levelOf(-99, 100, 200)).toBe(0);
    expect(levelOf(199, 100, 200)).toBe(1);
    expect(levelOf(-199, 100, 200)).toBe(-1);
    expect(levelOf(0, 100, 200)).toBe(0);
  });

  it("handles the smallest accepted pair (1, 2)", () => {
    expect(levelOf(0, 1, 2)).toBe(0);
    expect(levelOf(1, 1, 2)).toBe(1);
    expect(levelOf(2, 1, 2)).toBe(2);
    expect(levelOf(-1, 1, 2)).toBe(-1);
    expect(levelOf(-2, 1, 2)).toBe(-2);
    expect(levelOf(200, 1, 2)).toBe(2);
  });

  it("handles the pair next to the largest threshold (199, 200)", () => {
    expect(levelOf(198, 199, 200)).toBe(0);
    expect(levelOf(199, 199, 200)).toBe(1);
    expect(levelOf(200, 199, 200)).toBe(2);
    expect(levelOf(-198, 199, 200)).toBe(0);
    expect(levelOf(-199, 199, 200)).toBe(-1);
    expect(levelOf(-200, 199, 200)).toBe(-2);
  });

  it("handles the widest pair (1, 200)", () => {
    expect(levelOf(0, 1, 200)).toBe(0);
    expect(levelOf(1, 1, 200)).toBe(1);
    expect(levelOf(199, 1, 200)).toBe(1);
    expect(levelOf(200, 1, 200)).toBe(2);
    expect(levelOf(-1, 1, 200)).toBe(-1);
    expect(levelOf(-199, 1, 200)).toBe(-1);
    expect(levelOf(-200, 1, 200)).toBe(-2);
  });

  it("never returns -0", () => {
    expect(Object.is(levelOf(-0, 50, 150), 0)).toBe(true);
  });

  it("does not fall as the score rises and mirrors around 0, for several threshold pairs", () => {
    const pairs: [number, number][] = [[1, 2], [50, 150], [75, 125], [100, 200], [199, 200], [1, 200]];
    for (const [t1, t2] of pairs) {
      for (let score = -199; score <= 200; score += 1) {
        expect(levelOf(score, t1, t2)).toBeGreaterThanOrEqual(levelOf(score - 1, t1, t2));
        expect(levelOf(-score, t1, t2) + levelOf(score, t1, t2)).toBe(0);
      }
    }
  });
});

describe("levelOf: rejected input (RangeError)", () => {
  const badThresholds: [string, number, number][] = [
    ["t1 = 0", 0, 150],
    ["t1 = t2", 50, 50],
    ["t1 > t2", 150, 50],
    ["t2 = 201", 50, 201],
    ["t1 = -1", -1, 150],
    ["a fractional t1", 50.5, 150],
    ["a fractional t2", 50, 150.5],
    ["NaN", Number.NaN, 150],
    ["Infinity", 50, Number.POSITIVE_INFINITY],
  ];

  it.each(badThresholds)("rejects thresholds with %s", (_label, t1, t2) => {
    expect(() => levelOf(0, t1, t2)).toThrow(RangeError);
  });

  it("rejects thresholds that are not numbers", () => {
    expect(() => callRaw(levelOf, 0, "50", 150)).toThrow(RangeError);
    expect(() => callRaw(levelOf, 0, 50, "150")).toThrow(RangeError);
    expect(() => callRaw(levelOf, 0, null, 150)).toThrow(RangeError);
    expect(() => callRaw(levelOf, 0, 50, undefined)).toThrow(RangeError);
  });

  it.each([201, -201, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects the score %s", (score) => {
    expect(() => levelOf(score, 50, 150)).toThrow(RangeError);
  });

  it("rejects a score that is not a number", () => {
    expect(() => callRaw(levelOf, "0", 50, 150)).toThrow(RangeError);
    expect(() => callRaw(levelOf, null, 50, 150)).toThrow(RangeError);
    expect(() => callRaw(levelOf, undefined, 50, 150)).toThrow(RangeError);
    expect(() => callRaw(levelOf, 0n, 50, 150)).toThrow(RangeError);
  });

  it("accepts exactly the threshold pairs that MapConfigSchema accepts", () => {
    const candidates: unknown[] = [
      -1, 0, 1, 2, 3, 99, 100, 101, 149, 150, 151, 198, 199, 200, 201, 202,
      0.5, 50.5, Number.NaN, Number.POSITIVE_INFINITY, "50", null, undefined, true,
    ];
    const mismatches: unknown[][] = [];
    for (const t1 of candidates) {
      for (const t2 of candidates) {
        const schemaAccepts = MapConfigSchema.safeParse({
          thresholds: { t1, t2 },
          guidanceMaxThemes: 1,
        }).success;
        const levelOfAccepts = !throwsRangeError(() => callRaw(levelOf, 0, t1, t2));
        if (schemaAccepts !== levelOfAccepts) {
          mismatches.push([t1, t2]);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("accepts every score that roundRatio can return for |n| <= 2m, m = 1 to 60", () => {
    for (let m = 1; m <= 60; m += 1) {
      for (let n = -2 * m; n <= 2 * m; n += 1) {
        expect(throwsRangeError(() => levelOf(roundRatio(n, m), 50, 150))).toBe(false);
      }
    }
  });
});

describe("levelOf: the same function serves both axes, with no state", () => {
  it("gives the same level to an importance score and a trade-off score, in any call order", () => {
    // Independence of the two axes in a whole map is tested with the axes (3.4) and the
    // independence properties (3.8). Here: the function has no axis argument and no memory.
    const scores = [-200, -150, -50, -49, 0, 49, 50, 150, 200];
    const forwardImportance = scores.map((score) => levelOf(score, 50, 150));
    const reversedTradeoff = [...scores].reverse().map((score) => levelOf(score, 50, 150)).reverse();
    expect(reversedTradeoff).toEqual(forwardImportance);
    expect(scores.map((score) => levelOf(score, 50, 150))).toEqual(forwardImportance);
  });

  it("returns the same result for the same input, however often and wherever it is called", () => {
    const first = [roundRatio(-1, 8), roundRatio(5, 4), levelOf(-12, 50, 150)];
    roundRatio(1, 3);
    levelOf(200, 1, 2);
    const second = [roundRatio(-1, 8), roundRatio(5, 4), levelOf(-12, 50, 150)];
    expect(second).toEqual(first);
    expect(first).toEqual([-12, 125, 0]);
  });
});

describe("QUICK set: a five-step answer keeps its own level", () => {
  // The QUICK set asks one question per axis, so the score of a five-step answer
  // value s is R(s, 1): 200, 100, 0, -100, -200. The natural level is s itself.
  const answerValues = [2, 1, 0, -1, -2];

  function keepsOwnLevel(t1: number, t2: number): boolean {
    return answerValues.every((value) => levelOf(roundRatio(value, 1), t1, t2) === value);
  }

  it("holds for the initial thresholds 50 and 150", () => {
    expect(answerValues.map((value) => roundRatio(value, 1))).toEqual([200, 100, 0, -100, -200]);
    expect(answerValues.map((value) => levelOf(roundRatio(value, 1), 50, 150))).toEqual(answerValues);
    expect(keepsOwnLevel(50, 150)).toBe(true);
  });

  it("holds for every accepted pair exactly when t1 <= 100 < t2", () => {
    let total = 0;
    let keeping = 0;
    const unexpected: number[][] = [];
    for (let t1 = 1; t1 <= 199; t1 += 1) {
      for (let t2 = t1 + 1; t2 <= 200; t2 += 1) {
        total += 1;
        const keeps = keepsOwnLevel(t1, t2);
        if (keeps) {
          keeping += 1;
        }
        if (keeps !== (t1 <= 100 && t2 > 100)) {
          unexpected.push([t1, t2]);
        }
      }
    }
    expect(unexpected).toEqual([]);
    expect(total).toBe(19900);
    expect(keeping).toBe(10000);
  });

  it("changes the level of a +1 or -1 answer when the thresholds are outside that range", () => {
    // t1 above 100: the answer +1 (score 100) falls to level 0.
    expect(levelOf(roundRatio(1, 1), 150, 200)).toBe(0);
    expect(levelOf(roundRatio(-1, 1), 150, 200)).toBe(0);
    // t2 at or below 100: the answer +1 (score 100) rises to level +2.
    expect(levelOf(roundRatio(1, 1), 50, 100)).toBe(2);
    expect(levelOf(roundRatio(-1, 1), 50, 100)).toBe(-2);
    // MapConfigSchema accepts both pairs.
    expect(MapConfigSchema.safeParse({ thresholds: { t1: 150, t2: 200 }, guidanceMaxThemes: 1 }).success).toBe(true);
    expect(MapConfigSchema.safeParse({ thresholds: { t1: 50, t2: 100 }, guidanceMaxThemes: 1 }).success).toBe(true);
  });
});