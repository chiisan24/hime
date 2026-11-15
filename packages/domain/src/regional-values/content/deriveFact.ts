import { RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { RealFact } from "@ehime-vote-navigator/contracts";

import { checkFactComparison } from "./factComparison.js";
import type { ComparisonViolation, DerivedOperation, UnitPair } from "./factComparison.js";
import { decimalText, isLaterSurvey, surveyLabel } from "./surveyDate.js";

/**
 * A fact item that is derived from two fact items that a person verified (Req 7.25): a ratio, a
 * difference, or a percent change. The value is computed by a fixed rule, the sentence is made
 * from a fixed template, and the result is PROVISIONAL until a person checks the recomputed value
 * against the values of the operands (`verify-fact`, 13.11). An AI computes nothing.
 *
 * This file is for the build and the draft process, not for the browser.
 */

/** The number of decimals of a derived value. A value is rounded half away from zero to this many. */
export const DERIVED_DECIMALS = 2;

export type DerivedValue = Readonly<{ amount: number; unit: string }>;

/**
 * Exact decimal arithmetic. A value is the decimal that it is written as (the shortest text that
 * gives the same number: 2.005 is 2.005, not 2.00499999999999989...), as whole digits and a scale.
 * The difference of two decimals and the ratio of two decimals are then exact, and only the last
 * rounding is made, so a value that is exactly half is rounded away from zero as it says, and a
 * binary floating point error does not decide the direction.
 */
type Decimal = Readonly<{ digits: bigint; scale: number }>;

function toDecimal(amount: number): Decimal {
  const text = decimalText(amount);
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const digits = BigInt(`${whole}${fraction}`);
  return { digits: negative ? -digits : digits, scale: fraction.length };
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);
const atScale = (value: Decimal, scale: number): bigint => value.digits * pow10(scale - value.scale);

/** The quotient of two whole numbers (the denominator is positive), rounded half away from zero. */
function divideRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

const STORED_DECIMALS = pow10(DERIVED_DECIMALS);

export type ComputeDerivedFailure =
  | "DIVISION_BY_ZERO"
  | "UNIT_MISMATCH"
  | "UNIT_PAIR_INVALID"
  | "NEGATIVE_OPERAND"
  | "ROUNDS_TO_ZERO"
  | "VALUE_OUT_OF_RANGE";

/**
 * The value of an operation on two values. The same function makes the value of a derived fact
 * and the value that `effectiveVerification` computes again, so a stored value is compared with
 * the value that the rule gives.
 *
 *  - RATIO: the first over the second, with the unit pair of the method. A ratio of the same unit
 *    (people over people) is a percent: 100 times the ratio, in %. Another pair keeps the ratio
 *    as it is and its unit is the pair (戸/世帯). Both values are not negative, and the denominator
 *    is more than zero.
 *  - DIFFERENCE: the first minus the second. The units are the same, and so is the unit of the
 *    result. A difference can be negative, and the values can be (a net change is a value).
 *  - PERCENT_CHANGE: the first minus the second, over the second, as a percent. Both values are
 *    not negative, and the base (the second) is more than zero: a change from a negative base has
 *    no meaning.
 *
 * The result has `DERIVED_DECIMALS` decimals. A value that is not zero but would be written as
 * zero is refused (`ROUNDS_TO_ZERO`): "0%" for a small share says a different thing.
 */
export function computeDerivedValue(
  operation: DerivedOperation,
  operands: readonly [DerivedValue, DerivedValue],
  unitPair?: UnitPair,
): Readonly<{ ok: true; value: DerivedValue }> | Readonly<{ ok: false; code: ComputeDerivedFailure }> {
  const [first, second] = operands;
  if (!Number.isFinite(first.amount) || !Number.isFinite(second.amount)) {
    return { ok: false, code: "VALUE_OUT_OF_RANGE" };
  }
  const left = toDecimal(first.amount);
  const right = toDecimal(second.amount);
  const finish = (rounded: bigint, exactlyZero: boolean, unit: string) => {
    if (rounded === 0n && !exactlyZero) {
      return { ok: false, code: "ROUNDS_TO_ZERO" } as const;
    }
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < -BigInt(Number.MAX_SAFE_INTEGER)) {
      return { ok: false, code: "VALUE_OUT_OF_RANGE" } as const;
    }
    return { ok: true, value: { amount: Number(rounded) / Number(STORED_DECIMALS), unit } } as const;
  };

  if (operation === "RATIO") {
    if (unitPair === undefined || unitPair.numerator !== first.unit || unitPair.denominator !== second.unit) {
      return { ok: false, code: "UNIT_PAIR_INVALID" };
    }
    if (right.digits === 0n) {
      return { ok: false, code: "DIVISION_BY_ZERO" };
    }
    if (left.digits < 0n || right.digits < 0n) {
      return { ok: false, code: "NEGATIVE_OPERAND" };
    }
    const percent = unitPair.numerator === unitPair.denominator;
    const factor = percent ? STORED_DECIMALS * 100n : STORED_DECIMALS;
    const rounded = divideRound(left.digits * pow10(right.scale) * factor, right.digits * pow10(left.scale));
    return finish(rounded, left.digits === 0n, percent ? "%" : `${unitPair.numerator}/${unitPair.denominator}`);
  }

  if (first.unit !== second.unit) {
    return { ok: false, code: "UNIT_MISMATCH" };
  }
  const scale = Math.max(left.scale, right.scale);
  const difference = atScale(left, scale) - atScale(right, scale);
  if (operation === "DIFFERENCE") {
    return finish(divideRound(difference * STORED_DECIMALS, pow10(scale)), difference === 0n, first.unit);
  }
  if (right.digits === 0n) {
    return { ok: false, code: "DIVISION_BY_ZERO" };
  }
  if (left.digits < 0n || right.digits < 0n) {
    return { ok: false, code: "NEGATIVE_OPERAND" };
  }
  return finish(divideRound(difference * STORED_DECIMALS * 100n, atScale(right, scale)), difference === 0n, "%");
}

export type DeriveFactInput = Readonly<{
  factId: string;
  operation: DerivedOperation;
  /** A ratio: the numerator then the denominator. A difference and a percent change: the later value then the earlier value. */
  operands: readonly [RealFact, RealFact];
  /** The units of the numerator and the denominator. A ratio needs it. */
  unitPair?: UnitPair;
  /** The name of the derived quantity in the sentence, for example 空き家の数. A person writes it. */
  subject: string;
  /** The explanation of the method, as in `method.description`. */
  description: string;
}>;

export type DeriveFactFailureCode =
  | "DERIVED_OPERAND_NOT_ALLOWED"
  | "FACT_NOT_VERIFIED"
  | "INVALID_INPUT"
  | "LICENSE_MISMATCH"
  | "FACT_COMPARISON_INVALID"
  | "DIVISION_BY_ZERO"
  | "NEGATIVE_OPERAND"
  | "ROUNDS_TO_ZERO"
  | "VALUE_OUT_OF_RANGE"
  | "INVALID_FACT";

export type DeriveFactResult =
  | Readonly<{ ok: true; fact: RealFact }>
  | Readonly<{ ok: false; code: DeriveFactFailureCode; violations?: readonly ComparisonViolation[] }>;

/** The sentence of a derived fact, from a fixed template. It names the area and the dates that the values are of. */
function sentenceOf(input: DeriveFactInput, value: DerivedValue): string {
  const [first, second] = input.operands;
  const lead = `${first.area}の${input.subject}は、`;
  const firstLabel = surveyLabel(first.surveyDate);
  const secondLabel = surveyLabel(second.surveyDate);
  if (input.operation === "RATIO") {
    const when = firstLabel === secondLabel ? `${firstLabel}時点で` : `${firstLabel}と${secondLabel}の値から求めると`;
    return `${lead}${when}${decimalText(value.amount)}${value.unit}です。`;
  }
  const span = `${secondLabel}から${firstLabel}にかけて`;
  if (value.amount === 0) {
    return `${lead}${span}変わりませんでした。`;
  }
  const change = `${decimalText(Math.abs(value.amount))}${value.unit}`;
  return `${lead}${span}${change}${value.amount > 0 ? "増加" : "減少"}しました。`;
}

/**
 * Derives a fact item from two operands. It refuses, with a code, when:
 *  - an operand is a derived fact (the MVP does not derive from a derived value);
 *  - an operand is not VERIFIED;
 *  - the two operands are the same fact, or the new ID is the ID of an operand;
 *  - the licenses of the operands are different (the derived fact has one license);
 *  - the comparison is not allowed (`checkFactComparison`: units, area, dates, order, definition),
 *    with the violations;
 *  - the denominator is zero;
 *  - the result is not a valid fact item (for example, the subject makes the sentence two sentences).
 *
 * The derived fact takes the publisher, the URLs, the license, the SHA-256 and the location from
 * the first operand, the later survey date, and the later time of retrieval. Its method names the
 * two operands. It is PROVISIONAL.
 */
export function deriveFact(input: DeriveFactInput): DeriveFactResult {
  const [first, second] = input.operands;

  if (first.method.kind === "DERIVED" || second.method.kind === "DERIVED") {
    return { ok: false, code: "DERIVED_OPERAND_NOT_ALLOWED" };
  }
  if (first.verification.status !== "VERIFIED" || second.verification.status !== "VERIFIED") {
    return { ok: false, code: "FACT_NOT_VERIFIED" };
  }
  if (first.factId === second.factId || input.factId === first.factId || input.factId === second.factId) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (first.license.name !== second.license.name || first.license.url !== second.license.url) {
    return { ok: false, code: "LICENSE_MISMATCH" };
  }

  const computed = computeDerivedValue(input.operation, [first.value, second.value], input.unitPair);
  // The sentence names the area and the dates, which do not depend on the value, so the sentence can
  // be checked even when the value cannot be computed.
  const value: DerivedValue = computed.ok ? computed.value : { amount: 0, unit: first.value.unit };
  const sentence = sentenceOf(input, value);

  const comparison = checkFactComparison({
    operands: [first, second],
    use: { kind: "DERIVE", operation: input.operation, ...(input.unitPair === undefined ? {} : { unitPair: input.unitPair }) },
    sentence,
  });
  if (!comparison.ok) {
    return { ok: false, code: comparison.code, violations: comparison.violations };
  }
  if (!computed.ok) {
    // The units were checked by the comparison above, so what remains is a value that cannot be written.
    const known = ["DIVISION_BY_ZERO", "NEGATIVE_OPERAND", "ROUNDS_TO_ZERO", "VALUE_OUT_OF_RANGE"] as const;
    const code = known.find((candidate) => candidate === computed.code);
    return { ok: false, code: code ?? "INVALID_FACT" };
  }

  const retrievedAt = Date.parse(second.retrievedAt) > Date.parse(first.retrievedAt) ? second.retrievedAt : first.retrievedAt;
  const fact = {
    dataKind: "REAL_AI",
    factId: input.factId,
    sentence,
    value: computed.value,
    surveyDate: isLaterSurvey(second.surveyDate, first.surveyDate) ? second.surveyDate : first.surveyDate,
    area: first.area,
    publisher: first.publisher,
    sourceUrl: first.sourceUrl,
    datasetUrl: first.datasetUrl,
    license: first.license,
    retrievedAt,
    sha256: first.sha256,
    locator: first.locator,
    method: {
      kind: "DERIVED",
      operation: input.operation,
      operandFactIds: [first.factId, second.factId],
      ...(input.unitPair === undefined ? {} : { unitPair: { numerator: input.unitPair.numerator, denominator: input.unitPair.denominator } }),
      description: input.description,
    },
    verification: { status: "PROVISIONAL" },
  };
  const parsed = RealFactSchema.safeParse(fact);
  return parsed.success ? { ok: true, fact: parsed.data } : { ok: false, code: "INVALID_FACT" };
}

/** Why a fact is PROVISIONAL now, although the record may say VERIFIED. The order of this list is the order of the result. */
export const PROVISIONAL_REASONS = [
  "NOT_VERIFIED",
  "SOURCE_CHANGED",
  "OPERAND_MISSING",
  "OPERAND_IS_DERIVED",
  "OPERAND_NOT_VERIFIED",
  "VALUE_MISMATCH",
] as const;

export type ProvisionalReason = (typeof PROVISIONAL_REASONS)[number];

export type EffectiveVerification =
  | Readonly<{ status: "VERIFIED" }>
  | Readonly<{ status: "PROVISIONAL"; reasons: readonly ProvisionalReason[] }>;

export type EffectiveVerificationContext = Readonly<{
  /** The fact items as they are stored now, to find the operands of a derived fact. */
  factsById: ReadonlyMap<string, RealFact>;
  /** The SHA-256 of the original as it is now. `undefined`: the original cannot be checked, which counts as changed. */
  currentSha256: (fact: RealFact) => string | undefined;
}>;

/**
 * The verification state that counts now. A fact is VERIFIED when the record says VERIFIED and the
 * original has the SHA-256 that was recorded. A derived fact is VERIFIED only when, besides that,
 * both operands are effectively VERIFIED and are not derived facts, and the value that is computed
 * again from the values of the operands is the stored value. Otherwise it is PROVISIONAL with the
 * reasons. It reads only: the stored data is not changed (a build reads, and a person writes).
 */
export function effectiveVerification(fact: RealFact, context: EffectiveVerificationContext): EffectiveVerification {
  const reasons = new Set<ProvisionalReason>();
  if (fact.verification.status !== "VERIFIED") {
    reasons.add("NOT_VERIFIED");
  }
  if (context.currentSha256(fact) !== fact.sha256) {
    reasons.add("SOURCE_CHANGED");
  }

  if (fact.method.kind === "DERIVED") {
    const method = fact.method;
    const operands = method.operandFactIds.map((id) => context.factsById.get(id));
    const [first, second] = operands;
    if (first === undefined || second === undefined) {
      reasons.add("OPERAND_MISSING");
    }
    // Each operand that can be found is judged on its own, so every reason that holds is said.
    for (const operand of [first, second]) {
      if (operand === undefined) {
        continue;
      }
      if (operand.method.kind === "DERIVED") {
        reasons.add("OPERAND_IS_DERIVED");
      }
      if (operand.verification.status !== "VERIFIED" || context.currentSha256(operand) !== operand.sha256) {
        reasons.add("OPERAND_NOT_VERIFIED");
      }
    }
    if (first !== undefined && second !== undefined) {
      const computed = computeDerivedValue(method.operation, [first.value, second.value], method.unitPair);
      if (!computed.ok || computed.value.amount !== fact.value.amount || computed.value.unit !== fact.value.unit) {
        reasons.add("VALUE_MISMATCH");
      }
    }
  }

  return reasons.size === 0
    ? { status: "VERIFIED" }
    : { status: "PROVISIONAL", reasons: PROVISIONAL_REASONS.filter((reason) => reasons.has(reason)) };
}
