import type { Level } from "@ehime-vote-navigator/contracts";

/**
 * Regional values map: the rounding function R and the level of a score.
 *
 * Both functions are pure and use integers only. A violated precondition is a
 * fault of the calling program, not of the user's data, so it throws a
 * RangeError. Faults in user answers or settings never reach these functions:
 * the layers that return a `Result` (input validation, settings loading) check
 * them first.
 */

/** A score is at most 200 in absolute value (a theme score is a percentage of the maximum). */
const MAX_SCORE = 200;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/** Integer floor division for a positive divisor. BigInt `/` truncates toward zero. */
function floorDivide(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  return dividend % divisor < 0n ? quotient - 1n : quotient;
}

/**
 * R(n, m) = floor((200n + m) / (2m)).
 *
 * This is n / m x 100, rounded to an integer, where a fraction of exactly 0.5
 * is rounded toward positive infinity:
 *   R(1, 8)  = 12.5   -> 13
 *   R(-1, 8) = -12.5  -> -12
 *   R(-1, 3) = -33.33 -> -33
 *   R(1, 3)  = 33.33  -> 33
 *
 * `n` is the weighted sum of the answer values (an integer) and `m` is the sum
 * of the weights of the usable questions (a positive integer). For |n| <= 2m
 * the result lies between -200 and 200.
 *
 * `m = 0` means that no question has an opinion answer. That is not a score of
 * 0, so it is rejected: the caller must report the axis as undetermined and not
 * call this function. A neutral answer (n = 0, m >= 1) is a real score of 0.
 *
 * @throws RangeError when `n` is not a safe integer, `m` is not a positive safe
 * integer, or the result is not a safe integer.
 */
export function roundRatio(n: number, m: number): number {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError("n must be a safe integer");
  }
  if (!Number.isSafeInteger(m) || m <= 0) {
    throw new RangeError("m must be a positive safe integer");
  }

  const rounded = floorDivide(200n * BigInt(n) + BigInt(m), 2n * BigInt(m));
  if (rounded > MAX_SAFE_BIGINT || rounded < MIN_SAFE_BIGINT) {
    throw new RangeError("the rounded ratio is not a safe integer");
  }

  return Number(rounded);
}

/**
 * The level of a theme score, from -2 to +2.
 *
 *   score >= t2         -> +2
 *   t1 <= score < t2    -> +1
 *   -t1 < score < t1    ->  0
 *   -t2 < score <= -t1  -> -1
 *   score <= -t2        -> -2
 *
 * The same function and the same thresholds serve the importance axis and the
 * trade-off axis. It has no axis argument and no state.
 *
 * @throws RangeError when `score` is not an integer from -200 to 200, or when
 * the thresholds are not integers with 0 < t1 < t2 <= 200.
 */
export function levelOf(score: number, t1: number, t2: number): Level {
  if (
    !Number.isSafeInteger(t1) ||
    !Number.isSafeInteger(t2) ||
    t1 < 1 ||
    t1 >= t2 ||
    t2 > MAX_SCORE
  ) {
    throw new RangeError("the thresholds must be integers with 0 < t1 < t2 <= 200");
  }
  if (!Number.isSafeInteger(score) || score < -MAX_SCORE || score > MAX_SCORE) {
    throw new RangeError("score must be an integer from -200 to 200");
  }

  if (score >= t2) {
    return 2;
  }
  if (score >= t1) {
    return 1;
  }
  if (score > -t1) {
    return 0;
  }
  if (score > -t2) {
    return -1;
  }
  return -2;
}