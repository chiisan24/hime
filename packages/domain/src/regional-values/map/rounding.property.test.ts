import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { levelOf, roundRatio } from "./rounding.js";

/** Fixed, so that a green run repeats and a failure can be replayed. */
const SEED = 310_002;
const RUNS = 200;
const PARAMETERS = { seed: SEED, numRuns: RUNS };

/** The largest denominator (the sum of the weights of the usable questions) that is tested. */
const MAX_DENOMINATOR = 100_000;

/** The MVP thresholds. */
const MVP_T1 = 50;
const MVP_T2 = 150;

type Thresholds = { t1: number; t2: number };

/**
 * Independent reference for R(n, m), without the formula under test: the one
 * integer k with (2k - 1) m <= 200 n < (2k + 1) m, which is n / m x 100 rounded
 * to the nearest integer, a fraction of exactly 0.5 going up. BigInt only.
 */
function referenceRound(n: number, m: number): number {
  const scaled = 200n * BigInt(n);
  const bigM = BigInt(m);
  const found: number[] = [];
  for (let k = -201; k <= 201; k += 1) {
    const bigK = BigInt(k);
    if ((2n * bigK - 1n) * bigM <= scaled && scaled < (2n * bigK + 1n) * bigM) {
      found.push(k);
    }
  }
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(`no unique rounding of ${n}/${m}`);
  }
  return only;
}

/**
 * Independent reference for levelOf(roundRatio(n, m), t1, t2), by exact
 * comparison of the unrounded ratio with half-way thresholds. With R rounding
 * a fraction of 0.5 up:
 *   R >= t  <=>  100 n / m >= t - 0.5  <=>  200 n >= (2t - 1) m
 *   R > -t  <=>  R >= 1 - t            <=>  200 n >= -(2t - 1) m
 */
function referenceLevel(n: number, m: number, thresholds: Thresholds): number {
  const scaled = 200n * BigInt(n);
  const bigM = BigInt(m);
  const t1Edge = BigInt(2 * thresholds.t1 - 1) * bigM;
  const t2Edge = BigInt(2 * thresholds.t2 - 1) * bigM;
  if (scaled >= t2Edge) {
    return 2;
  }
  if (scaled >= t1Edge) {
    return 1;
  }
  if (scaled >= -t1Edge) {
    return 0;
  }
  if (scaled >= -t2Edge) {
    return -1;
  }
  return -2;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** True when 100 n / m is exactly k + 0.5, that is, when 200 n / m is an odd integer. */
function isHalfWay(n: number, m: number): boolean {
  const scaled = 200n * BigInt(n);
  const bigM = BigInt(m);
  return scaled % bigM === 0n && (scaled / bigM) % 2n !== 0n;
}

// ---------------------------------------------------------------------------
// Generators. Every generated input respects the preconditions: n and m are
// integers, 1 <= m, |n| <= 2m, and 0 < t1 < t2 <= 200.
// ---------------------------------------------------------------------------

/** Denominators up to 100000; half of them are multiples of 200, where many ratios are exactly half-way. */
function denominatorArb(max: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: 1, max }),
    fc.integer({ min: 1, max: Math.floor(max / 200) }).map((multiple) => 200 * multiple),
  );
}

function ratioArb(max: number): fc.Arbitrary<{ n: number; m: number }> {
  return denominatorArb(max).chain((m) =>
    fc.integer({ min: -2 * m, max: 2 * m }).map((n) => ({ n, m })),
  );
}

const thresholdsArb: fc.Arbitrary<Thresholds> = fc
  .integer({ min: 1, max: 199 })
  .chain((t1) => fc.integer({ min: t1 + 1, max: 200 }).map((t2) => ({ t1, t2 })));

const mvpThresholdsArb: fc.Arbitrary<Thresholds> = fc.constant({ t1: MVP_T1, t2: MVP_T2 });

/** A ratio within 2 of a level boundary (positive or negative side), so that both sides of every boundary are hit. */
function nearBoundaryArb(
  thresholds: fc.Arbitrary<Thresholds>,
): fc.Arbitrary<Thresholds & { n: number; m: number }> {
  return fc
    .record({
      thresholds,
      m: denominatorArb(MAX_DENOMINATOR),
      useT2: fc.boolean(),
      negative: fc.boolean(),
      delta: fc.integer({ min: -2, max: 2 }),
    })
    .map(({ thresholds: pair, m, useT2, negative, delta }) => {
      const threshold = useT2 ? pair.t2 : pair.t1;
      const centre = Math.round(((2 * threshold - 1) * m) / 200);
      const moved = (negative ? -centre : centre) + delta;
      const n = Math.max(-2 * m, Math.min(2 * m, moved));
      return { ...pair, n, m };
    });
}

/** A ratio that is exactly half-way: 200 n / m = q for an odd integer q from -399 to 399. */
const halfWayArb: fc.Arbitrary<{ q: number; n: number; m: number }> = fc
  .integer({ min: -200, max: 199 })
  .map((half) => 2 * half + 1)
  .chain((q) => {
    const divisor = greatestCommonDivisor(Math.abs(q), 200);
    const step = 200 / divisor;
    return fc
      .integer({ min: 1, max: Math.floor(MAX_DENOMINATOR / step) })
      .map((multiple) => ({ q, n: (q / divisor) * multiple, m: step * multiple }));
  });

// ---------------------------------------------------------------------------
// Property 2: the rounding function R
// ---------------------------------------------------------------------------

describe("roundRatio: properties (Property 2)", () => {
  /** **Validates: Requirements 4.5, 12.1** */
  it("equals an independent BigInt reference and lies in [-200, 200], for denominators up to 100000", () => {
    fc.assert(
      fc.property(ratioArb(MAX_DENOMINATOR), ({ n, m }) => {
        const rounded = roundRatio(n, m);
        expect(rounded).toBe(referenceRound(n, m));
        expect(Number.isInteger(rounded)).toBe(true);
        expect(rounded).toBeGreaterThanOrEqual(-200);
        expect(rounded).toBeLessThanOrEqual(200);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 4.5, 12.1** */
  it("rounds an exactly half-way ratio toward positive infinity, on both sides of 0", () => {
    let negative = 0;
    let positive = 0;
    fc.assert(
      fc.property(halfWayArb, ({ q, n, m }) => {
        expect(isHalfWay(n, m)).toBe(true);
        // 100 n / m = q / 2 = k + 0.5 with k = (q - 1) / 2, so R = k + 1 = (q + 1) / 2.
        expect(roundRatio(n, m)).toBe((q + 1) / 2);
        if (q < 0) {
          negative += 1;
        } else {
          positive += 1;
        }
      }),
      PARAMETERS,
    );
    expect(negative).toBeGreaterThan(0);
    expect(positive).toBeGreaterThan(0);
  });

  /** **Validates: Requirements 4.5, 12.1** */
  it("mirrors around 0 except at a half-way ratio, where the pair of results sums to 1", () => {
    fc.assert(
      fc.property(ratioArb(MAX_DENOMINATOR), ({ n, m }) => {
        const sum = roundRatio(n, m) + roundRatio(-n, m);
        expect(sum).toBe(isHalfWay(n, m) ? 1 : 0);
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 4.5, 12.1** */
  it("does not fall as n rises, for a fixed m", () => {
    fc.assert(
      fc.property(
        denominatorArb(MAX_DENOMINATOR).chain((m) =>
          fc
            .tuple(fc.integer({ min: -2 * m, max: 2 * m }), fc.integer({ min: -2 * m, max: 2 * m }))
            .map(([first, second]) => ({
              m,
              low: Math.min(first, second),
              high: Math.max(first, second),
            })),
        ),
        ({ m, low, high }) => {
          expect(roundRatio(low, m)).toBeLessThanOrEqual(roundRatio(high, m));
        },
      ),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 4.5, 12.1** */
  it("is unchanged when n and m are both multiplied by k (R(kn, km) = R(n, m))", () => {
    fc.assert(
      fc.property(
        ratioArb(1000),
        fc.integer({ min: 1, max: 1000 }),
        ({ n, m }, k) => {
          const scaled = roundRatio(k * n, k * m);
          expect(scaled).toBe(roundRatio(n, m));
          expect(scaled).toBe(referenceRound(k * n, k * m));
        },
      ),
      PARAMETERS,
    );
  });

  it("is the same on every call for the same input", () => {
    fc.assert(
      fc.property(ratioArb(MAX_DENOMINATOR), ({ n, m }) => {
        const first = roundRatio(n, m);
        roundRatio(m, n === 0 ? 1 : Math.abs(n));
        expect(roundRatio(n, m)).toBe(first);
      }),
      PARAMETERS,
    );
  });
});

// ---------------------------------------------------------------------------
// The level of a score
// ---------------------------------------------------------------------------

describe("levelOf: properties", () => {
  it("follows the magnitude rule for every valid threshold pair and every score", () => {
    fc.assert(
      fc.property(thresholdsArb, fc.integer({ min: -200, max: 200 }), ({ t1, t2 }, score) => {
        const magnitude = Math.abs(score);
        const steps = magnitude < t1 ? 0 : magnitude < t2 ? 1 : 2;
        const expected = steps === 0 ? 0 : score < 0 ? -steps : steps;
        expect(levelOf(score, t1, t2)).toBe(expected);
      }),
      PARAMETERS,
    );
  });

  it("does not fall as the score rises", () => {
    fc.assert(
      fc.property(
        thresholdsArb,
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: -200, max: 200 }),
        ({ t1, t2 }, first, second) => {
          const low = Math.min(first, second);
          const high = Math.max(first, second);
          expect(levelOf(low, t1, t2)).toBeLessThanOrEqual(levelOf(high, t1, t2));
        },
      ),
      PARAMETERS,
    );
  });

  it("mirrors around 0: levelOf(-s) = -levelOf(s)", () => {
    fc.assert(
      fc.property(thresholdsArb, fc.integer({ min: 0, max: 200 }), ({ t1, t2 }, score) => {
        expect(levelOf(-score, t1, t2) + levelOf(score, t1, t2)).toBe(0);
      }),
      PARAMETERS,
    );
  });

  it("changes level exactly at t1 and t2, on both sides, for every valid threshold pair", () => {
    fc.assert(
      fc.property(thresholdsArb, ({ t1, t2 }) => {
        expect(levelOf(t1 - 1, t1, t2)).toBe(0);
        expect(levelOf(t1, t1, t2)).toBe(1);
        expect(levelOf(t2 - 1, t1, t2)).toBe(1);
        expect(levelOf(t2, t1, t2)).toBe(2);
        expect(levelOf(-(t1 - 1), t1, t2)).toBe(0);
        expect(levelOf(-t1, t1, t2)).toBe(-1);
        expect(levelOf(-(t2 - 1), t1, t2)).toBe(-1);
        expect(levelOf(-t2, t1, t2)).toBe(-2);
      }),
      PARAMETERS,
    );
  });
});

// ---------------------------------------------------------------------------
// The score and its level together
// ---------------------------------------------------------------------------

describe("levelOf(roundRatio(n, m)): properties", () => {
  /** **Validates: Requirements 4.5, 4.6, 4.7, 12.1** */
  it("equals an exact rational reference near every level boundary, for any valid thresholds", () => {
    fc.assert(
      fc.property(nearBoundaryArb(thresholdsArb), ({ t1, t2, n, m }) => {
        expect(levelOf(roundRatio(n, m), t1, t2)).toBe(referenceLevel(n, m, { t1, t2 }));
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 4.5, 4.6, 4.7, 12.1** */
  it("equals the exact rational reference for the MVP thresholds 50 and 150, near the boundaries and elsewhere", () => {
    fc.assert(
      fc.property(nearBoundaryArb(mvpThresholdsArb), ({ n, m }) => {
        expect(levelOf(roundRatio(n, m), MVP_T1, MVP_T2)).toBe(
          referenceLevel(n, m, { t1: MVP_T1, t2: MVP_T2 }),
        );
      }),
      PARAMETERS,
    );
    fc.assert(
      fc.property(ratioArb(MAX_DENOMINATOR), ({ n, m }) => {
        expect(levelOf(roundRatio(n, m), MVP_T1, MVP_T2)).toBe(
          referenceLevel(n, m, { t1: MVP_T1, t2: MVP_T2 }),
        );
      }),
      PARAMETERS,
    );
  });

  /** **Validates: Requirements 4.5, 4.6, 12.1** */
  it("gives a five-step answer its own level with the MVP thresholds, whatever the weight of the single question", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2, max: 2 }), fc.integer({ min: 1, max: 3 }), (value, weight) => {
        expect(levelOf(roundRatio(weight * value, weight), MVP_T1, MVP_T2)).toBe(value);
      }),
      PARAMETERS,
    );
  });
});