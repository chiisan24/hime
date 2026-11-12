import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  DatasetNoteReviewSchema,
  FactItemSchema,
  FactMethodSchema,
  IssueCardSchema,
  RegionalSourceSchema,
  TransmissionReviewSchema,
} from "./content.js";

type Json = Record<string, unknown>;

const APPROVED = { status: "APPROVED", approverId: "reviewer-1", approvedAt: "2026-05-01T09:00:00Z" };
const SHA = "a".repeat(64);

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

const fixtureSource: Json = { dataKind: "FIXTURE", sourceId: "src-1" };
const fixtureFact: Json = {
  dataKind: "FIXTURE",
  factId: "fact-1",
  sentence: "架空市の空き家は100戸です。",
  value: { amount: 100, unit: "戸" },
  surveyDate: 2024,
  area: "架空市",
  fictionalSourceId: "src-1",
};

const realSource = (overrides: Json = {}): Json => ({
  dataKind: "REAL_AI",
  sourceId: "src-r1",
  revision: "rev-1",
  reference: { kind: "url", url: "https://example.com/a.pdf" },
  publisher: "試験用の公開者",
  publishedOn: "2026-01-01",
  retrievedAt: "2026-02-01T00:00:00Z",
  locator: { kind: "pdf-page", page: 3 },
  sha256: SHA,
  usage: { status: "CONFIRMED", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" },
  datasetNote: null,
  transmission: { status: "UNKNOWN" },
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  ...overrides,
});

const realFact = (overrides: Json = {}): Json => ({
  dataKind: "REAL_AI",
  factId: "fact-r1",
  sentence: "空き家は100戸です。",
  value: { amount: 100, unit: "戸" },
  surveyDate: "2024-04-01",
  area: "試験用の地域",
  publisher: "試験用の公開者",
  sourceUrl: "https://example.com/a.pdf",
  datasetUrl: "https://example.com/data",
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  retrievedAt: "2026-02-01T00:00:00Z",
  sha256: SHA,
  locator: { kind: "pdf-page", page: 3 },
  method: { kind: "QUOTED", description: "原本の値をそのまま使う" },
  verification: { status: "PROVISIONAL" },
  ...overrides,
});

const baseCard = (overrides: Json = {}): Json => ({
  cardId: "card-1",
  themeId: "POPULATION_REVITALIZATION",
  title: "空き家の増加",
  background: "架空市では、空き家が少しずつ増えています。",
  glossary: [{ term: "空き家", description: "誰も住んでいない家" }],
  quote: { sourceId: "src-1", text: "空き家は100戸" },
  aiInvolvement: "HUMAN",
  updatedOn: "2026-05-01",
  approval: APPROVED,
  ...overrides,
});

const fixtureCard = (overrides: Json = {}): Json =>
  baseCard({ dataKind: "FIXTURE", sources: [fixtureSource], facts: [fixtureFact], ...overrides });

const realCard = (overrides: Json = {}): Json =>
  baseCard({
    dataKind: "REAL_AI",
    sources: [realSource({ sourceId: "src-1" })],
    facts: [realFact()],
    ...overrides,
  });

describe("IssueCardSchema: accepted values", () => {
  it("accepts a fictional card with a fictional source and a fictional fact", () => {
    expect(IssueCardSchema.safeParse(fixtureCard()).success).toBe(true);
  });

  it("accepts a real-data card with a full source and a full fact", () => {
    expect(IssueCardSchema.safeParse(realCard()).success).toBe(true);
  });

  it("accepts a card without a fact, a pending card without a record, and the largest counts", () => {
    expect(IssueCardSchema.safeParse(fixtureCard({ facts: [] })).success).toBe(true);
    expect(IssueCardSchema.safeParse(fixtureCard({ approval: { status: "PENDING" } })).success).toBe(true);
    const sources = Array.from({ length: 10 }, (_, index) => ({ dataKind: "FIXTURE", sourceId: index === 0 ? "src-1" : `src-${index + 1}` }));
    const facts = Array.from({ length: 10 }, (_, index) => ({ ...fixtureFact, factId: `fact-${index}` }));
    const glossary = Array.from({ length: 10 }, (_, index) => ({ term: `用語${index}`, description: "説明" }));
    expect(IssueCardSchema.safeParse(fixtureCard({ sources, facts, glossary })).success).toBe(true);
  });
});

describe("IssueCardSchema: rejected values", () => {
  it("rejects an election ID or a candidate ID anywhere in the card (Req 7.7)", () => {
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ electionId: "e1" }))).not.toEqual([]);
    expect(IssueCardSchema.safeParse(fixtureCard({ sources: [{ ...fixtureSource, candidateId: "c1" }] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(realCard({ sources: [realSource({ sourceId: "src-1", electionId: "e1" })] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ facts: [{ ...fixtureFact, candidateId: "c1" }] })).success).toBe(false);
  });

  it("rejects a URL or a publisher name on a fictional source", () => {
    const withUrl = { ...fixtureSource, reference: { kind: "url", url: "https://example.com/" } };
    expect(IssueCardSchema.safeParse(fixtureCard({ sources: [withUrl] })).success).toBe(false);
    expect(RegionalSourceSchema.safeParse({ ...fixtureSource, publisher: "実在の名前" }).success).toBe(false);
  });

  it("rejects a real source without its locator", () => {
    const withoutLocator = Object.fromEntries(Object.entries(realSource({ sourceId: "src-1" })).filter(([key]) => key !== "locator"));
    expect(rejectedPaths(IssueCardSchema, realCard({ sources: [withoutLocator] })).join(" ")).toContain("locator");
  });

  it("rejects a card whose sources or facts are of the other data kind", () => {
    expect(IssueCardSchema.safeParse(fixtureCard({ sources: [realSource({ sourceId: "src-1" })] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ facts: [realFact()] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(realCard({ sources: [fixtureSource] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(realCard({ facts: [fixtureFact] })).success).toBe(false);
  });

  it("rejects an APPROVED card without its record and a PENDING card with one", () => {
    expect(IssueCardSchema.safeParse(fixtureCard({ approval: { status: "APPROVED" } })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ approval: { status: "PENDING", approverId: "a" } })).success).toBe(false);
  });

  it("rejects 0 and 11 terms, 0 and 11 sources, and 11 facts", () => {
    const term = { term: "用語", description: "説明" };
    expect(IssueCardSchema.safeParse(fixtureCard({ glossary: [] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ glossary: Array.from({ length: 11 }, () => term) })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ sources: [] })).success).toBe(false);
    expect(
      IssueCardSchema.safeParse(
        fixtureCard({ sources: Array.from({ length: 11 }, (_, index) => ({ dataKind: "FIXTURE", sourceId: `src-${index}` })) }),
      ).success,
    ).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ facts: Array.from({ length: 11 }, () => fixtureFact) })).success).toBe(false);
  });

  it("rejects a quotation from a source that is not one of the sources of the card", () => {
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ quote: { sourceId: "other", text: "引用" } }))).toContain("quote.sourceId");
  });

  it("rejects a term of 41 code points, a title of 41, a background of 401, and a quotation of 201", () => {
    expect(IssueCardSchema.safeParse(fixtureCard({ glossary: [{ term: "あ".repeat(41), description: "説明" }] })).success).toBe(false);
    expect(IssueCardSchema.safeParse(fixtureCard({ glossary: [{ term: "あ".repeat(40), description: "説明" }] })).success).toBe(true);
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ title: "あ".repeat(41) }))).toContain("title");
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ background: "あ".repeat(401) }))).toContain("background");
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ quote: { sourceId: "src-1", text: "あ".repeat(201) } }))).toContain("quote.text");
  });

  it("rejects a theme that does not exist and an extra key", () => {
    expect(rejectedPaths(IssueCardSchema, fixtureCard({ themeId: "UNCLASSIFIED" }))).toContain("themeId");
    expect(IssueCardSchema.safeParse(fixtureCard({ note: "x" })).success).toBe(false);
  });
});

describe("FactItemSchema", () => {
  it("accepts a year as the survey date and a date", () => {
    expect(FactItemSchema.safeParse(fixtureFact).success).toBe(true);
    expect(FactItemSchema.safeParse({ ...fixtureFact, surveyDate: "2024-04-01" }).success).toBe(true);
  });

  it("rejects the real-data items on a fictional fact", () => {
    for (const extra of [{ sha256: SHA }, { license: { name: "x", url: "https://example.com/" } }, { publisher: "x" }, { locator: { kind: "pdf-page", page: 1 } }]) {
      expect(FactItemSchema.safeParse({ ...fixtureFact, ...extra }).success).toBe(false);
    }
  });

  it("rejects a verified fact without its record and a provisional fact with one", () => {
    expect(FactItemSchema.safeParse(realFact({ verification: { status: "VERIFIED" } })).success).toBe(false);
    expect(FactItemSchema.safeParse(realFact({ verification: { status: "PROVISIONAL", verifierId: "v" } })).success).toBe(false);
    expect(
      FactItemSchema.safeParse(realFact({ verification: { status: "VERIFIED", verifierId: "v", verifiedAt: "2026-05-01T00:00:00Z" } })).success,
    ).toBe(true);
  });

  it("rejects a sentence of two sentences, an empty sentence and a sentence of 201 code points", () => {
    expect(FactItemSchema.safeParse({ ...fixtureFact, sentence: "一つ目です。二つ目です。" }).success).toBe(false);
    expect(FactItemSchema.safeParse({ ...fixtureFact, sentence: "" }).success).toBe(false);
    expect(FactItemSchema.safeParse({ ...fixtureFact, sentence: "あ".repeat(201) }).success).toBe(false);
  });

  it("rejects a value that is not a finite number, and a year out of range", () => {
    expect(FactItemSchema.safeParse({ ...fixtureFact, value: { amount: Number.POSITIVE_INFINITY, unit: "戸" } }).success).toBe(false);
    expect(FactItemSchema.safeParse({ ...fixtureFact, surveyDate: 1800 }).success).toBe(false);
  });
});

describe("FactMethodSchema", () => {
  const computed = (overrides: Json): Json => ({
    kind: "COMPUTED",
    aggregation: "COUNT_ROWS",
    sheet: "Sheet1",
    column: null,
    equals: null,
    description: "行数を数える",
    ...overrides,
  });

  it("accepts a plain count, a count with a condition, and a quotation", () => {
    expect(FactMethodSchema.safeParse(computed({})).success).toBe(true);
    expect(FactMethodSchema.safeParse(computed({ aggregation: "COUNT_ROWS_WHERE", column: "区分", equals: "A" })).success).toBe(true);
    expect(FactMethodSchema.safeParse({ kind: "QUOTED", description: "そのまま" }).success).toBe(true);
  });

  it("rejects a count with a condition and no column, and a plain count with a column", () => {
    expect(rejectedPaths(FactMethodSchema, computed({ aggregation: "COUNT_ROWS_WHERE" }))).toEqual(["column", "equals"]);
    expect(rejectedPaths(FactMethodSchema, computed({ column: "区分" }))).toEqual(["column"]);
  });
});

describe("source records", () => {
  it("TransmissionReviewSchema: UNKNOWN has no record, ALLOWED and DENIED have one", () => {
    const record = { checkedBy: "a", checkedAt: "2026-05-01T00:00:00Z", evidence: "確認した" };
    expect(TransmissionReviewSchema.safeParse({ status: "UNKNOWN" }).success).toBe(true);
    expect(TransmissionReviewSchema.safeParse({ status: "ALLOWED", ...record }).success).toBe(true);
    expect(TransmissionReviewSchema.safeParse({ status: "DENIED", ...record }).success).toBe(true);
    expect(TransmissionReviewSchema.safeParse({ status: "ALLOWED" }).success).toBe(false);
    expect(TransmissionReviewSchema.safeParse({ status: "UNKNOWN", ...record }).success).toBe(false);
  });

  it("DatasetNoteReviewSchema: a specific note needs its summary", () => {
    const base = { checkedBy: "a", checkedAt: "2026-05-01T00:00:00Z" };
    expect(DatasetNoteReviewSchema.safeParse({ ...base, hasSpecificNote: false }).success).toBe(true);
    expect(DatasetNoteReviewSchema.safeParse({ ...base, hasSpecificNote: true, noteSummary: "注記あり" }).success).toBe(true);
    expect(rejectedPaths(DatasetNoteReviewSchema, { ...base, hasSpecificNote: true })).toContain("noteSummary");
  });

  it("RegionalSourceSchema: a real source may refer to a document ID, and needs a license and a usage record", () => {
    expect(RegionalSourceSchema.safeParse(realSource({ reference: { kind: "document-id", documentId: "doc-1" } })).success).toBe(true);
    const withoutLicense = Object.fromEntries(Object.entries(realSource()).filter(([key]) => key !== "license"));
    expect(RegionalSourceSchema.safeParse(withoutLicense).success).toBe(false);
    expect(RegionalSourceSchema.safeParse(realSource({ usage: { status: "MAYBE" } })).success).toBe(false);
    expect(RegionalSourceSchema.safeParse(realSource({ sha256: "ABC" })).success).toBe(false);
  });
});

describe("RegionalSourceSchema: catalog", () => {
  const catalog = { name: "愛媛県オープンデータカタログ", datasetId: "pref-2" };

  it("accepts a real source with a catalog entry and one without", () => {
    expect(RegionalSourceSchema.safeParse(realSource({ catalog })).success).toBe(true);
    expect(RegionalSourceSchema.safeParse(realSource()).success).toBe(true);
  });

  it("keeps the catalog entry in the parsed source", () => {
    const parsed = RegionalSourceSchema.parse(realSource({ catalog }));
    expect(parsed.dataKind === "REAL_AI" ? parsed.catalog : undefined).toEqual(catalog);
  });

  it("rejects an empty or blank catalog name or data set ID, a missing key, and an extra key", () => {
    expect(rejectedPaths(RegionalSourceSchema, realSource({ catalog: { ...catalog, datasetId: "" } }))).toContain("catalog.datasetId");
    expect(rejectedPaths(RegionalSourceSchema, realSource({ catalog: { ...catalog, name: "  " } }))).toContain("catalog.name");
    expect(RegionalSourceSchema.safeParse(realSource({ catalog: { name: "カタログ" } })).success).toBe(false);
    expect(RegionalSourceSchema.safeParse(realSource({ catalog: { ...catalog, url: "https://example.com/" } })).success).toBe(false);
  });

  it("rejects a catalog entry on a fictional source, which has a fictional document ID only", () => {
    expect(RegionalSourceSchema.safeParse({ ...fixtureSource, catalog }).success).toBe(false);
  });

  it("keeps a real-data card valid when its source has a catalog entry", () => {
    expect(IssueCardSchema.safeParse(realCard({ sources: [realSource({ sourceId: "src-1", catalog })] })).success).toBe(true);
  });
});
