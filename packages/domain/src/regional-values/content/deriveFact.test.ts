import { RealFactSchema } from "@ehime-vote-navigator/contracts";
import type { RealFact } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { computeDerivedValue, deriveFact, effectiveVerification } from "./deriveFact.js";
import type { DeriveFactInput } from "./deriveFact.js";
import { factGroundingText } from "./factGroundingText.js";
import { checkGrounding } from "./checkGrounding.js";

// 16.3: deriveFact (the three operations), the refusals, and effectiveVerification.

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const VERIFIED = { status: "VERIFIED", verifierId: "verifier-1", verifiedAt: "2026-02-02T09:00:00Z" };

function fact(overrides: Record<string, unknown> = {}): RealFact {
  return RealFactSchema.parse({
    dataKind: "REAL_AI",
    factId: "fact-a",
    sentence: "架空市の空き家は100戸です。",
    value: { amount: 100, unit: "戸" },
    surveyDate: 2024,
    area: "架空市",
    publisher: "試験用の公開者",
    sourceUrl: "https://example.com/a.csv",
    datasetUrl: "https://example.com/data",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    retrievedAt: "2026-02-01T00:00:00Z",
    sha256: SHA_A,
    locator: { kind: "text-lines", startLine: 2, endLine: 101 },
    method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "行数を数える" },
    verification: VERIFIED,
    ...overrides,
  });
}

/** The later value of a quantity and the earlier value of it. */
const after = (overrides: Record<string, unknown> = {}) =>
  fact({ factId: "fact-after", value: { amount: 480, unit: "戸" }, surveyDate: 2024, ...overrides });
const before = (overrides: Record<string, unknown> = {}) =>
  fact({ factId: "fact-before", value: { amount: 420, unit: "戸" }, surveyDate: 2023, ...overrides });

function derive(overrides: Partial<DeriveFactInput> = {}) {
  return deriveFact({
    factId: "fact-derived",
    operation: "DIFFERENCE",
    operands: [after(), before()],
    subject: "空き家の数",
    description: "後の値から前の値を引く",
    ...overrides,
  });
}

function derived(overrides: Partial<DeriveFactInput> = {}): RealFact {
  const result = derive(overrides);
  if (!result.ok) {
    throw new Error(`deriveFact refused: ${result.code} ${JSON.stringify(result.violations)}`);
  }
  return result.fact;
}

describe("computeDerivedValue", () => {
  const pair = (numerator: string, denominator: string) => ({ numerator, denominator });

  it("computes a difference: the first minus the second, in the unit of both", () => {
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 480, unit: "戸" }, { amount: 420, unit: "戸" }])).toEqual({
      ok: true,
      value: { amount: 60, unit: "戸" },
    });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 420, unit: "戸" }, { amount: 480, unit: "戸" }])).toEqual({
      ok: true,
      value: { amount: -60, unit: "戸" },
    });
  });

  it("computes a percent change over the second value, in %", () => {
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 480, unit: "戸" }, { amount: 420, unit: "戸" }])).toEqual({
      ok: true,
      value: { amount: 14.29, unit: "%" },
    });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 90, unit: "人" }, { amount: 120, unit: "人" }])).toEqual({
      ok: true,
      value: { amount: -25, unit: "%" },
    });
  });

  it("computes a ratio: a percent for the same unit, and the ratio with the pair as its unit for another pair", () => {
    expect(computeDerivedValue("RATIO", [{ amount: 3500, unit: "人" }, { amount: 12000, unit: "人" }], pair("人", "人"))).toEqual({
      ok: true,
      value: { amount: 29.17, unit: "%" },
    });
    expect(computeDerivedValue("RATIO", [{ amount: 100, unit: "戸" }, { amount: 40, unit: "世帯" }], pair("戸", "世帯"))).toEqual({
      ok: true,
      value: { amount: 2.5, unit: "戸/世帯" },
    });
  });

  it("rounds half away from zero to two decimals, and does not give -0", () => {
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 0.125, unit: "u" }, { amount: 0, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: 0.13, unit: "u" },
    });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 0, unit: "u" }, { amount: 0.125, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: -0.13, unit: "u" },
    });
    const zero = computeDerivedValue("DIFFERENCE", [{ amount: 5, unit: "u" }, { amount: 5, unit: "u" }]);
    expect(zero.ok && Object.is(zero.value.amount, 0)).toBe(true);
  });

  it("rounds the exact decimal, not the binary floating point value: 2.005 - 2 is 0.01 and 1.005 is 1.01", () => {
    // 2.005 - 2 is 0.004999999999999893 in floating point, which a rounding of that number makes 0.
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 2.005, unit: "u" }, { amount: 2, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: 0.01, unit: "u" },
    });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 1.005, unit: "u" }, { amount: 0, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: 1.01, unit: "u" },
    });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 0.1, unit: "u" }, { amount: 0.3, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: -0.2, unit: "u" },
    });
    // 1/8 of a hundred is 12.5, and 5/8 is 62.5; 1 over 800 is 0.125 percent, which is 0.13.
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: 800, unit: "人" }], { numerator: "人", denominator: "人" })).toEqual({
      ok: true,
      value: { amount: 0.13, unit: "%" },
    });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 1.0005, unit: "u" }, { amount: 1, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: 0.05, unit: "%" },
    });
  });

  it("refuses a value that is not zero but is written as zero, and a value that is too large to keep", () => {
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 0, unit: "u" }, { amount: 0.001, unit: "u" }])).toEqual({ ok: false, code: "ROUNDS_TO_ZERO" });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 0.004, unit: "u" }, { amount: 0, unit: "u" }])).toEqual({ ok: false, code: "ROUNDS_TO_ZERO" });
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: 100000, unit: "人" }], { numerator: "人", denominator: "人" })).toEqual({
      ok: false,
      code: "ROUNDS_TO_ZERO",
    });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 1e300, unit: "u" }, { amount: 0, unit: "u" }])).toEqual({ ok: false, code: "VALUE_OUT_OF_RANGE" });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: Number.POSITIVE_INFINITY, unit: "u" }, { amount: 0, unit: "u" }])).toEqual({
      ok: false,
      code: "VALUE_OUT_OF_RANGE",
    });
    // A numerator of zero is exactly zero, not a small value.
    expect(computeDerivedValue("RATIO", [{ amount: 0, unit: "人" }, { amount: 5, unit: "人" }], { numerator: "人", denominator: "人" })).toEqual({
      ok: true,
      value: { amount: 0, unit: "%" },
    });
  });

  it("refuses a negative value for a ratio and a percent change, and a negative denominator or base, and allows it for a difference", () => {
    const pair = { numerator: "人", denominator: "人" };
    expect(computeDerivedValue("RATIO", [{ amount: -1, unit: "人" }, { amount: 5, unit: "人" }], pair)).toEqual({ ok: false, code: "NEGATIVE_OPERAND" });
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: -5, unit: "人" }], pair)).toEqual({ ok: false, code: "NEGATIVE_OPERAND" });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: -1, unit: "人" }, { amount: 5, unit: "人" }])).toEqual({ ok: false, code: "NEGATIVE_OPERAND" });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 1, unit: "人" }, { amount: -5, unit: "人" }])).toEqual({ ok: false, code: "NEGATIVE_OPERAND" });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: -3, unit: "人" }, { amount: -5, unit: "人" }])).toEqual({ ok: true, value: { amount: 2, unit: "人" } });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: -3, unit: "人" }, { amount: 5, unit: "人" }])).toEqual({ ok: true, value: { amount: -8, unit: "人" } });
  });

  it("keeps the unit of a ratio of two different units, and refuses a pair that does not say the units of the values", () => {
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "戸" }, { amount: 3, unit: "世帯" }], { numerator: "戸", denominator: "世帯" })).toEqual({
      ok: true,
      value: { amount: 0.33, unit: "戸/世帯" },
    });
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "戸" }, { amount: 3, unit: "世帯" }], { numerator: "世帯", denominator: "戸" })).toEqual({
      ok: false,
      code: "UNIT_PAIR_INVALID",
    });
  });

  it("does not turn 5.3 - 2.1 into 3.1999999999999997", () => {
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 5.3, unit: "u" }, { amount: 2.1, unit: "u" }])).toEqual({
      ok: true,
      value: { amount: 3.2, unit: "u" },
    });
  });

  it("refuses a zero denominator, different units, and a unit pair that is missing or is not the units", () => {
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: 0, unit: "人" }], pair("人", "人"))).toEqual({ ok: false, code: "DIVISION_BY_ZERO" });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 1, unit: "人" }, { amount: 0, unit: "人" }])).toEqual({ ok: false, code: "DIVISION_BY_ZERO" });
    expect(computeDerivedValue("DIFFERENCE", [{ amount: 1, unit: "人" }, { amount: 1, unit: "戸" }])).toEqual({ ok: false, code: "UNIT_MISMATCH" });
    expect(computeDerivedValue("PERCENT_CHANGE", [{ amount: 1, unit: "人" }, { amount: 1, unit: "戸" }])).toEqual({ ok: false, code: "UNIT_MISMATCH" });
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: 1, unit: "人" }])).toEqual({ ok: false, code: "UNIT_PAIR_INVALID" });
    expect(computeDerivedValue("RATIO", [{ amount: 1, unit: "人" }, { amount: 1, unit: "戸" }], pair("人", "人"))).toEqual({ ok: false, code: "UNIT_PAIR_INVALID" });
  });
});

describe("deriveFact: the three operations", () => {
  it("derives a difference of two values over time, as a PROVISIONAL fact that is valid", () => {
    const result = derive();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fact: derivedFact } = result;
    expect(derivedFact.value).toEqual({ amount: 60, unit: "戸" });
    expect(derivedFact.sentence).toBe("架空市の空き家の数は、2023年から2024年にかけて60戸増加しました。");
    expect(derivedFact.verification).toEqual({ status: "PROVISIONAL" });
    expect(derivedFact.method).toEqual({
      kind: "DERIVED",
      operation: "DIFFERENCE",
      operandFactIds: ["fact-after", "fact-before"],
      description: "後の値から前の値を引く",
    });
    expect(derivedFact.surveyDate).toBe(2024);
    expect(derivedFact.area).toBe("架空市");
    expect(RealFactSchema.safeParse(derivedFact).success).toBe(true);
  });

  it("says a decrease with the words for a decrease, and no change with the words for no change", () => {
    const lower = derive({ operands: [after({ value: { amount: 400, unit: "戸" } }), before()] });
    expect(lower.ok && lower.fact.sentence).toBe("架空市の空き家の数は、2023年から2024年にかけて20戸減少しました。");
    expect(lower.ok && lower.fact.value).toEqual({ amount: -20, unit: "戸" });
    const same = derive({ operands: [after({ value: { amount: 420, unit: "戸" } }), before()] });
    expect(same.ok && same.fact.sentence).toBe("架空市の空き家の数は、2023年から2024年にかけて変わりませんでした。");
    expect(same.ok && same.fact.value).toEqual({ amount: 0, unit: "戸" });
  });

  it("derives a percent change", () => {
    const result = derive({ operation: "PERCENT_CHANGE", description: "変化率" });
    expect(result.ok && result.fact.value).toEqual({ amount: 14.29, unit: "%" });
    expect(result.ok && result.fact.sentence).toBe("架空市の空き家の数は、2023年から2024年にかけて14.29%増加しました。");
  });

  it("derives a ratio, with the date of both values when they are the same, and both when they are not", () => {
    const numerator = fact({ factId: "fact-n", value: { amount: 3500, unit: "人" }, surveyDate: "2024-10-01" });
    const denominator = fact({ factId: "fact-d", value: { amount: 12000, unit: "人" }, surveyDate: "2024-10-01" });
    const same = derive({
      operation: "RATIO",
      operands: [numerator, denominator],
      unitPair: { numerator: "人", denominator: "人" },
      subject: "高齢者の割合",
    });
    expect(same.ok && same.fact.sentence).toBe("架空市の高齢者の割合は、2024年10月1日時点で29.17%です。");
    expect(same.ok && same.fact.value).toEqual({ amount: 29.17, unit: "%" });
    expect(same.ok && same.fact.method).toMatchObject({ unitPair: { numerator: "人", denominator: "人" } });

    const other = derive({
      operation: "RATIO",
      operands: [numerator, fact({ factId: "fact-d", value: { amount: 12000, unit: "人" }, surveyDate: 2020 })],
      unitPair: { numerator: "人", denominator: "人" },
      subject: "高齢者の割合",
    });
    expect(other.ok && other.fact.sentence).toBe("架空市の高齢者の割合は、2024年10月1日と2020年の値から求めると29.17%です。");
    expect(other.ok && other.fact.surveyDate).toBe("2024-10-01");
  });

  it("takes the publisher, the URLs, the license, the SHA-256 and the location from the first operand, and the later time of retrieval", () => {
    const first = after({ publisher: "公開者の甲", sourceUrl: "https://example.com/first.csv", sha256: SHA_A, retrievedAt: "2026-02-01T00:00:00Z" });
    const second = before({ publisher: "公開者の乙", sourceUrl: "https://example.com/second.csv", sha256: SHA_B, retrievedAt: "2026-03-01T00:00:00Z" });
    const result = derive({ operands: [first, second] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fact.publisher).toBe("公開者の甲");
    expect(result.fact.sourceUrl).toBe("https://example.com/first.csv");
    expect(result.fact.sha256).toBe(SHA_A);
    expect(result.fact.locator).toEqual(first.locator);
    expect(result.fact.retrievedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("is deterministic: the same input gives the same fact", () => {
    expect(derive()).toEqual(derive());
  });

  it("makes a sentence that is grounded in the two operands: the years and the values are theirs, the difference is a calculated value", () => {
    const result = derive();
    if (!result.ok) throw new Error("refused");
    const quote = `${factGroundingText(after())} ${factGroundingText(before())}`;
    // The numbers of the operands and their years are found; the difference, 60, is a calculated value and is not.
    const failures = checkGrounding(result.fact.sentence, quote, { properNouns: [] });
    expect(failures.map((failure) => failure.value)).toEqual(["60"]);
  });
});

describe("deriveFact: the refusals", () => {
  it("does not derive from a derived fact (the MVP does not derive from a derived value)", () => {
    const operand = derived();
    const verified = RealFactSchema.parse({ ...operand, verification: VERIFIED });
    const result = derive({ operands: [verified, before()] });
    expect(result).toEqual({ ok: false, code: "DERIVED_OPERAND_NOT_ALLOWED" });
    expect(derive({ operands: [after(), verified] })).toEqual({ ok: false, code: "DERIVED_OPERAND_NOT_ALLOWED" });
    // A derived operand that is not verified is refused for the same reason first.
    expect(derive({ operands: [operand, before()] })).toEqual({ ok: false, code: "DERIVED_OPERAND_NOT_ALLOWED" });
  });

  it("does not derive from an operand that is not VERIFIED", () => {
    expect(derive({ operands: [after({ verification: { status: "PROVISIONAL" } }), before()] })).toEqual({ ok: false, code: "FACT_NOT_VERIFIED" });
    expect(derive({ operands: [after(), before({ verification: { status: "PROVISIONAL" } })] })).toEqual({ ok: false, code: "FACT_NOT_VERIFIED" });
  });

  it("does not derive from the same fact twice, and does not reuse the ID of an operand", () => {
    expect(derive({ operands: [after(), after()] })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(derive({ factId: "fact-after" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(derive({ factId: "fact-before" })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });

  it("does not derive from operands that have different licenses", () => {
    const other = before({ license: { name: "別の利用条件", url: "https://example.com/license" } });
    expect(derive({ operands: [after(), other] })).toEqual({ ok: false, code: "LICENSE_MISMATCH" });
  });

  it("refuses with the violations that checkFactComparison finds", () => {
    expect(derive({ operands: [after(), before({ value: { amount: 40, unit: "世帯" } })] })).toEqual({
      ok: false,
      code: "FACT_COMPARISON_INVALID",
      violations: ["UNIT_MISMATCH"],
    });
    // A change over time is of one area.
    expect(derive({ operands: [after(), before({ area: "架空町" })] })).toEqual({
      ok: false,
      code: "FACT_COMPARISON_INVALID",
      violations: ["AREA_MISMATCH"],
    });
    // A ratio of two areas needs a sentence that names both, and the template names the area of the first.
    const numerator = fact({ factId: "fact-n", value: { amount: 3500, unit: "人" }, area: "架空市" });
    const denominator = fact({ factId: "fact-d", value: { amount: 12000, unit: "人" }, area: "架空町" });
    expect(
      derive({ operation: "RATIO", operands: [numerator, denominator], unitPair: { numerator: "人", denominator: "人" } }),
    ).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["AREA_NOT_STATED"] });
    // The earlier value is first.
    expect(derive({ operands: [before(), after()] })).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["TIME_ORDER_INVALID"] });
    // A ratio needs the unit pair.
    expect(derive({ operation: "RATIO" })).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["UNIT_PAIR_MISSING"] });
    // The definition changed.
    const changed = before({ method: { kind: "COMPUTED", aggregation: "COUNT_ROWS_WHERE", column: "種別", equals: "空き家", description: "別の数え方" } });
    expect(derive({ operands: [after(), changed] })).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["DEFINITION_CHANGED"] });
  });

  it("refuses a division by zero only when the comparison is allowed", () => {
    expect(derive({ operation: "PERCENT_CHANGE", operands: [after(), before({ value: { amount: 0, unit: "戸" } })] })).toEqual({
      ok: false,
      code: "DIVISION_BY_ZERO",
    });
    expect(
      derive({ operation: "PERCENT_CHANGE", operands: [after(), before({ value: { amount: 0, unit: "人" } })] }),
    ).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["UNIT_MISMATCH"] });
  });

  it("refuses a negative base, a value that is written as zero, and a value that cannot be kept, after the comparison is allowed", () => {
    expect(derive({ operation: "PERCENT_CHANGE", operands: [after(), before({ value: { amount: -5, unit: "戸" } })] })).toEqual({
      ok: false,
      code: "NEGATIVE_OPERAND",
    });
    expect(derive({ operands: [after({ value: { amount: 0.004, unit: "戸" } }), before({ value: { amount: 0, unit: "戸" } })] })).toEqual({
      ok: false,
      code: "ROUNDS_TO_ZERO",
    });
    expect(derive({ operands: [after({ value: { amount: 1e300, unit: "戸" } }), before()] })).toEqual({ ok: false, code: "VALUE_OUT_OF_RANGE" });
    // A difference of negative values is a value.
    const negative = derive({ operands: [after({ value: { amount: -3, unit: "戸" } }), before({ value: { amount: -5, unit: "戸" } })] });
    expect(negative.ok && negative.fact.value).toEqual({ amount: 2, unit: "戸" });
  });

  it("refuses a subject that makes the sentence two sentences, because the fact would not be valid", () => {
    expect(derive({ subject: "空き家。数" })).toEqual({ ok: false, code: "INVALID_FACT" });
  });
});

describe("effectiveVerification", () => {
  const operandAfter = after();
  const operandBefore = before();
  const verifiedDerived = RealFactSchema.parse({ ...derived(), verification: VERIFIED });
  const facts = new Map<string, RealFact>([operandAfter, operandBefore].map((item) => [item.factId, item]));
  const unchanged = (item: RealFact) => item.sha256;

  it("keeps a derived fact VERIFIED when the operands are verified, the originals are unchanged and the value is the recomputed value", () => {
    expect(effectiveVerification(verifiedDerived, { factsById: facts, currentSha256: unchanged })).toEqual({ status: "VERIFIED" });
  });

  it("is PROVISIONAL for a derived fact that a person has not verified", () => {
    const fresh = derived();
    expect(effectiveVerification(fresh, { factsById: facts, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["NOT_VERIFIED"],
    });
  });

  it("goes back to PROVISIONAL when an operand is no longer VERIFIED", () => {
    const withdrawn = new Map(facts).set("fact-before", before({ verification: { status: "PROVISIONAL" } }));
    expect(effectiveVerification(verifiedDerived, { factsById: withdrawn, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["OPERAND_NOT_VERIFIED"],
    });
  });

  it("goes back to PROVISIONAL when the original of an operand changed", () => {
    const sha = (item: RealFact) => (item.factId === "fact-before" ? SHA_B : item.sha256);
    const second = new Map(facts).set("fact-before", before({ sha256: SHA_A }));
    expect(effectiveVerification(verifiedDerived, { factsById: second, currentSha256: sha })).toEqual({
      status: "PROVISIONAL",
      reasons: ["OPERAND_NOT_VERIFIED"],
    });
  });

  it("goes back to PROVISIONAL when the original of the first operand changed, which is also the original of the derived fact", () => {
    const sha = (item: RealFact) => (item.sha256 === SHA_A ? SHA_B : item.sha256);
    expect(effectiveVerification(verifiedDerived, { factsById: facts, currentSha256: sha })).toEqual({
      status: "PROVISIONAL",
      reasons: ["SOURCE_CHANGED", "OPERAND_NOT_VERIFIED"],
    });
  });

  it("goes back to PROVISIONAL when the original cannot be checked", () => {
    expect(effectiveVerification(verifiedDerived, { factsById: facts, currentSha256: () => undefined })).toEqual({
      status: "PROVISIONAL",
      reasons: ["SOURCE_CHANGED", "OPERAND_NOT_VERIFIED"],
    });
  });

  it("goes back to PROVISIONAL when the value that is computed again is not the stored value", () => {
    const tampered = RealFactSchema.parse({ ...verifiedDerived, value: { amount: 61, unit: "戸" } });
    expect(effectiveVerification(tampered, { factsById: facts, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["VALUE_MISMATCH"],
    });
    const changedOperand = new Map(facts).set("fact-after", after({ value: { amount: 500, unit: "戸" } }));
    expect(effectiveVerification(verifiedDerived, { factsById: changedOperand, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["VALUE_MISMATCH"],
    });
  });

  it("is PROVISIONAL when an operand cannot be found, and says all the reasons that hold", () => {
    const missing = new Map(facts);
    missing.delete("fact-before");
    expect(effectiveVerification(verifiedDerived, { factsById: missing, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["OPERAND_MISSING"],
    });
    const fresh = derived();
    const sha = (item: RealFact) => (item.sha256 === SHA_A ? SHA_B : item.sha256);
    expect(effectiveVerification(fresh, { factsById: new Map(), currentSha256: sha })).toEqual({
      status: "PROVISIONAL",
      reasons: ["NOT_VERIFIED", "SOURCE_CHANGED", "OPERAND_MISSING"],
    });
  });

  it("does not accept an operand that is a derived fact", () => {
    const inner = RealFactSchema.parse({ ...verifiedDerived, factId: "fact-inner" });
    const nested = new Map(facts).set("fact-after", inner);
    const result = effectiveVerification(verifiedDerived, { factsById: nested, currentSha256: unchanged });
    expect(result.status).toBe("PROVISIONAL");
    expect(result.status === "PROVISIONAL" && result.reasons).toContain("OPERAND_IS_DERIVED");
  });

  it("judges a fact that is not derived by its own record and its original", () => {
    expect(effectiveVerification(operandAfter, { factsById: facts, currentSha256: unchanged })).toEqual({ status: "VERIFIED" });
    expect(effectiveVerification(after({ verification: { status: "PROVISIONAL" } }), { factsById: facts, currentSha256: unchanged })).toEqual({
      status: "PROVISIONAL",
      reasons: ["NOT_VERIFIED"],
    });
    expect(effectiveVerification(operandAfter, { factsById: facts, currentSha256: () => SHA_B })).toEqual({
      status: "PROVISIONAL",
      reasons: ["SOURCE_CHANGED"],
    });
  });

  it("only reads: the stored facts are not changed", () => {
    const frozenFacts = new Map(facts);
    const before1 = JSON.stringify([...frozenFacts.values()]);
    const stored = JSON.stringify(verifiedDerived);
    effectiveVerification(verifiedDerived, { factsById: frozenFacts, currentSha256: () => SHA_B });
    expect(JSON.stringify([...frozenFacts.values()])).toBe(before1);
    expect(JSON.stringify(verifiedDerived)).toBe(stored);
  });
});
