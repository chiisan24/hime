import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  BUNDLE_SCHEMA_VERSION,
  FixedTextsSchema,
  GuidanceQuestionSchema,
  IssueCardSchema,
  MapConfigSchema,
  QuestionBankSchema,
  RegionalBundleSchema,
  ResultTextSchema,
  requiredFixedTextKeys,
} from "@ehime-vote-navigator/contracts";
import type { SessionBundle } from "../session/sessionTypes.js";
import type { ViewBundle } from "../view/viewTypes.js";
import { calculateContentHash } from "./contentHash.js";
import { verifyBundleText } from "./verifyBundleText.js";
import type { ExpectedBundle, VerifiedBundle } from "./verifyBundleText.js";

const FIXTURE_DIRECTORY = new URL("../../../../fixtures/src/regional-values/", import.meta.url);
const HASH = "a".repeat(64);
const DEMO_EXPECTED: ExpectedBundle = { schemaVersion: BUNDLE_SCHEMA_VERSION, dataVersion: "2026-01-01.1", buildKind: "DEMO" };
const PUBLIC_EXPECTED: ExpectedBundle = { schemaVersion: BUNDLE_SCHEMA_VERSION, dataVersion: "2026-01-01.1", buildKind: "PUBLIC" };

function fixtureJson(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURE_DIRECTORY)), "utf8")) as unknown;
}

function fixtureBody() {
  const bank = QuestionBankSchema.parse(fixtureJson("question-bank.json"));
  return {
    meta: {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      generatedAt: "2026-01-04T09:00:00Z",
      dataVersion: DEMO_EXPECTED.dataVersion,
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

async function completeBundle(body = fixtureBody()) {
  const parsed = RegionalBundleSchema.parse(body);
  const contentHash = await calculateContentHash(parsed);
  return RegionalBundleSchema.parse({ ...parsed, meta: { ...parsed.meta, contentHash } });
}

async function textOf(body = fixtureBody()): Promise<string> {
  return JSON.stringify(await completeBundle(body));
}

async function expectCode(text: string, expected: ExpectedBundle, code: string): Promise<void> {
  const result = await verifyBundleText(text, expected);
  expect(result).toEqual({ ok: false, error: code });
  expect("value" in result).toBe(false);
}

function assertSession(bundle: VerifiedBundle): SessionBundle {
  return bundle;
}

function assertView(bundle: VerifiedBundle): ViewBundle {
  return bundle;
}

describe("verifyBundleText", () => {
  it("accepts a valid fixture bundle and returns its structured fields", async () => {
    const result = await verifyBundleText(await textOf(), DEMO_EXPECTED);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.meta.dataKind).toBe("FIXTURE");
    expect(result.value.diagnosticSets.map((set) => set.setKind)).toEqual(["QUICK"]);
    expect(result.value.cards).toHaveLength(3);
    expect(result.value.resultTexts).toHaveLength(30);
    expect(result.value.guidance).toHaveLength(9);
  });

  it("returns only the first error code and no content for malformed text or meta", async () => {
    await expectCode("{", DEMO_EXPECTED, "NOT_JSON");
    const valid = await completeBundle();
    await expectCode(JSON.stringify({ ...valid, meta: { schemaVersion: 1 } }), DEMO_EXPECTED, "META_MISSING");
    await expectCode(JSON.stringify({ ...valid, meta: { ...valid.meta, generatedAt: "not-a-date" } }), DEMO_EXPECTED, "GENERATED_AT_INVALID");
  });

  it("checks expected schema, data and build versions before the strict schema", async () => {
    const valid = await completeBundle();
    await expectCode(JSON.stringify({ ...valid, meta: { ...valid.meta, schemaVersion: 99 } }), DEMO_EXPECTED, "SCHEMA_VERSION_MISMATCH");
    await expectCode(await textOf(), { ...DEMO_EXPECTED, dataVersion: "different" }, "DATA_VERSION_MISMATCH");
    await expectCode(await textOf(), PUBLIC_EXPECTED, "BUILD_KIND_MISMATCH");
  });

  it("rejects a strict-schema violation before comparing its hash", async () => {
    const valid = await completeBundle();
    await expectCode(JSON.stringify({ ...valid, unknown: true }), DEMO_EXPECTED, "SCHEMA_INVALID");
  });

  it("rejects a changed body whose saved hash no longer matches", async () => {
    const valid = await completeBundle();
    await expectCode(
      JSON.stringify({ ...valid, themes: [...valid.themes].reverse() }),
      DEMO_EXPECTED,
      "HASH_MISMATCH",
    );
  });

  it("checks all references after the hash: question ID, QUICK, card, result text, guidance and fixed keys", async () => {
    const complete = await completeBundle();
    const withoutQuestion = await textOf({ ...complete, questions: complete.questions.slice(1) });
    await expectCode(withoutQuestion, DEMO_EXPECTED, "REFERENCE_BROKEN");
    const withoutQuick = await textOf({ ...complete, diagnosticSets: [] });
    await expectCode(withoutQuick, DEMO_EXPECTED, "REFERENCE_BROKEN");
    const withoutCard = await textOf({ ...complete, cards: complete.cards.slice(1) });
    await expectCode(withoutCard, DEMO_EXPECTED, "REFERENCE_BROKEN");
    const withoutResult = await textOf({ ...complete, resultTexts: complete.resultTexts.slice(1) });
    await expectCode(withoutResult, DEMO_EXPECTED, "REFERENCE_BROKEN");
    const withoutGuidance = await textOf({ ...complete, guidance: complete.guidance.slice(1) });
    await expectCode(withoutGuidance, DEMO_EXPECTED, "REFERENCE_BROKEN");
    const first = complete.fixedTexts.items[0];
    if (first === undefined) {
      throw new Error("The fixture has no fixed text");
    }
    const withoutFixed = JSON.stringify({ ...complete, fixedTexts: { ...complete.fixedTexts, items: complete.fixedTexts.items.slice(1) } });
    await expectCode(withoutFixed, DEMO_EXPECTED, "SCHEMA_INVALID");
    expect(requiredFixedTextKeys("FIXTURE")).toContain(first.key);
  });

  it("checks that a question referenced by a set belongs to a theme of that set", async () => {
    const complete = await completeBundle();
    const quick = complete.diagnosticSets[0];
    const firstQuestion = complete.questions[0];
    if (quick === undefined || firstQuestion === undefined || firstQuestion.kind === "PRIORITY_PICK") {
      throw new Error("The fixture needs a themed first question and QUICK");
    }
    const changedSet = { ...quick, themeIds: ["TRANSPORT", "DISASTER_PREVENTION", "EDUCATION_CHILDCARE"] };
    await expectCode(await textOf({ ...complete, diagnosticSets: [changedSet] }), DEMO_EXPECTED, "REFERENCE_BROKEN");
  });

  it("requires confirmed usage for every source of a PUBLIC bundle", async () => {
    const fixture = await completeBundle();
    const realCards = fixture.cards.map((card) => ({
      ...card,
      dataKind: "REAL_AI",
      facts: [],
      sources: card.sources.map((source) => ({
        dataKind: "REAL_AI",
        sourceId: source.sourceId,
        revision: "r1",
        reference: { kind: "url", url: `https://example.test/${source.sourceId}` },
        publisher: "Test publisher",
        publishedOn: "2026-01-01",
        retrievedAt: "2026-01-01T00:00:00Z",
        locator: { kind: "text-lines", startLine: 1, endLine: 1 },
        sha256: HASH,
        usage: { status: "UNKNOWN", checkedAt: "2026-01-01", checkedTarget: "terms", evidence: "test" },
        datasetNote: { hasSpecificNote: false, checkedBy: "reviewer", checkedAt: "2026-01-01T00:00:00Z" },
        transmission: { status: "UNKNOWN" },
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      })),
    }));
    const realFixedTexts = FixedTextsSchema.parse({
      dataKind: "REAL_AI",
      items: requiredFixedTextKeys("REAL_AI").map((key) => ({ key, text: "テスト文です。", approval: { status: "APPROVED", approverId: "approver", approvedAt: "2026-01-01T00:00:00Z" } })),
    });
    const real = {
      ...fixture,
      meta: { ...fixture.meta, buildKind: "PUBLIC", dataKind: "REAL_AI", dataModeRequested: "REAL", dataModeResolved: "REAL" },
      questions: fixture.questions.map((question) => ({ ...question, dataKind: "REAL_AI" })),
      cards: realCards,
      resultTexts: fixture.resultTexts.map((item) => ({ ...item, dataKind: "REAL_AI" })),
      fixedTexts: realFixedTexts,
    };
    await expectCode(await textOf(real), PUBLIC_EXPECTED, "PUBLIC_CONDITION_FAILED");
    const confirmed = {
      ...real,
      cards: real.cards.map((card) =>
        card.dataKind === "REAL_AI"
          ? { ...card, sources: card.sources.map((source) => ({ ...source, usage: { ...source.usage, status: "CONFIRMED" } })) }
          : card,
      ),
    };
    const accepted = await verifyBundleText(await textOf(confirmed), PUBLIC_EXPECTED);
    expect(accepted.ok).toBe(true);
  });
});

describe("VerifiedBundle", () => {
  it("is structurally assignable to the session and view bundle types without a cast", async () => {
    expectTypeOf<VerifiedBundle>().toMatchTypeOf<SessionBundle>();
    expectTypeOf<VerifiedBundle>().toMatchTypeOf<ViewBundle>();
    const result = await verifyBundleText(await textOf(), DEMO_EXPECTED);
    if (result.ok) {
      expect(assertSession(result.value).cards).toHaveLength(3);
      expect(assertView(result.value).fixedTexts.dataKind).toBe("FIXTURE");
    }
  });
});