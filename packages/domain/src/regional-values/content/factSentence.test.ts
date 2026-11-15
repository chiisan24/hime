import { describe, expect, it } from "vitest";

import { checkFactSentence, computedFactSentence, FACT_SENTENCE_VIOLATIONS } from "./factSentence.js";
import type { FactSentenceCheckInput, FactSentenceViolation } from "./factSentence.js";

// Every area, subject and number here is fictional.

const AREA = "架空県";
const SUBJECT = "避難所の数";

function parts(over: Partial<Parameters<typeof computedFactSentence>[0]> = {}): Parameters<typeof computedFactSentence>[0] {
  return { area: AREA, subject: SUBJECT, surveyDate: "2026-07-27", amount: 1973, unit: "件", ...over };
}

function checkOf(sentence: string, over: Partial<FactSentenceCheckInput> = {}) {
  return checkFactSentence({
    sentence,
    value: { amount: 1973, unit: "件" },
    written: { amount: 1973, unit: "件" },
    area: AREA,
    surveyDates: ["2026-07-27"],
    ...over,
  });
}

function violationsOf(sentence: string, over: Partial<FactSentenceCheckInput> = {}): readonly FactSentenceViolation[] {
  const result = checkOf(sentence, over);
  return result.ok ? [] : result.violations;
}

describe("computedFactSentence", () => {
  it("puts the area, the subject, the date and the value into a fixed template", () => {
    expect(computedFactSentence(parts())).toBe("架空県の避難所の数は、2026年7月27日時点で1973件です。");
  });

  it("writes a year as a year, a decimal as it is and a large number without a separator", () => {
    expect(computedFactSentence(parts({ surveyDate: 2025, amount: 3.5, unit: "%" }))).toBe("架空県の避難所の数は、2025年時点で3.5%です。");
    expect(computedFactSentence(parts({ amount: 12_345_678 }))).toBe("架空県の避難所の数は、2026年7月27日時点で12345678件です。");
    expect(computedFactSentence(parts({ amount: 0 }))).toContain("0件です。");
  });

  it("is one sentence", () => {
    expect(computedFactSentence(parts()).split("。").filter((part) => part !== "")).toHaveLength(1);
  });
});

describe("checkFactSentence: a sentence that is the sentence of its value", () => {
  it.each([
    ["a count with a date", parts(), { amount: 1973, unit: "件" }],
    ["a count of a year", parts({ surveyDate: 2025 }), { amount: 1973, unit: "件" }],
    ["a count of zero", parts({ amount: 0 }), { amount: 0, unit: "件" }],
    ["a decimal and a percent", parts({ amount: 12.5, unit: "%" }), { amount: 12.5, unit: "%" }],
    ["a ratio with a unit pair", parts({ amount: 3.25, unit: "人/か所" }), { amount: 3.25, unit: "人/か所" }],
    ["a unit with a digit", parts({ amount: 8, unit: "km2" }), { amount: 8, unit: "km2" }],
    ["a unit of a square meter", parts({ amount: 8, unit: "㎡" }), { amount: 8, unit: "㎡" }],
    ["a number of seven", parts({ amount: 7 }), { amount: 7, unit: "件" }],
  ] as const)("accepts the template sentence for %s", (_name, sentenceParts, value) => {
    expect(checkOf(computedFactSentence(sentenceParts), { value, written: value, surveyDates: [sentenceParts.surveyDate] })).toEqual({ ok: true });
  });

  it("accepts the number with a comma between groups of digits, in full-width digits, and with a space before the unit", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で1,973件です。")).toEqual([]);
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で１９７３件です。")).toEqual([]);
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で 1973 件です。")).toEqual([]);
  });

  it("accepts the date as the ISO date, and a part of the date as the sentence writes it", () => {
    expect(violationsOf("架空県の避難所の数は、2026-07-27時点で1973件です。")).toEqual([]);
    expect(violationsOf("架空県の避難所の数は、2026年時点で1973件です。")).toEqual([]);
  });

  it("accepts a sentence that names no number for a value that did not change (written is null)", () => {
    expect(violationsOf("架空県の避難所の数は、2025年から2026年にかけて変わりませんでした。", { written: null, value: { amount: 0, unit: "件" }, surveyDates: [2026, 2025] })).toEqual([]);
  });

  it("accepts the numbers of the two operands of a derived value", () => {
    const sentence = "架空県の人口の増減は、2025年と2026年の値から求めると12.5%です。";
    expect(violationsOf(sentence, { value: { amount: 12.5, unit: "%" }, written: { amount: 12.5, unit: "%" }, surveyDates: [2026, 2025] })).toEqual([]);
    expect(violationsOf(sentence, { value: { amount: 12.5, unit: "%" }, written: { amount: 12.5, unit: "%" }, surveyDates: [2026] })).toContain("NUMBER_NOT_GROUNDED");
  });

  it("accepts a number that the words of the definition have", () => {
    const sentence = "架空県の65歳以上の人口は、2026年7月27日時点で1973件です。";
    expect(violationsOf(sentence)).toEqual(["NUMBER_NOT_GROUNDED"]);
    expect(violationsOf(sentence, { definitionTexts: ["年齢区分", "65歳以上"] })).toEqual([]);
  });
});

describe("checkFactSentence: a sentence that is not the sentence of its value", () => {
  it("refuses a number that is not the value, and says that the value is not written", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で1974件です。")).toEqual(["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED"]);
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で19730件です。")).toEqual(["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED"]);
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で197件です。")).toEqual(["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a number that is written in kanji, which is a number that the check cannot compare", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で千九百七十三件です。")).toEqual(["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a number that is among the numbers of the date but is not the value", () => {
    // The value is 7; the sentence says 27, which is the day of the date. The number of the sentence is grounded, and is not the value.
    const sentence = "架空県の避難所の数は、2026年7月27日時点で27件です。";
    expect(violationsOf(sentence, { value: { amount: 7, unit: "件" }, written: { amount: 7, unit: "件" } })).toEqual(["VALUE_NOT_WRITTEN"]);
    // The value is 27 and the sentence says 7, which is the month.
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で7件です。", { value: { amount: 27, unit: "件" }, written: { amount: 27, unit: "件" } })).toEqual(["VALUE_NOT_WRITTEN"]);
  });

  it("does not take a part of a longer number for the value", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で3.5件です。", { value: { amount: 5, unit: "件" }, written: { amount: 5, unit: "件" } })).toContain("VALUE_NOT_WRITTEN");
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で1,973件です。", { value: { amount: 973, unit: "件" }, written: { amount: 973, unit: "件" } })).toContain("VALUE_NOT_WRITTEN");
  });

  it("refuses another unit than the one of the value", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で1973人です。")).toEqual(["VALUE_NOT_WRITTEN"]);
  });

  it("refuses an added number, also when the value is there", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で1973件で、前年より10件増えました。")).toEqual(["NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a date that is not the survey date", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月28日時点で1973件です。")).toContain("DATE_NOT_GROUNDED");
    expect(violationsOf("架空県の避難所の数は、2025年7月27日時点で1973件です。")).toContain("DATE_NOT_GROUNDED");
    expect(violationsOf("架空県の避難所の数は、令和8年7月27日時点で1973件です。")).toContain("DATE_NOT_GROUNDED");
  });

  it("refuses a year that is not the survey year", () => {
    expect(violationsOf("架空県の避難所の数は、2025年時点で1973件です。", { surveyDates: [2026] })).toEqual(["NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a sentence with no number for a value that has to be written", () => {
    expect(violationsOf("架空県の避難所の数は、2026年7月27日時点で多くなっています。")).toEqual(["VALUE_NOT_WRITTEN"]);
  });

  it("refuses a number in a sentence that has to write none", () => {
    expect(violationsOf("架空県の避難所の数は、2025年から2026年にかけて5件増加しました。", { written: null, value: { amount: 0, unit: "件" }, surveyDates: [2026, 2025] })).toEqual(["NUMBER_NOT_GROUNDED"]);
  });

  it("refuses a kanji numeral of a word unless the word is an exempt word", () => {
    const sentence = "架空県の一時避難場所の数は、2026年7月27日時点で1973件です。";
    expect(violationsOf(sentence)).toEqual(["NUMBER_NOT_GROUNDED"]);
    expect(violationsOf(sentence, { numeralExemptWords: ["一時避難場所"] })).toEqual([]);
  });

  it("refuses a proper noun of the list that the area and the definition do not have", () => {
    const sentence = "架空県の松山市の避難所の数は、2026年7月27日時点で1973件です。";
    expect(violationsOf(sentence, { properNouns: ["松山市"] })).toEqual(["PROPER_NOUN_NOT_GROUNDED"]);
    expect(violationsOf(sentence, { properNouns: ["松山市"], definitionTexts: ["市町名 松山市"] })).toEqual([]);
    expect(violationsOf(sentence, { properNouns: ["今治市"] })).toEqual([]);
    expect(violationsOf("松山市の避難所の数は、2026年7月27日時点で1973件です。", { area: "松山市", properNouns: ["松山市"] })).toEqual([]);
  });

  it("gives the violations in the order of the list, once each", () => {
    const sentence = "架空県の松山市の避難所の数は、2026年7月28日時点で9件で、5件増えました。";
    const found = violationsOf(sentence, { properNouns: ["松山市"] });
    expect(found).toEqual(FACT_SENTENCE_VIOLATIONS.filter((violation) => found.includes(violation)));
    expect(new Set(found).size).toBe(found.length);
    expect(found).toEqual(["VALUE_NOT_WRITTEN", "NUMBER_NOT_GROUNDED", "DATE_NOT_GROUNDED", "PROPER_NOUN_NOT_GROUNDED"]);
  });

  it("gives fixed codes only: no number, no date and no name of the sentence", () => {
    const result = checkOf("架空県の秘密の町の避難所の数は、2026年7月28日時点で9731件です。", { properNouns: ["秘密の町"] });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain("9731");
    expect(text).not.toContain("秘密の町");
    expect(text).not.toContain("7月28日");
  });

  it("does not change its input", () => {
    const surveyDates: [string] = ["2026-07-27"];
    const input: FactSentenceCheckInput = {
      sentence: "架空県の避難所の数は、2026年7月27日時点で1973件です。",
      value: { amount: 1973, unit: "件" },
      written: { amount: 1973, unit: "件" },
      area: AREA,
      surveyDates,
      definitionTexts: ["列"],
    };
    const copy = structuredClone(input);
    checkFactSentence(input);
    expect(input).toEqual(copy);
  });
});
