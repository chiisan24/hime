import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { AggregationRecordSchema, DatasetRecordSchema } from "./dataset.js";

type Json = Record<string, unknown>;

const SHA = "a".repeat(64);
const SHA_2 = "b".repeat(64);

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

const dataset = (overrides: Json = {}): Json => ({
  datasetKey: "catalog-shelters",
  catalog: { name: "試験用のカタログ", datasetId: "shelters" },
  title: "指定避難所の一覧",
  publisher: "試験用の公開者",
  sourceUrl: "https://example.com/shelters",
  surveyDate: 2024,
  updatedOn: "2025-04-01",
  coverageArea: "試験用の地域",
  format: { fileFormat: "CSV", encoding: "UTF-8" },
  usage: { status: "CONFIRMED", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" },
  datasetNote: { hasSpecificNote: false, checkedBy: "analyst-1", checkedAt: "2026-02-01T09:00:00Z" },
  transmission: { status: "UNKNOWN" },
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  adoption: { status: "CANDIDATE" },
  themeIds: ["POPULATION_REVITALIZATION"],
  sourceIds: ["src-1"],
  ...overrides,
});

const decided = (status: "ADOPTED" | "REJECTED"): Json => ({
  status,
  decidedBy: "analyst-1",
  decidedAt: "2026-02-03T09:00:00Z",
  reason: "テーマに合うため",
});

describe("DatasetRecordSchema", () => {
  it("accepts a candidate, with a survey date or only a year", () => {
    expect(DatasetRecordSchema.safeParse(dataset()).success).toBe(true);
    expect(DatasetRecordSchema.safeParse(dataset({ surveyDate: "2024-04-01", updatedOn: null })).success).toBe(true);
  });

  it("keeps whether the data set exists apart from whether it may be sent to an external AI", () => {
    // Sending to an external AI is not a condition of ADOPTED: it is a condition of the input of the draft process.
    for (const transmission of [{ status: "UNKNOWN" }, { status: "DENIED", checkedBy: "a", checkedAt: "2026-02-01T00:00:00Z", evidence: "規約" }]) {
      expect(DatasetRecordSchema.safeParse(dataset({ adoption: decided("ADOPTED"), transmission })).success).toBe(true);
    }
  });

  it("adopts a data set only when the terms of use are CONFIRMED and the note was checked", () => {
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: decided("ADOPTED") })).success).toBe(true);
    for (const status of ["UNKNOWN", "RESTRICTED"]) {
      const usage = { status, checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" };
      expect(rejectedPaths(DatasetRecordSchema, dataset({ adoption: decided("ADOPTED"), usage }))).toContain("usage.status");
    }
    expect(rejectedPaths(DatasetRecordSchema, dataset({ adoption: decided("ADOPTED"), datasetNote: null }))).toContain("datasetNote");
  });

  it("can candidate or reject a data set whose terms are not confirmed", () => {
    const usage = { status: "UNKNOWN", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" };
    expect(DatasetRecordSchema.safeParse(dataset({ usage, datasetNote: null })).success).toBe(true);
    expect(DatasetRecordSchema.safeParse(dataset({ usage, datasetNote: null, adoption: decided("REJECTED") })).success).toBe(true);
  });

  it("gives the person, the time and the reason to a decision, and only to a decision", () => {
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: { status: "ADOPTED" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: { status: "REJECTED", decidedBy: "a" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: { ...decided("ADOPTED"), reason: "" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: { status: "CANDIDATE", decidedBy: "a" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ adoption: { status: "PENDING" } })).success).toBe(false);
  });

  it("rejects a theme or a source that is listed twice, and an unknown theme", () => {
    expect(DatasetRecordSchema.safeParse(dataset({ themeIds: ["TRANSPORT", "TRANSPORT"] })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ themeIds: ["OTHER"] })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ themeIds: [] })).success).toBe(true);
    expect(DatasetRecordSchema.safeParse(dataset({ sourceIds: ["src-1", "src-1"] })).success).toBe(false);
  });

  it("rejects an unknown file format or encoding, a bad URL, a survey year out of range and an extra field", () => {
    expect(DatasetRecordSchema.safeParse(dataset({ format: { fileFormat: "XML", encoding: "UTF-8" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ format: { fileFormat: "CSV", encoding: "EUC-JP" } })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ sourceUrl: "not a url" })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ surveyDate: 1800 })).success).toBe(false);
    expect(DatasetRecordSchema.safeParse(dataset({ dataKind: "REAL_AI" })).success).toBe(false);
  });
});

describe("AggregationRecordSchema", () => {
  const record = (overrides: Json = {}): Json => ({
    schemaVersion: 1,
    dataKind: "REAL_AI",
    factId: "fact-1",
    inputSha256: SHA,
    methodHash: SHA_2,
    surveyDate: "2024-04-01",
    missingCount: 2,
    duplicatesRemoved: 0,
    locator: { kind: "text-lines", startLine: 2, endLine: 121 },
    ...overrides,
  });

  it("accepts the numbers and the hashes of a computation", () => {
    expect(AggregationRecordSchema.safeParse(record()).success).toBe(true);
    expect(AggregationRecordSchema.safeParse(record({ surveyDate: 2024, missingCount: 0, duplicatesRemoved: 3 })).success).toBe(true);
  });

  it("is for real data only", () => {
    expect(AggregationRecordSchema.safeParse(record({ dataKind: "FIXTURE" })).success).toBe(false);
  });

  it("counts whole numbers that are not negative", () => {
    for (const field of ["missingCount", "duplicatesRemoved"]) {
      expect(AggregationRecordSchema.safeParse(record({ [field]: -1 })).success, field).toBe(false);
      expect(AggregationRecordSchema.safeParse(record({ [field]: 1.5 })).success, field).toBe(false);
      expect(AggregationRecordSchema.safeParse(record({ [field]: undefined })).success, field).toBe(false);
    }
  });

  it("holds no row of the table: a row, a value or a sum is not a field", () => {
    for (const field of ["rows", "values", "amount", "sentence"]) {
      expect(AggregationRecordSchema.safeParse(record({ [field]: ["x"] })).success, field).toBe(false);
    }
  });

  it("needs the hashes, a readable survey date and the lines that were used", () => {
    expect(AggregationRecordSchema.safeParse(record({ inputSha256: "abc" })).success).toBe(false);
    expect(AggregationRecordSchema.safeParse(record({ methodHash: undefined })).success).toBe(false);
    expect(AggregationRecordSchema.safeParse(record({ surveyDate: "2024/04/01" })).success).toBe(false);
    expect(AggregationRecordSchema.safeParse(record({ surveyDate: null })).success).toBe(false);
    expect(rejectedPaths(AggregationRecordSchema, record({ locator: { kind: "text-lines", startLine: 9, endLine: 2 } }))).toContain(
      "locator.endLine",
    );
    expect(AggregationRecordSchema.safeParse(record({ locator: { kind: "pdf-page", page: 1 } })).success).toBe(false);
  });
});
