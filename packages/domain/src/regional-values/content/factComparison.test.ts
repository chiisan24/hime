import { FactItemSchema } from "@ehime-vote-navigator/contracts";
import type { FactItem } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { checkFactComparison, COMPARISON_VIOLATIONS } from "./factComparison.js";
import type { FactComparisonInput } from "./factComparison.js";

// 16.3, Req 7.26: the conditions of a comparison. One condition at a time, with a pass and a refusal.

function fixtureFact(overrides: Record<string, unknown> = {}): FactItem {
  return FactItemSchema.parse({
    dataKind: "FIXTURE",
    factId: "fact-1",
    sentence: "架空市の空き家は480戸です。",
    value: { amount: 480, unit: "戸" },
    surveyDate: 2024,
    area: "架空市",
    fictionalSourceId: "src-1",
    ...overrides,
  });
}

function realFact(overrides: Record<string, unknown> = {}): FactItem {
  return FactItemSchema.parse({
    dataKind: "REAL_AI",
    factId: "fact-r1",
    sentence: "架空市の空き家は480戸です。",
    value: { amount: 480, unit: "戸" },
    surveyDate: 2024,
    area: "架空市",
    publisher: "試験用の公開者",
    sourceUrl: "https://example.com/a.csv",
    datasetUrl: "https://example.com/data",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    retrievedAt: "2026-02-01T00:00:00Z",
    sha256: "a".repeat(64),
    locator: { kind: "text-lines", startLine: 2, endLine: 101 },
    method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "行数を数える" },
    verification: { status: "VERIFIED", verifierId: "verifier-1", verifiedAt: "2026-02-02T09:00:00Z" },
    ...overrides,
  });
}

function violationsOf(input: FactComparisonInput): readonly string[] {
  const result = checkFactComparison(input);
  return result.ok ? [] : result.violations;
}

const compare = (a: FactItem, b: FactItem, sentence: string | null, extra: Partial<FactComparisonInput> = {}): FactComparisonInput => ({
  operands: [a, b],
  use: { kind: "COMPARE" },
  sentence,
  ...extra,
});

describe("checkFactComparison: a. units", () => {
  it("passes values of the same unit and refuses values of different units", () => {
    expect(checkFactComparison(compare(fixtureFact(), fixtureFact({ factId: "fact-2" }), "どちらも2024年の戸数です。")).ok).toBe(true);
    expect(violationsOf(compare(fixtureFact(), fixtureFact({ factId: "fact-2", value: { amount: 40, unit: "世帯" } }), "文です。"))).toEqual([
      "UNIT_MISMATCH",
    ]);
  });

  it("returns the code FACT_COMPARISON_INVALID with the violations", () => {
    expect(checkFactComparison(compare(fixtureFact(), fixtureFact({ value: { amount: 4, unit: "世帯" } }), "文です。"))).toEqual({
      ok: false,
      code: "FACT_COMPARISON_INVALID",
      violations: ["UNIT_MISMATCH"],
    });
  });

  it("passes a ratio only with the unit pair that is the units of the two values", () => {
    const houses = fixtureFact({ value: { amount: 480, unit: "戸" } });
    const households = fixtureFact({ factId: "fact-2", value: { amount: 400, unit: "世帯" } });
    const ratio = (unitPair?: { numerator: string; denominator: string }): FactComparisonInput => ({
      operands: [houses, households],
      use: { kind: "DERIVE", operation: "RATIO", ...(unitPair === undefined ? {} : { unitPair }) },
      sentence: "文です。",
    });
    expect(checkFactComparison(ratio({ numerator: "戸", denominator: "世帯" })).ok).toBe(true);
    expect(violationsOf(ratio())).toEqual(["UNIT_PAIR_MISSING"]);
    expect(violationsOf(ratio({ numerator: "世帯", denominator: "戸" }))).toEqual(["UNIT_PAIR_MISMATCH"]);
    expect(violationsOf(ratio({ numerator: "戸", denominator: "人" }))).toEqual(["UNIT_PAIR_MISMATCH"]);
  });

  it("needs the unit pair of a ratio also when the two units are the same", () => {
    const input = (unitPair?: { numerator: string; denominator: string }): FactComparisonInput => ({
      operands: [fixtureFact(), fixtureFact({ factId: "fact-2" })],
      use: { kind: "DERIVE", operation: "RATIO", ...(unitPair === undefined ? {} : { unitPair }) },
      sentence: "文です。",
    });
    expect(violationsOf(input())).toEqual(["UNIT_PAIR_MISSING"]);
    expect(checkFactComparison(input({ numerator: "戸", denominator: "戸" })).ok).toBe(true);
  });

  it("needs the same unit for a difference and a percent change", () => {
    for (const operation of ["DIFFERENCE", "PERCENT_CHANGE"] as const) {
      const input: FactComparisonInput = {
        operands: [fixtureFact({ surveyDate: 2024 }), fixtureFact({ factId: "fact-2", surveyDate: 2023, value: { amount: 4, unit: "世帯" } })],
        use: { kind: "DERIVE", operation },
        sentence: "2023年と2024年の値です。",
      };
      expect(violationsOf(input), operation).toContain("UNIT_MISMATCH");
    }
  });
});

describe("checkFactComparison: b. areas", () => {
  const other = fixtureFact({ factId: "fact-2", area: "架空町", value: { amount: 300, unit: "戸" } });

  it("passes values of different areas in a sentence that names both areas", () => {
    expect(checkFactComparison(compare(fixtureFact(), other, "架空市の空き家は480戸、架空町の空き家は300戸です。")).ok).toBe(true);
  });

  it("refuses values of different areas when the sentence does not name both, or is not written", () => {
    expect(violationsOf(compare(fixtureFact(), other, "架空市の空き家は480戸です。"))).toEqual(["AREA_NOT_STATED"]);
    expect(violationsOf(compare(fixtureFact(), other, "架空町の空き家は300戸です。"))).toEqual(["AREA_NOT_STATED"]);
    expect(violationsOf(compare(fixtureFact(), other, null))).toEqual(["AREA_NOT_STATED"]);
  });

  it("finds the names in the sentence whatever the width of the characters and the spaces", () => {
    expect(checkFactComparison(compare(fixtureFact({ area: "ＡＢ市" }), fixtureFact({ factId: "f2", area: "CD町" }), "AB 市と C D 町の値です。")).ok).toBe(true);
  });

  it("refuses a sentence that says that one area is better, with the words of the settings", () => {
    const words = ["優れている", "上回"];
    const input = (sentence: string) => compare(fixtureFact(), other, sentence, { superiorityWords: words });
    expect(violationsOf(input("架空市の空き家は480戸で、架空町の300戸を上回ります。"))).toEqual(["SUPERIORITY_STATED"]);
    expect(violationsOf(input("架空市の空き家は480戸、架空町の空き家は300戸です。"))).toEqual([]);
    // Without the words of the settings, no sentence is judged to say it.
    expect(checkFactComparison(compare(fixtureFact(), other, "架空市の空き家は480戸で、架空町の300戸を上回ります。")).ok).toBe(true);
    expect(checkFactComparison(compare(fixtureFact(), other, "架空市の空き家は480戸で、架空町の300戸を上回ります。", { superiorityWords: [""] })).ok).toBe(true);
  });

  it("does not look for the words of superiority when the areas are the same", () => {
    expect(checkFactComparison(compare(fixtureFact(), fixtureFact({ factId: "f2" }), "上回ります。", { superiorityWords: ["上回"] })).ok).toBe(true);
  });

  it("refuses values of different areas in a time series and in a change over time, whatever the sentence says", () => {
    const sentence = "架空市と架空町の2023年と2024年の値です。";
    const older = fixtureFact({ factId: "f2", area: "架空町", surveyDate: 2023 });
    expect(violationsOf({ operands: [fixtureFact(), older], use: { kind: "TIME_SERIES" }, sentence })).toContain("AREA_MISMATCH");
    expect(violationsOf({ operands: [fixtureFact(), older], use: { kind: "DERIVE", operation: "DIFFERENCE" }, sentence })).toContain("AREA_MISMATCH");
    expect(violationsOf({ operands: [fixtureFact(), older], use: { kind: "DERIVE", operation: "PERCENT_CHANGE" }, sentence })).toContain("AREA_MISMATCH");
  });
});

describe("checkFactComparison: c. survey dates", () => {
  const older = fixtureFact({ factId: "fact-2", surveyDate: 2023 });

  it("passes values of different years in a sentence that names both years", () => {
    expect(checkFactComparison(compare(fixtureFact(), older, "2023年は480戸、2024年は480戸でした。")).ok).toBe(true);
    expect(checkFactComparison(compare(fixtureFact(), older, "２０２３年と２０２４年の値です。")).ok).toBe(true);
  });

  it("refuses values of different years when a year is not in the sentence, or the sentence is not written", () => {
    expect(violationsOf(compare(fixtureFact(), older, "2024年の値です。"))).toEqual(["YEAR_NOT_STATED"]);
    expect(violationsOf(compare(fixtureFact(), older, "2023年の値です。"))).toEqual(["YEAR_NOT_STATED"]);
    expect(violationsOf(compare(fixtureFact(), older, "前の値です。"))).toEqual(["YEAR_NOT_STATED"]);
    expect(violationsOf(compare(fixtureFact(), older, null))).toEqual(["YEAR_NOT_STATED"]);
  });

  it("does not take a year for a part of a longer number", () => {
    expect(violationsOf(compare(fixtureFact(), older, "12023戸と20240戸です。"))).toEqual(["YEAR_NOT_STATED"]);
  });

  it("needs no year in the sentence when the years are the same, with a date or a year", () => {
    expect(checkFactComparison(compare(fixtureFact({ surveyDate: "2024-04-01" }), fixtureFact({ factId: "f2", surveyDate: "2024-10-01" }), "文です。")).ok).toBe(true);
    expect(checkFactComparison(compare(fixtureFact({ surveyDate: "2024-04-01" }), fixtureFact({ factId: "f2", surveyDate: 2024 }), "文です。")).ok).toBe(true);
  });

  it("reads the year of a date and finds it in the sentence", () => {
    const a = fixtureFact({ surveyDate: "2025-04-01" });
    expect(violationsOf(compare(a, older, "2025年4月1日と2023年の値です。"))).toEqual([]);
    expect(violationsOf(compare(a, older, "2023年の値です。"))).toEqual(["YEAR_NOT_STATED"]);
  });

  it("refuses a survey date that cannot be read (a value that did not come through the contract)", () => {
    const broken = { ...fixtureFact(), surveyDate: "2024/04/01" } as unknown as FactItem;
    expect(violationsOf(compare(fixtureFact(), broken, "文です。"))).toEqual(["SURVEY_DATE_UNREADABLE"]);
    const fraction = { ...fixtureFact(), surveyDate: 2024.5 } as unknown as FactItem;
    expect(violationsOf(compare(fixtureFact(), fraction, "文です。"))).toEqual(["SURVEY_DATE_UNREADABLE"]);
  });
});

describe("checkFactComparison: d. the definition of a time series", () => {
  const method = (overrides: Record<string, unknown> = {}) => ({
    kind: "COMPUTED",
    aggregation: "COUNT_ROWS_WHERE",
    column: "種別",
    equals: "避難所",
    description: "種別が避難所の行を数える",
    ...overrides,
  });
  const now = realFact({ method: method() });
  const older = realFact({ factId: "fact-r2", surveyDate: 2023, method: method() });
  const series = (a: FactItem, b: FactItem, extra: Partial<FactComparisonInput> = {}): FactComparisonInput => ({
    operands: [a, b],
    use: { kind: "TIME_SERIES" },
    sentence: "2023年と2024年の値です。",
    ...extra,
  });

  it("passes values with the same definition, whatever the words that explain it", () => {
    expect(checkFactComparison(series(now, older)).ok).toBe(true);
    const reworded = realFact({ factId: "fact-r3", surveyDate: 2023, method: method({ description: "避難所の数（言い換え）" }) });
    expect(checkFactComparison(series(now, reworded)).ok).toBe(true);
  });

  it("refuses values with a changed definition, unless a person confirmed that they may be compared", () => {
    const changed = realFact({ factId: "fact-r4", surveyDate: 2023, method: method({ equals: "一時避難場所" }) });
    expect(violationsOf(series(now, changed))).toEqual(["DEFINITION_CHANGED"]);
    expect(checkFactComparison(series(now, changed, { definitionChangeConfirmed: true })).ok).toBe(true);
    expect(violationsOf(series(now, changed, { definitionChangeConfirmed: false }))).toEqual(["DEFINITION_CHANGED"]);
  });

  it("sees a change of the aggregation, the column, the sheet and the columns of the same row", () => {
    for (const change of [
      { aggregation: "COUNT_ROWS", column: null, equals: null },
      { column: "区分" },
      { sheet: "Sheet2" },
      { dedupeColumns: ["施設名"] },
    ]) {
      const changed = realFact({ factId: "fact-r5", surveyDate: 2023, method: method(change) });
      expect(violationsOf(series(now, changed)), JSON.stringify(change)).toEqual(["DEFINITION_CHANGED"]);
    }
  });

  it("compares a quoted value by what the method says about it (the width of characters does not matter)", () => {
    const quoted = (description: string) => realFact({ method: { kind: "QUOTED", description } });
    expect(checkFactComparison(series(quoted("表の3行目の値"), quoted("表の3行目の値"))).ok).toBe(true);
    expect(checkFactComparison(series(quoted("表の3行目の値"), quoted("表の４行目の値"))).ok).toBe(false);
    expect(checkFactComparison(series(quoted("ABC"), quoted("ＡＢＣ"))).ok).toBe(true);
  });

  it("cannot know the definition of a fact of fictional data, so it asks for the confirmation", () => {
    const fixtureNow = fixtureFact();
    const fixtureOlder = fixtureFact({ factId: "fact-2", surveyDate: 2023 });
    expect(violationsOf(series(fixtureNow, fixtureOlder))).toEqual(["DEFINITION_CHANGED"]);
    expect(checkFactComparison(series(fixtureNow, fixtureOlder, { definitionChangeConfirmed: true })).ok).toBe(true);
  });

  it("does not ask for the definition of a comparison that is not over time", () => {
    const changed = realFact({ factId: "fact-r4", method: method({ equals: "一時避難場所" }) });
    expect(checkFactComparison(compare(now, changed, "文です。")).ok).toBe(true);
  });
});

describe("checkFactComparison: a change over time and derived values", () => {
  const later = fixtureFact({ surveyDate: 2024 });
  const earlier = fixtureFact({ factId: "fact-2", surveyDate: 2023, value: { amount: 420, unit: "戸" } });
  const input = (operation: "DIFFERENCE" | "PERCENT_CHANGE", operands: readonly [FactItem, FactItem]): FactComparisonInput => ({
    operands,
    use: { kind: "DERIVE", operation },
    sentence: "2023年から2024年にかけての値です。",
    definitionChangeConfirmed: true,
  });

  it("needs the first operand to be the later value", () => {
    expect(checkFactComparison(input("DIFFERENCE", [later, earlier])).ok).toBe(true);
    expect(violationsOf(input("DIFFERENCE", [earlier, later]))).toEqual(["TIME_ORDER_INVALID"]);
    expect(violationsOf(input("PERCENT_CHANGE", [earlier, later]))).toEqual(["TIME_ORDER_INVALID"]);
    expect(violationsOf(input("DIFFERENCE", [later, fixtureFact({ factId: "f3" })]))).toEqual(["TIME_ORDER_INVALID"]);
  });

  it("takes a later date of the same year as later, and a year and a date of the same year as the same time", () => {
    const april = fixtureFact({ surveyDate: "2024-04-01" });
    const october = fixtureFact({ factId: "fact-3", surveyDate: "2024-10-01" });
    const sentence = "2024年の値です。";
    const use = { kind: "DERIVE", operation: "DIFFERENCE" } as const;
    expect(violationsOf({ operands: [october, april], use, sentence, definitionChangeConfirmed: true })).toEqual([]);
    expect(violationsOf({ operands: [april, october], use, sentence, definitionChangeConfirmed: true })).toEqual(["TIME_ORDER_INVALID"]);
    expect(violationsOf({ operands: [april, fixtureFact({ factId: "fact-4", surveyDate: 2024 })], use, sentence, definitionChangeConfirmed: true })).toEqual([
      "TIME_ORDER_INVALID",
    ]);
  });

  it("does not need the order or the same area for a ratio", () => {
    const ratio: FactComparisonInput = {
      operands: [earlier, later],
      use: { kind: "DERIVE", operation: "RATIO", unitPair: { numerator: "戸", denominator: "戸" } },
      sentence: "2023年と2024年の値から求めた割合です。",
    };
    expect(checkFactComparison(ratio).ok).toBe(true);
  });

  it("does not derive a value from a derived value (the MVP)", () => {
    const derivedFact = realFact({
      factId: "fact-d",
      method: { kind: "DERIVED", operation: "DIFFERENCE", operandFactIds: ["x", "y"], description: "差" },
    });
    const plain = realFact({ factId: "fact-p" });
    for (const operands of [
      [derivedFact, plain],
      [plain, derivedFact],
    ] as const) {
      const result = checkFactComparison({
        operands,
        use: { kind: "DERIVE", operation: "RATIO", unitPair: { numerator: "戸", denominator: "戸" } },
        sentence: "文です。",
      });
      expect(result).toEqual({ ok: false, code: "FACT_COMPARISON_INVALID", violations: ["DERIVED_OPERAND_NOT_ALLOWED"] });
    }
    // To put a derived value beside another value is not to derive from it.
    expect(checkFactComparison(compare(derivedFact, plain, "文です。")).ok).toBe(true);
  });
});

describe("checkFactComparison: the result", () => {
  it("lists the violations without repeats, in a fixed order", () => {
    const a = fixtureFact({ surveyDate: 2024, area: "架空市", value: { amount: 1, unit: "戸" } });
    const b = fixtureFact({ factId: "f2", surveyDate: 2023, area: "架空町", value: { amount: 1, unit: "人" } });
    const result = checkFactComparison({ operands: [a, b], use: { kind: "TIME_SERIES" }, sentence: null });
    expect(result).toEqual({
      ok: false,
      code: "FACT_COMPARISON_INVALID",
      violations: ["UNIT_MISMATCH", "AREA_MISMATCH", "YEAR_NOT_STATED", "DEFINITION_CHANGED"],
    });
    const order = COMPARISON_VIOLATIONS.filter((violation) => (result.ok ? false : result.violations.includes(violation)));
    expect(result.ok ? [] : [...result.violations]).toEqual(order);
  });

  it("does not change its input and gives the same answer twice", () => {
    const a = fixtureFact();
    const b = fixtureFact({ factId: "f2", surveyDate: 2023 });
    const snapshot = JSON.stringify([a, b]);
    const input = compare(a, b, null);
    expect(checkFactComparison(input)).toEqual(checkFactComparison(input));
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
