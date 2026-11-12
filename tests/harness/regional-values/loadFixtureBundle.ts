import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  QuestionBankSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";

import type { ViewBundle } from "../../../packages/domain/src/regional-values/view/viewTypes.js";

const FIXTURE_DIRECTORY = new URL("../../../packages/fixtures/src/regional-values/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_DIRECTORY)), "utf8")) as unknown;
}

/**
 * Reads the repository's complete FIXTURE data into the view model shape. This is a
 * test and build helper, not a browser import. The data stays a single FIXTURE bundle.
 */
export function loadFixtureBundle(): ViewBundle {
  const bank = QuestionBankSchema.parse(readJson("question-bank.json"));
  if (bank.dataKind !== "FIXTURE") {
    throw new Error("The fallback fixture bank must be FIXTURE");
  }
  return {
    meta: { dataKind: "FIXTURE" },
    themes: bank.themes,
    questions: bank.questions,
    diagnosticSets: bank.diagnosticSets,
    cards: IssueCardSchema.array().parse(readJson("cards.json")),
    resultTexts: ResultTextSchema.array().parse(readJson("result-texts.json")),
    fixedTexts: FixedTextsSchema.parse(readJson("fixed-texts.json")),
    guidance: GuidanceQuestionSchema.array().parse(readJson("guidance.json")),
    mapConfig: MapConfigSchema.parse({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 }),
    aiContribution: { DRAFTED: 0, REJECTED_BY_CHECKS: 0, HUMAN_EDITED: 0, HUMAN_REJECTED: 0 },
  };
}