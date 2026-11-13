import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  QuestionBankSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";
import type { FixedTexts, GuidanceQuestion, IssueCard, QuestionBank, ResultText } from "@ehime-vote-navigator/contracts";

import type { CardCheckContext, FixtureIssueCard } from "../../../packages/domain/src/regional-values/content/checkIssueCard.js";
import { TEST_NEUTRALITY_CONFIG } from "./bankInjection.js";

/**
 * Test harness for the content checks (8.6 to 8.8): the fictional data of the repository, read
 * as it is, and test-only settings. The real names in the lists are the names that a fictional
 * card must not contain.
 */

const FIXTURE_DIRECTORY = new URL("../../../packages/fixtures/src/regional-values/", import.meta.url);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_DIRECTORY)), "utf8")) as unknown;
}

/** The names that no fictional card may contain, and the proper nouns whose ground is checked. Test-only. */
export const TEST_REAL_NAMES: readonly string[] = ["愛媛県", "松山市", "今治市", "新居浜市", "自由民主党", "立憲民主党"];

export const TEST_BUILD_CONFIG: CardCheckContext["config"] = {
  quoteMaxChars: 200,
  realNames: [...TEST_REAL_NAMES],
  properNouns: ["愛媛県", "松山市", "今治市", "新居浜市"],
  numeralExemptWords: TEST_NEUTRALITY_CONFIG.numeralExemptWords,
};

/** The fictional cards of the repository, as fictional cards. */
export function loadFixtureCards(): FixtureIssueCard[] {
  return IssueCardSchema.array()
    .parse(readJson("cards.json"))
    .map((card: IssueCard) => {
      if (card.dataKind !== "FIXTURE") {
        throw new Error("The fixture cards are FIXTURE");
      }
      return card;
    });
}

/** The text of a fictional source of the repository, or undefined when there is none. */
export function fixtureSourceText(sourceId: string): string | undefined {
  if (!/^[A-Za-z0-9-]+$/u.test(sourceId)) {
    return undefined;
  }
  try {
    const value = readJson(`sources/${sourceId}.json`);
    if (value !== null && typeof value === "object" && "text" in value && typeof value.text === "string") {
      return value.text;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export const FIXTURE_CARD_CONTEXT: CardCheckContext = {
  config: TEST_BUILD_CONFIG,
  sourceText: fixtureSourceText,
};

export function loadFixtureQuestionBank(): QuestionBank {
  return QuestionBankSchema.parse(readJson("question-bank.json"));
}

export function loadFixtureFixedTexts(): FixedTexts {
  return FixedTextsSchema.parse(readJson("fixed-texts.json"));
}

export function loadFixtureResultTexts(): ResultText[] {
  return ResultTextSchema.array().parse(readJson("result-texts.json"));
}

export function loadFixtureGuidance(): GuidanceQuestion[] {
  return GuidanceQuestionSchema.array().parse(readJson("guidance.json"));
}

/** The themes of the QUICK set of the fixture question bank. */
export const FIXTURE_QUICK_THEMES = ["POPULATION_REVITALIZATION", "DISASTER_PREVENTION", "EDUCATION_CHILDCARE"] as const;
