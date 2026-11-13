import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BUNDLE_SCHEMA_VERSION,
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  QuestionBankSchema,
  RegionalBundleSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";
import { calculateContentHash } from "./contentHash.js";
import { verifyBundleText } from "./verifyBundleText.js";
import type { ExpectedBundle } from "./verifyBundleText.js";

const DIRECTORY = new URL("../../../../fixtures/src/regional-values/", import.meta.url);
const HASH = "a".repeat(64);
const EXPECTED: ExpectedBundle = { schemaVersion: BUNDLE_SCHEMA_VERSION, dataVersion: "2026-01-01.1", buildKind: "DEMO" };

function source(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, DIRECTORY)), "utf8")) as unknown;
}

async function validText() {
  const bank = QuestionBankSchema.parse(source("question-bank.json"));
  const raw = {
    meta: { schemaVersion: 1, generatedAt: "2026-01-04T09:00:00Z", dataVersion: EXPECTED.dataVersion, buildKind: "DEMO", dataKind: "FIXTURE", dataModeRequested: "FIXTURE", dataModeResolved: "FIXTURE", switched: false, switchReasonCodes: [], contentHash: HASH },
    themes: bank.themes,
    questions: bank.questions,
    diagnosticSets: bank.diagnosticSets,
    cards: IssueCardSchema.array().parse(source("cards.json")),
    resultTexts: ResultTextSchema.array().parse(source("result-texts.json")),
    fixedTexts: FixedTextsSchema.parse(source("fixed-texts.json")),
    guidance: GuidanceQuestionSchema.array().parse(source("guidance.json")),
    mapConfig: MapConfigSchema.parse({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 }),
    aiContribution: { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 },
  };
  const parsed = RegionalBundleSchema.parse(raw);
  const hash = await calculateContentHash(parsed);
  return RegionalBundleSchema.parse({ ...parsed, meta: { ...parsed.meta, contentHash: hash } });
}

describe("verifyBundleText: invalid bundle property", () => {
  // Feature: regional-values-map, Property 39: bundle verification
  // **Validates: Requirements 10.4, 11.10**
  it("returns the corresponding error code only for each one-kind defect", async () => {
    const defect = fc.constantFrom("META_MISSING", "GENERATED_AT_INVALID", "SCHEMA_VERSION_MISMATCH", "DATA_VERSION_MISMATCH", "BUILD_KIND_MISMATCH", "SCHEMA_INVALID", "HASH_MISMATCH", "REFERENCE_BROKEN");
    await fc.assert(
      fc.asyncProperty(defect, async (kind) => {
        const valid = await validText();
        let text: string;
        let expected = EXPECTED;
        switch (kind) {
          case "META_MISSING":
            text = JSON.stringify({ ...valid, meta: {} });
            break;
          case "GENERATED_AT_INVALID":
            text = JSON.stringify({ ...valid, meta: { ...valid.meta, generatedAt: "bad" } });
            break;
          case "SCHEMA_VERSION_MISMATCH":
            text = JSON.stringify({ ...valid, meta: { ...valid.meta, schemaVersion: 2 } });
            break;
          case "DATA_VERSION_MISMATCH":
            text = JSON.stringify(valid);
            expected = { ...EXPECTED, dataVersion: "other" };
            break;
          case "BUILD_KIND_MISMATCH":
            text = JSON.stringify(valid);
            expected = { ...EXPECTED, buildKind: "PUBLIC" };
            break;
          case "SCHEMA_INVALID":
            text = JSON.stringify({ ...valid, extra: true });
            break;
          case "HASH_MISMATCH":
            text = JSON.stringify({ ...valid, themes: [...valid.themes].reverse() });
            break;
          case "REFERENCE_BROKEN": {
            const broken = RegionalBundleSchema.parse({ ...valid, cards: valid.cards.slice(1) });
            const hash = await calculateContentHash(broken);
            text = JSON.stringify({ ...broken, meta: { ...broken.meta, contentHash: hash } });
            break;
          }
        }
        const result = await verifyBundleText(text, expected);
        expect(result).toEqual({ ok: false, error: kind });
        expect("value" in result).toBe(false);
      }),
      { seed: 350_039, numRuns: 120 },
    );
  });
});