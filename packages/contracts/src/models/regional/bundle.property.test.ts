import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BUNDLE_SCHEMA_VERSION, BuildReportSchema, RegionalBundleSchema } from "./bundle.js";
import { FixedTextsSchema, GuidanceQuestionSchema, IssueCardSchema, ResultTextSchema } from "./content.js";
import { MapConfigSchema } from "./config.js";
import { QuestionBankSchema } from "./core.js";

const FIXTURE_DIRECTORY = new URL("../../../../fixtures/src/regional-values/", import.meta.url);
const HASH = "a".repeat(64);

function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_DIRECTORY)), "utf8")) as unknown;
}

function validBundle(dataVersion: string) {
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

function validReport() {
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
  };
}

describe("bundle schema round trip", () => {
  // Feature: regional-values-map, Property 36: bundle and report round trip
  // **Validates: Requirements 12.6**
  it("serializes, parses and serializes a valid bundle and report to identical JSON", () => {
    const chars = fc.constantFrom("a", "b", "c", "1", "2", "-");
    const version = fc.array(chars, { minLength: 1, maxLength: 24 }).map((items) => items.join(""));
    fc.assert(
      fc.property(version, (dataVersion) => {
        const bundle = RegionalBundleSchema.parse(validBundle(dataVersion));
        const bundleText = JSON.stringify(bundle);
        const reparsedBundle = RegionalBundleSchema.parse(JSON.parse(bundleText) as unknown);
        expect(reparsedBundle).toEqual(bundle);
        expect(JSON.stringify(reparsedBundle)).toBe(bundleText);
        const report = BuildReportSchema.parse(validReport());
        const reportText = JSON.stringify(report);
        const reparsedReport = BuildReportSchema.parse(JSON.parse(reportText) as unknown);
        expect(reparsedReport).toEqual(report);
        expect(JSON.stringify(reparsedReport)).toBe(reportText);
      }),
      { seed: 350_036, numRuns: 120 },
    );
  });
});