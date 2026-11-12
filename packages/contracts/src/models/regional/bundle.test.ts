import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BUNDLE_SCHEMA_VERSION,
  BUILD_KINDS,
  BundleMetaSchema,
  BuildReportSchema,
  DATA_MODES,
  GATE_REASON_CLASS,
  GATE_REASON_CODES,
  GateFindingSchema,
  RegionalBundleSchema,
} from "./bundle.js";
import { FixedTextsSchema, GuidanceQuestionSchema, IssueCardSchema, ResultTextSchema } from "./content.js";
import { MapConfigSchema } from "./config.js";
import { QuestionBankSchema } from "./core.js";

const FIXTURE_DIRECTORY = new URL("../../../../fixtures/src/regional-values/", import.meta.url);
const HASH = "a".repeat(64);

function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_DIRECTORY)), "utf8")) as unknown;
}

function rawFixtureBundle(dataVersion = "2026-01-01.1") {
  const bank = QuestionBankSchema.parse(fixtureJson("question-bank.json"));
  return {
    meta: {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      generatedAt: "2026-01-04T09:00:00Z",
      dataVersion,
      buildKind: "DEMO",
      dataKind: "FIXTURE",
      dataModeRequested: "FIXTURE",
      dataModeResolved: "FIXTURE",
      switched: false,
      switchReasonCodes: [],
      contentHash: HASH,
    },
    themes: bank.themes,
    questions: bank.questions,
    diagnosticSets: bank.diagnosticSets,
    cards: IssueCardSchema.array().parse(fixtureJson("cards.json")),
    resultTexts: ResultTextSchema.array().parse(fixtureJson("result-texts.json")),
    fixedTexts: FixedTextsSchema.parse(fixtureJson("fixed-texts.json")),
    guidance: GuidanceQuestionSchema.array().parse(fixtureJson("guidance.json")),
    mapConfig: MapConfigSchema.parse({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 }),
    aiContribution: { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 },
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    buildKind: "DEMO",
    startedAt: "2026-01-04T09:00:00Z",
    finishedAt: "2026-01-04T09:01:00Z",
    dataModeRequested: "FIXTURE",
    dataModeResolved: "FIXTURE",
    switched: false,
    switchReasonCodes: [],
    findings: [],
    checks: { dataBoundary: "PASSED", questionBank: "PASSED", issueCards: "PASSED", contentHash: "PASSED" },
    output: { bundlePath: "dist/regional-values/demo/bundle.json", dataKind: "FIXTURE", contentHash: HASH, bytes: 1234 },
    warnings: [],
    exitCode: 0,
    ...overrides,
  };
}

function rejectedPaths(schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } }, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : (result.error?.issues.map((issue) => issue.path.join(".")) ?? []);
}

describe("BundleMetaSchema", () => {
  it("holds the three request modes, two resolved modes, two build kinds and schema version 1", () => {
    expect(DATA_MODES).toEqual(["REAL", "FIXTURE", "REAL_PREFERRED"]);
    expect(BUILD_KINDS).toEqual(["DEMO", "PUBLIC"]);
    expect(BUNDLE_SCHEMA_VERSION).toBe(1);
    expect(BundleMetaSchema.safeParse(rawFixtureBundle().meta).success).toBe(true);
  });

  it("requires the data kind to match the resolved mode", () => {
    expect(rejectedPaths(BundleMetaSchema, { ...rawFixtureBundle().meta, dataKind: "REAL_AI" })).toContain("dataKind");
  });

  it("allows a REAL_PREFERRED fallback only with one or more shortage reasons", () => {
    const fallback = {
      ...rawFixtureBundle().meta,
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switched: true,
      switchReasonCodes: ["FACT_NOT_VERIFIED"],
    };
    expect(BundleMetaSchema.safeParse(fallback).success).toBe(true);
    expect(rejectedPaths(BundleMetaSchema, { ...fallback, switchReasonCodes: [] })).toContain("switchReasonCodes");
    expect(rejectedPaths(BundleMetaSchema, { ...fallback, switchReasonCodes: ["CONTRACT_VIOLATION"] })).toContain("switchReasonCodes.0");
    expect(rejectedPaths(BundleMetaSchema, { ...fallback, switched: false })).toContain("switched");
  });

  it("does not let REAL resolve to FIXTURE or FIXTURE resolve to REAL", () => {
    expect(rejectedPaths(BundleMetaSchema, { ...rawFixtureBundle().meta, dataModeRequested: "REAL", dataModeResolved: "FIXTURE" })).toContain(
      "dataModeResolved",
    );
    expect(
      rejectedPaths(BundleMetaSchema, {
        ...rawFixtureBundle().meta,
        dataModeRequested: "FIXTURE",
        dataModeResolved: "REAL",
        dataKind: "REAL_AI",
      }),
    ).toContain("dataModeResolved");
  });

  it("only allows an unswitched REAL_AI bundle as PUBLIC", () => {
    const publicMeta = {
      ...rawFixtureBundle().meta,
      buildKind: "PUBLIC",
      dataKind: "REAL_AI",
      dataModeRequested: "REAL",
      dataModeResolved: "REAL",
    };
    expect(BundleMetaSchema.safeParse(publicMeta).success).toBe(true);
    expect(rejectedPaths(BundleMetaSchema, { ...rawFixtureBundle().meta, buildKind: "PUBLIC" })).toContain("buildKind");
  });
});

describe("RegionalBundleSchema", () => {
  it("accepts a complete FIXTURE bundle", () => {
    const result = RegionalBundleSchema.safeParse(rawFixtureBundle());
    expect(result.success).toBe(true);
  });

  it("rejects a question, card, result text or fixed texts with another data kind", () => {
    const base = rawFixtureBundle();
    expect(
      rejectedPaths(RegionalBundleSchema, {
        ...base,
        questions: [{ ...base.questions[0], dataKind: "REAL_AI" }, ...base.questions.slice(1)],
      }),
    ).toContain("questions.0.dataKind");
    expect(
      rejectedPaths(RegionalBundleSchema, {
        ...base,
        resultTexts: [{ ...base.resultTexts[0], dataKind: "REAL_AI" }, ...base.resultTexts.slice(1)],
      }),
    ).toContain("resultTexts.0.dataKind");
    expect(
      RegionalBundleSchema.safeParse({ ...base, cards: [{ ...base.cards[0], dataKind: "REAL_AI" }, ...base.cards.slice(1)] }).success,
    ).toBe(false);
    expect(RegionalBundleSchema.safeParse({ ...base, fixedTexts: { ...base.fixedTexts, dataKind: "REAL_AI" } }).success).toBe(false);
  });

  it("rejects a non-strict bundle and an invalid contribution total", () => {
    const base = rawFixtureBundle();
    expect(RegionalBundleSchema.safeParse({ ...base, unknown: true }).success).toBe(false);
    expect(
      rejectedPaths(RegionalBundleSchema, {
        ...base,
        aiContribution: { drafted: 1, rejectedByChecks: 1, humanEdited: 1, humanRejected: 0 },
      }),
    ).toContain("aiContribution.drafted");
  });
});

describe("gate reason codes and findings", () => {
  it("maps every closed reason code to exactly one class", () => {
    expect(Object.keys(GATE_REASON_CLASS).sort()).toEqual([...GATE_REASON_CODES].sort());
    expect(Object.values(GATE_REASON_CLASS).every((value) => value === "SHORTAGE" || value === "DEFECT")).toBe(true);
  });

  it("accepts a stable ID only and rejects a class that does not fit its code", () => {
    expect(GateFindingSchema.safeParse({ code: "FACT_NOT_VERIFIED", class: "SHORTAGE", targetKind: "FACT_ITEM", targetId: "fact-1" }).success).toBe(
      true,
    );
    expect(GateFindingSchema.safeParse({ code: "FACT_NOT_VERIFIED", class: "DEFECT", targetKind: "FACT_ITEM", targetId: "fact-1" }).success).toBe(
      false,
    );
    expect(GateFindingSchema.safeParse({ code: "FACT_NOT_VERIFIED", class: "SHORTAGE", targetKind: "FACT_ITEM", targetId: "" }).success).toBe(
      false,
    );
  });
});

describe("BuildReportSchema", () => {
  it("accepts a successful report and a failed report without output", () => {
    expect(BuildReportSchema.safeParse(report()).success).toBe(true);
    expect(
      BuildReportSchema.safeParse(
        report({ dataModeResolved: null, output: null, exitCode: 1, checks: { dataBoundary: "FAILED", questionBank: "SKIPPED", issueCards: "SKIPPED", contentHash: "SKIPPED" } }),
      ).success,
    ).toBe(true);
  });

  it("requires an output and resolved mode for success, and no output for failure", () => {
    expect(BuildReportSchema.safeParse(report({ output: null })).success).toBe(false);
    expect(BuildReportSchema.safeParse(report({ dataModeResolved: null })).success).toBe(false);
    expect(BuildReportSchema.safeParse(report({ exitCode: 1 })).success).toBe(false);
  });

  it("keeps fallback reasons, warnings and output kind consistent", () => {
    const fallback = report({
      dataModeRequested: "REAL_PREFERRED",
      dataModeResolved: "FIXTURE",
      switched: true,
      switchReasonCodes: ["FACT_NOT_VERIFIED"],
      warnings: ["DATA_MODE_SWITCHED"],
    });
    expect(BuildReportSchema.safeParse(fallback).success).toBe(true);
    expect(BuildReportSchema.safeParse({ ...fallback, warnings: [] }).success).toBe(false);
    expect(BuildReportSchema.safeParse({ ...fallback, switchReasonCodes: ["CONTRACT_VIOLATION"] }).success).toBe(false);
    expect(BuildReportSchema.safeParse({ ...fallback, output: { ...fallback.output, dataKind: "REAL_AI" } }).success).toBe(false);
  });
});

describe("RegionalBundleSchema: round trip", () => {
  // Feature: regional-values-map, Property 36: bundle and report round trip
  // **Validates: Requirements 12.6**
  it("serializes, parses and serializes each valid fixture bundle to the same JSON", () => {
    const chars = fc.constantFrom("a", "b", "c", "1", "2", "-");
    const version = fc.array(chars, { minLength: 1, maxLength: 24 }).map((items) => items.join(""));
    fc.assert(
      fc.property(version, (dataVersion) => {
        const original = RegionalBundleSchema.parse(rawFixtureBundle(dataVersion));
        const serialized = JSON.stringify(original);
        const parsed = RegionalBundleSchema.parse(JSON.parse(serialized) as unknown);
        expect(parsed).toEqual(original);
        expect(JSON.stringify(parsed)).toBe(serialized);
        const originalReport = BuildReportSchema.parse(report());
        const serializedReport = JSON.stringify(originalReport);
        const parsedReport = BuildReportSchema.parse(JSON.parse(serializedReport) as unknown);
        expect(parsedReport).toEqual(originalReport);
        expect(JSON.stringify(parsedReport)).toBe(serializedReport);
      }),
      { seed: 350_036, numRuns: 120 },
    );
  });
});