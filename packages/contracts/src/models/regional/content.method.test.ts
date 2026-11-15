import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  FactItemSchema,
  FactMethodSchema,
  IssueCardSchema,
  RealFactSchema,
  RealSourceSchema,
  RegionalSourceSchema,
  SourceConversionSchema,
} from "./content.js";

// 16.1: the methods that were added to the fact item (SUM_COLUMN, DERIVED, dedupeColumns, a sheet
// that can be left out) and the record of a conversion of a source. The existing methods keep
// the rules that they had, which content.card.test.ts checks.

type Json = Record<string, unknown>;

const SHA = "a".repeat(64);
const SHA_2 = "b".repeat(64);

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

const count = (overrides: Json = {}): Json => ({
  kind: "COMPUTED",
  aggregation: "COUNT_ROWS",
  column: null,
  equals: null,
  description: "行数を数える",
  ...overrides,
});

const countWhere = (overrides: Json = {}): Json => ({
  kind: "COMPUTED",
  aggregation: "COUNT_ROWS_WHERE",
  column: "種別",
  equals: "避難所",
  description: "種別が避難所の行を数える",
  ...overrides,
});

const sum = (overrides: Json = {}): Json => ({
  kind: "COMPUTED",
  aggregation: "SUM_COLUMN",
  column: "収容人数",
  whereColumn: null,
  equals: null,
  description: "収容人数を合計する",
  ...overrides,
});

const derived = (overrides: Json = {}): Json => ({
  kind: "DERIVED",
  operation: "DIFFERENCE",
  operandFactIds: ["fact-after", "fact-before"],
  description: "後の値から前の値を引く",
  ...overrides,
});

describe("FactMethodSchema: the counts", () => {
  it("accepts a count without a sheet (a CSV has no sheet) and with one", () => {
    expect(FactMethodSchema.safeParse(count()).success).toBe(true);
    expect(FactMethodSchema.safeParse(count({ sheet: "Sheet1" })).success).toBe(true);
    expect(FactMethodSchema.safeParse(countWhere()).success).toBe(true);
    expect(FactMethodSchema.safeParse(countWhere({ sheet: "Sheet1" })).success).toBe(true);
  });

  it("keeps the rules of the counts: COUNT_ROWS has no column and no equals, COUNT_ROWS_WHERE has both", () => {
    expect(rejectedPaths(FactMethodSchema, count({ column: "種別" }))).toContain("column");
    expect(rejectedPaths(FactMethodSchema, count({ equals: "避難所" }))).toContain("equals");
    expect(rejectedPaths(FactMethodSchema, countWhere({ column: null }))).toContain("column");
    expect(rejectedPaths(FactMethodSchema, countWhere({ equals: null }))).toContain("equals");
  });

  it("does not give a count a whereColumn", () => {
    expect(rejectedPaths(FactMethodSchema, count({ whereColumn: null }))).toContain("whereColumn");
    expect(rejectedPaths(FactMethodSchema, countWhere({ whereColumn: "種別" }))).toContain("whereColumn");
  });
});

describe("FactMethodSchema: SUM_COLUMN", () => {
  it("accepts a sum without a condition and a sum with one", () => {
    expect(FactMethodSchema.safeParse(sum()).success).toBe(true);
    expect(FactMethodSchema.safeParse(sum({ whereColumn: "地区", equals: "北区" })).success).toBe(true);
    expect(FactMethodSchema.safeParse(sum({ sheet: "Sheet1" })).success).toBe(true);
  });

  it("needs the column that is added up", () => {
    expect(rejectedPaths(FactMethodSchema, sum({ column: null }))).toContain("column");
    expect(rejectedPaths(FactMethodSchema, sum({ column: "  " }))).toContain("column");
  });

  it("needs whereColumn to be written (null for no condition), and whereColumn and equals to agree", () => {
    expect(rejectedPaths(FactMethodSchema, sum({ whereColumn: undefined }))).toContain("whereColumn");
    expect(rejectedPaths(FactMethodSchema, sum({ whereColumn: "地区", equals: null }))).toContain("whereColumn");
    expect(rejectedPaths(FactMethodSchema, sum({ whereColumn: null, equals: "北区" }))).toContain("whereColumn");
    expect(rejectedPaths(FactMethodSchema, sum({ whereColumn: " ", equals: "北区" }))).toContain("whereColumn");
  });
});

describe("FactMethodSchema: dedupeColumns", () => {
  it.each([count(), countWhere(), sum()])("accepts the columns that decide the same row for %#", (method) => {
    expect(FactMethodSchema.safeParse({ ...method, dedupeColumns: ["施設名"] }).success).toBe(true);
    expect(FactMethodSchema.safeParse({ ...method, dedupeColumns: ["施設名", "所在地"] }).success).toBe(true);
    expect(FactMethodSchema.safeParse({ ...method }).success).toBe(true);
  });

  it("is absent for no columns: an empty list, a blank name and null are not forms of it", () => {
    expect(FactMethodSchema.safeParse(count({ dedupeColumns: [] })).success).toBe(false);
    expect(FactMethodSchema.safeParse(count({ dedupeColumns: [" "] })).success).toBe(false);
    expect(FactMethodSchema.safeParse(count({ dedupeColumns: null })).success).toBe(false);
  });
});

describe("FactMethodSchema: DERIVED", () => {
  it("accepts the three operations", () => {
    expect(FactMethodSchema.safeParse(derived()).success).toBe(true);
    expect(FactMethodSchema.safeParse(derived({ operation: "PERCENT_CHANGE" })).success).toBe(true);
    expect(
      FactMethodSchema.safeParse(derived({ operation: "RATIO", unitPair: { numerator: "戸", denominator: "世帯" } })).success,
    ).toBe(true);
    expect(FactMethodSchema.safeParse(derived({ operation: "RATIO" })).success).toBe(true);
  });

  it("needs exactly two different operands", () => {
    expect(FactMethodSchema.safeParse(derived({ operandFactIds: ["fact-1"] })).success).toBe(false);
    expect(FactMethodSchema.safeParse(derived({ operandFactIds: ["a", "b", "c"] })).success).toBe(false);
    expect(rejectedPaths(FactMethodSchema, derived({ operandFactIds: ["fact-1", "fact-1"] }))).toContain("operandFactIds.1");
  });

  it("gives a unit pair to a RATIO only", () => {
    const pair = { numerator: "戸", denominator: "世帯" };
    expect(rejectedPaths(FactMethodSchema, derived({ operation: "DIFFERENCE", unitPair: pair }))).toContain("unitPair");
    expect(rejectedPaths(FactMethodSchema, derived({ operation: "PERCENT_CHANGE", unitPair: pair }))).toContain("unitPair");
    expect(FactMethodSchema.safeParse(derived({ operation: "RATIO", unitPair: { numerator: "戸" } })).success).toBe(false);
  });

  it("rejects an unknown operation and an extra field", () => {
    expect(FactMethodSchema.safeParse(derived({ operation: "PRODUCT" })).success).toBe(false);
    expect(FactMethodSchema.safeParse(derived({ column: "x" })).success).toBe(false);
  });
});

describe("a fact item with a derived method", () => {
  const realFact = (overrides: Json = {}): Json => ({
    dataKind: "REAL_AI",
    factId: "fact-derived",
    sentence: "架空市の空き家は、2023年から2024年にかけて60戸増えました。",
    value: { amount: 60, unit: "戸" },
    surveyDate: 2024,
    area: "架空市",
    publisher: "試験用の公開者",
    sourceUrl: "https://example.com/a.csv",
    datasetUrl: "https://example.com/data",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    retrievedAt: "2026-02-01T00:00:00Z",
    sha256: SHA,
    locator: { kind: "text-lines", startLine: 2, endLine: 9 },
    method: derived(),
    verification: { status: "PROVISIONAL" },
    ...overrides,
  });

  it("is a real fact: the derived method is accepted on a fact of real data", () => {
    expect(RealFactSchema.safeParse(realFact()).success).toBe(true);
    expect(FactItemSchema.safeParse(realFact()).success).toBe(true);
  });

  it("is never its own operand", () => {
    expect(rejectedPaths(RealFactSchema, realFact({ method: derived({ operandFactIds: ["fact-derived", "fact-before"] }) }))).toContain(
      "method.operandFactIds",
    );
    expect(RealFactSchema.safeParse(realFact({ method: derived({ operandFactIds: ["fact-after", "fact-derived"] }) })).success).toBe(false);
  });

  it("is not a fact of fictional data: a fictional fact has no method", () => {
    const fixtureFact = {
      dataKind: "FIXTURE",
      factId: "fact-1",
      sentence: "架空市の空き家は100戸です。",
      value: { amount: 100, unit: "戸" },
      surveyDate: 2024,
      area: "架空市",
      fictionalSourceId: "src-1",
    };
    expect(FactItemSchema.safeParse(fixtureFact).success).toBe(true);
    expect(FactItemSchema.safeParse({ ...fixtureFact, method: derived() }).success).toBe(false);
  });

  it("stays valid in an issue card of real data", () => {
    const source = {
      dataKind: "REAL_AI",
      sourceId: "src-1",
      revision: "rev-1",
      reference: { kind: "url", url: "https://example.com/a.csv" },
      publisher: "試験用の公開者",
      publishedOn: "2026-01-01",
      retrievedAt: "2026-02-01T00:00:00Z",
      locator: { kind: "text-lines", startLine: 1, endLine: 10 },
      sha256: SHA,
      usage: { status: "CONFIRMED", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" },
      datasetNote: null,
      transmission: { status: "UNKNOWN" },
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    };
    const card = {
      cardId: "card-1",
      themeId: "POPULATION_REVITALIZATION",
      title: "空き家の増加",
      background: "架空市では、空き家が増えています。",
      glossary: [{ term: "空き家", description: "誰も住んでいない家" }],
      quote: { sourceId: "src-1", text: "空き家" },
      aiInvolvement: "HUMAN",
      updatedOn: "2026-05-01",
      approval: { status: "PENDING" },
      dataKind: "REAL_AI",
      sources: [source],
      facts: [realFact()],
    };
    expect(IssueCardSchema.safeParse(card).success).toBe(true);
  });
});

describe("SourceConversionSchema and the conversion of a source", () => {
  const conversion = (overrides: Json = {}): Json => ({
    originalFileName: "shelters.xlsx",
    originalSha256: SHA_2,
    convertedSha256: SHA,
    procedureId: "xlsx-to-csv-1",
    procedureDocSha256: SHA_2,
    convertedBy: "analyst-1",
    convertedAt: "2026-02-02T09:00:00Z",
    correspondence: "ROWS_PRESERVED",
    originalRowCount: 120,
    convertedRowCount: 120,
    ...overrides,
  });

  const source = (overrides: Json = {}): Json => ({
    dataKind: "REAL_AI",
    sourceId: "src-1",
    revision: "rev-1",
    reference: { kind: "url", url: "https://example.com/shelters.xlsx" },
    publisher: "試験用の公開者",
    publishedOn: "2026-01-01",
    retrievedAt: "2026-02-01T00:00:00Z",
    locator: { kind: "text-lines", startLine: 1, endLine: 121 },
    sha256: SHA,
    usage: { status: "CONFIRMED", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" },
    datasetNote: null,
    transmission: { status: "UNKNOWN" },
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    ...overrides,
  });

  it("accepts a source with a conversion, and a source without one", () => {
    expect(RealSourceSchema.safeParse(source()).success).toBe(true);
    expect(RealSourceSchema.safeParse(source({ conversion: conversion() })).success).toBe(true);
  });

  it("needs the number of rows to be the same before and after", () => {
    expect(rejectedPaths(SourceConversionSchema, conversion({ convertedRowCount: 119 }))).toContain("convertedRowCount");
    expect(SourceConversionSchema.safeParse(conversion({ originalRowCount: 0, convertedRowCount: 0 })).success).toBe(true);
    expect(SourceConversionSchema.safeParse(conversion({ originalRowCount: -1, convertedRowCount: -1 })).success).toBe(false);
    expect(SourceConversionSchema.safeParse(conversion({ originalRowCount: 1.5, convertedRowCount: 1.5 })).success).toBe(false);
  });

  it("needs the converted file to be the file of the source", () => {
    expect(rejectedPaths(RealSourceSchema, source({ conversion: conversion({ convertedSha256: SHA_2 }) }))).toContain(
      "conversion.convertedSha256",
    );
  });

  it("needs a plain original file name, the person and the procedure", () => {
    for (const originalFileName of ["../shelters.xlsx", "dir/shelters.xlsx", "dir\\shelters.xlsx", "..", "."]) {
      expect(SourceConversionSchema.safeParse(conversion({ originalFileName })).success, originalFileName).toBe(false);
    }
    expect(SourceConversionSchema.safeParse(conversion({ convertedBy: "" })).success).toBe(false);
    expect(SourceConversionSchema.safeParse(conversion({ procedureId: undefined })).success).toBe(false);
    expect(SourceConversionSchema.safeParse(conversion({ correspondence: "ROWS_MERGED" })).success).toBe(false);
    expect(SourceConversionSchema.safeParse(conversion({ extra: 1 })).success).toBe(false);
  });

  it("does not give a source of fictional data a conversion", () => {
    expect(RegionalSourceSchema.safeParse({ dataKind: "FIXTURE", sourceId: "s" }).success).toBe(true);
    expect(RegionalSourceSchema.safeParse({ dataKind: "FIXTURE", sourceId: "s", conversion: conversion() }).success).toBe(false);
  });
});
