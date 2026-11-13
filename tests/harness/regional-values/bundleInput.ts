import {
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  ResultTextSchema,
} from "@ehime-vote-navigator/contracts";
import type { GuidanceQuestion, IssueCard, ResultText } from "@ehime-vote-navigator/contracts";

import type { AssemblyInput, BundleIdentity } from "../../../packages/domain/src/regional-values/bundle/assembleBundleBody.js";
import { ALL_THEMES } from "./balanceInjection.js";
import { buildPassingBank } from "./bankInjection.js";
import {
  loadFixtureCards,
  loadFixtureFixedTexts,
  loadFixtureGuidance,
  loadFixtureQuestionBank,
  loadFixtureResultTexts,
} from "./contentFixtures.js";

/**
 * Test inputs of the assembly of a bundle (9.2): the fictional data of the repository (QUICK only),
 * and a complete input with all six themes, a QUICK set and a FULL set. All are `FIXTURE` data.
 */

export const TEST_IDENTITY: BundleIdentity = {
  buildKind: "DEMO",
  dataKind: "FIXTURE",
  dataModeRequested: "FIXTURE",
  dataModeResolved: "FIXTURE",
  switched: false,
  switchReasonCodes: [],
  generatedAt: "2026-01-04T09:00:00Z",
  dataVersion: "2026-01-01.1",
};

const NO_AI = { drafted: 0, rejectedByChecks: 0, humanEdited: 0, humanRejected: 0 };

/** The settings that the bundle carries: the thresholds and the upper limit of the guidance themes. */
const MAP_CONFIG = MapConfigSchema.parse({ thresholds: { t1: 50, t2: 150 }, guidanceMaxThemes: 3 });

/** The repository's fictional data, as it is. Its question bank defines the QUICK set only. */
export function fixtureAssemblyInput(): AssemblyInput {
  return {
    identity: TEST_IDENTITY,
    bank: loadFixtureQuestionBank(),
    cards: loadFixtureCards(),
    resultTexts: loadFixtureResultTexts(),
    fixedTexts: loadFixtureFixedTexts(),
    guidance: loadFixtureGuidance(),
    mapConfig: MAP_CONFIG,
    aiContribution: NO_AI,
  };
}

const SLUG: Readonly<Record<string, string>> = {
  TRANSPORT: "transport",
  EDUCATION_CHILDCARE: "education",
  ECONOMY_EMPLOYMENT: "economy",
  HEALTHCARE_WELFARE: "healthcare",
  DISASTER_PREVENTION: "disaster",
  POPULATION_REVITALIZATION: "population",
};

function slugOf(themeId: string): string {
  return SLUG[themeId] ?? themeId.toLowerCase();
}

/** A card for each theme, made from a fictional card of the repository. */
function cardsForAllThemes(): IssueCard[] {
  const [base] = loadFixtureCards();
  if (base === undefined) {
    throw new Error("The fixture has a card");
  }
  return ALL_THEMES.map((themeId) =>
    IssueCardSchema.parse({
      ...base,
      cardId: `test-card-${slugOf(themeId)}`,
      themeId,
      sources: [{ dataKind: "FIXTURE", sourceId: `test-source-${slugOf(themeId)}` }],
      quote: { sourceId: `test-source-${slugOf(themeId)}`, text: base.quote.text },
      facts: [],
    }),
  );
}

function resultTextsForAllThemes(): ResultText[] {
  const base = loadFixtureResultTexts();
  return ALL_THEMES.flatMap((themeId) =>
    base
      .filter((item) => item.themeId === "POPULATION_REVITALIZATION")
      .map((item) => ResultTextSchema.parse({ ...item, themeId })),
  );
}

function guidanceForAllThemes(): GuidanceQuestion[] {
  const base = loadFixtureGuidance();
  return ALL_THEMES.flatMap((themeId) =>
    base
      .filter((item) => item.themeId === "POPULATION_REVITALIZATION")
      .map((item) => GuidanceQuestionSchema.parse({ ...item, themeId })),
  );
}

/**
 * A complete input: the passing bank (a QUICK set of three themes and a FULL set of six themes and a
 * priority pick), and an approved card, ten result texts and three guidance questions for each of
 * the six themes.
 */
export function fullAssemblyInput(): AssemblyInput {
  return {
    identity: TEST_IDENTITY,
    bank: buildPassingBank(),
    cards: cardsForAllThemes(),
    resultTexts: resultTextsForAllThemes(),
    fixedTexts: loadFixtureFixedTexts(),
    guidance: guidanceForAllThemes(),
    mapConfig: MAP_CONFIG,
    aiContribution: NO_AI,
  };
}
