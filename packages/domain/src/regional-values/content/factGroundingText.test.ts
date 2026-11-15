import { FactItemSchema } from "@ehime-vote-navigator/contracts";
import type { FactItem } from "@ehime-vote-navigator/contracts";
import { describe, expect, it } from "vitest";

import { checkGrounding } from "./checkGrounding.js";
import { factGroundingText } from "./factGroundingText.js";

// 16.3: factGroundingText makes the quotation that a sentence of an issue candidate rests on.

const LISTS = { properNouns: [] as string[] };

function fixtureFact(overrides: Record<string, unknown> = {}): FactItem {
  return FactItemSchema.parse({
    dataKind: "FIXTURE",
    factId: "fact-1",
    sentence: "架空市の空き家は100戸です。",
    value: { amount: 100, unit: "戸" },
    surveyDate: "2025-04-01",
    area: "架空市",
    fictionalSourceId: "src-1",
    ...overrides,
  });
}

function realFact(overrides: Record<string, unknown> = {}): FactItem {
  return FactItemSchema.parse({
    dataKind: "REAL_AI",
    factId: "fact-r1",
    sentence: "空き家は100戸です。",
    value: { amount: 100, unit: "戸" },
    surveyDate: "2025-04-01",
    area: "試験用の地域",
    publisher: "試験用の公開者",
    sourceUrl: "https://example.com/a.csv",
    datasetUrl: "https://example.com/data",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    retrievedAt: "2026-02-01T00:00:00Z",
    sha256: "a".repeat(64),
    locator: { kind: "text-lines", startLine: 2, endLine: 101 },
    method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "行数を数える" },
    verification: { status: "PROVISIONAL" },
    ...overrides,
  });
}

describe("factGroundingText: what the text holds", () => {
  it("joins the sentence, the number with its unit, the area and the date with a space", () => {
    const text = factGroundingText(fixtureFact());
    expect(text).toBe("架空市の空き家は100戸です。 100戸 架空市 2025-04-01 2025年4月1日");
  });

  it("writes a date in the two forms, the ISO form and the Japanese form, without a leading zero", () => {
    const text = factGroundingText(fixtureFact({ surveyDate: "2025-04-01" }));
    expect(text).toContain("2025-04-01");
    expect(text).toContain("2025年4月1日");
    expect(factGroundingText(fixtureFact({ surveyDate: "2024-12-31" }))).toContain("2024年12月31日");
  });

  it("writes a year alone as 2025 and 2025年", () => {
    const parts = factGroundingText(fixtureFact({ surveyDate: 2025 })).split(" ");
    expect(parts).toContain("2025");
    expect(parts).toContain("2025年");
  });

  it("writes a number that has a decimal part, and a very large number, without an exponent", () => {
    expect(factGroundingText(fixtureFact({ value: { amount: 12.5, unit: "%" } }))).toContain("12.5%");
    expect(factGroundingText(fixtureFact({ value: { amount: 1e21, unit: "円" } }))).toContain("1000000000000000000000円");
    expect(factGroundingText(fixtureFact({ value: { amount: 0.0000001, unit: "g" } }))).toContain("0.0000001g");
  });

  it("works for a fact of real data and gives the same text for the same fact", () => {
    const fact = realFact();
    expect(factGroundingText(fact)).toBe("空き家は100戸です。 100戸 試験用の地域 2025-04-01 2025年4月1日");
    expect(factGroundingText(fact)).toBe(factGroundingText(fact));
  });
});

describe("factGroundingText: with checkGrounding", () => {
  it("finds the date of a sentence in both forms, 2025年4月1日 and 2025-04-01", () => {
    const quote = factGroundingText(fixtureFact());
    expect(checkGrounding("架空市の空き家は、2025年4月1日時点で100戸です。", quote, LISTS)).toEqual([]);
    expect(checkGrounding("架空市の空き家は、2025-04-01時点で100戸です。", quote, LISTS)).toEqual([]);
  });

  it("finds a year alone, with or without 年", () => {
    const quote = factGroundingText(fixtureFact({ surveyDate: 2025 }));
    expect(checkGrounding("2025年の空き家は100戸です。", quote, LISTS)).toEqual([]);
    expect(checkGrounding("2025の空き家は100戸です。", quote, LISTS)).toEqual([]);
  });

  it("does not find a date that is not the date of the fact", () => {
    const quote = factGroundingText(fixtureFact());
    const failures = checkGrounding("架空市の空き家は、2025年5月1日時点で100戸です。", quote, LISTS);
    expect(failures.some((failure) => failure.kind === "DATE" && failure.value === "2025年5月1日")).toBe(true);
  });

  it("does not find a number that is not in the fact: a calculated value is not found", () => {
    const quote = factGroundingText(fixtureFact({ value: { amount: 480, unit: "戸" }, sentence: "架空市の空き家は480戸です。" }));
    const failures = checkGrounding("空き家は420戸から480戸に増え、差は60戸です。", quote, LISTS);
    expect(failures.map((failure) => failure.value).sort()).toEqual(["420", "60"]);
  });

  it("finds a number with a thousands separator and a decimal number", () => {
    const thousand = factGroundingText(fixtureFact({ value: { amount: 1200, unit: "戸" }, sentence: "架空市の空き家は1200戸です。" }));
    expect(checkGrounding("空き家は1,200戸です。", thousand, LISTS)).toEqual([]);
    const decimal = factGroundingText(fixtureFact({ value: { amount: 12.5, unit: "%" }, sentence: "架空市の割合は12.5%です。" }));
    expect(checkGrounding("割合は12.5%です。", decimal, LISTS)).toEqual([]);
  });

  it("is the quotation of every fact that a sentence rests on: the texts of two facts are joined", () => {
    const first = factGroundingText(fixtureFact());
    const second = factGroundingText(
      fixtureFact({ factId: "fact-2", sentence: "架空市の世帯は250世帯です。", value: { amount: 250, unit: "世帯" }, surveyDate: 2024 }),
    );
    expect(checkGrounding("空き家は100戸、世帯は250世帯です。", `${first} ${second}`, LISTS)).toEqual([]);
    expect(checkGrounding("空き家は100戸、世帯は250世帯です。", first, LISTS).map((failure) => failure.value)).toEqual(["250"]);
  });
});
