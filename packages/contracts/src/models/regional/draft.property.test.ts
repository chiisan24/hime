import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { THEME_IDS } from "./core.js";
import { DraftEventSchema, DraftRecordSchema, IssueCandidateOutputSchema } from "./draft.js";

// Feature: regional-values-map, 契約の性質（11.1。番号つきの Property の担当は 11.3 と 11.5）:
// 課題候補の契約は、形に合う出力だけを受け入れ、順位・スコア・推奨・優劣の項目を、どこに混ぜても拒否する。
// 下書きの記録は採否の項目を持たず、出力はそのtaskの出力に限る。下書きの記録の形は種類に従う。

const KANA = [..."あいうえおかきくけこさしすせそたちつてとなにぬねの"];
const SHA = "a".repeat(64);

function text(min: number, max: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...KANA), { minLength: min, maxLength: max }).map((chars) => chars.join(""));
}

const factIds = (min: number, max: number) =>
  fc.uniqueArray(fc.integer({ min: 1, max: 99 }).map((number) => `fact-${number}`), { minLength: min, maxLength: max });

type Candidate = Record<string, unknown> & {
  factSummary: Record<string, unknown>[];
  responseDirections: Record<string, unknown>[];
  basisFactIds: string[];
};

const candidateArbitrary: fc.Arbitrary<Candidate> = factIds(1, 10).chain((basis) => {
  const sentence = fc.record({
    text: text(1, 60),
    groundFactIds: fc.uniqueArray(fc.constantFrom(...basis), { minLength: 1, maxLength: basis.length }),
  });
  return fc.record({
    themeId: fc.constantFrom(...THEME_IDS, "UNCLASSIFIED"),
    title: text(1, 40),
    statement: text(1, 60),
    basisFactIds: fc.constant(basis),
    factSummary: fc.array(sentence, { minLength: 1, maxLength: 4 }),
    background: fc.array(sentence, { maxLength: 4 }),
    notDeterminable: fc.array(text(1, 60), { minLength: 1, maxLength: 5 }),
    additionalChecks: fc.array(text(1, 60), { minLength: 1, maxLength: 5 }),
    decisionScenes: fc.array(text(1, 60), { maxLength: 3 }),
    responseDirections: fc.array(
      fc.record({
        label: text(1, 30),
        description: text(1, 60),
        category: fc.constantFrom("CHANGE", "CONTINUE", "NEUTRAL"),
        status: fc.constant("REFERENCE_ONLY"),
      }),
      { maxLength: 4 },
    ),
  });
});

const FORBIDDEN_FIELDS = ["rank", "score", "priority", "recommendation", "superiority", "rating", "disposition", "approval"];

describe("contract property: the issue candidate contract", () => {
  it("accepts every candidate of the right form", () => {
    fc.assert(
      fc.property(candidateArbitrary, (candidate) => {
        expect(IssueCandidateOutputSchema.safeParse(candidate).success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects a rank, a score, a recommendation or a superiority at any level", () => {
    fc.assert(
      fc.property(candidateArbitrary, fc.constantFrom(...FORBIDDEN_FIELDS), fc.integer({ min: 0, max: 2 }), (candidate, field, level) => {
        const copy: Candidate = structuredClone(candidate);
        if (level === 0) {
          copy[field] = 1;
        } else if (level === 1) {
          copy.factSummary[0] = { ...copy.factSummary[0], [field]: 1 };
        } else if (copy.responseDirections.length > 0) {
          copy.responseDirections[0] = { ...copy.responseDirections[0], [field]: 1 };
        } else {
          copy[field] = 1;
        }
        expect(IssueCandidateOutputSchema.safeParse(copy).success).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects a ground that is not one of the basis facts", () => {
    fc.assert(
      fc.property(candidateArbitrary, (candidate) => {
        const copy: Candidate = structuredClone(candidate);
        const outside = "fact-100";
        copy.factSummary[0] = { ...copy.factSummary[0], groundFactIds: [outside] };
        expect(IssueCandidateOutputSchema.safeParse(copy).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a sentence of 61 code points in the statement, the title and a response direction", () => {
    fc.assert(
      fc.property(candidateArbitrary, text(61, 80), (candidate, long) => {
        const statement = structuredClone(candidate);
        statement.statement = long;
        expect(IssueCandidateOutputSchema.safeParse(statement).success).toBe(false);
        const title = structuredClone(candidate);
        title.title = long;
        expect(IssueCandidateOutputSchema.safeParse(title).success).toBe(false);
        const summary = structuredClone(candidate);
        summary.factSummary[0] = { ...summary.factSummary[0], text: long };
        expect(IssueCandidateOutputSchema.safeParse(summary).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe("contract property: a saved draft has no disposition and keeps the output of its task", () => {
  const record = (output: unknown, task = "ISSUE_CANDIDATE") => ({
    draftId: SHA,
    key: { task, promptVersion: "rv-draft-1", modelId: "model-1", inputHash: SHA },
    dataKind: "FIXTURE",
    aiClass: "AI_DRAFT",
    modelId: "model-1",
    generatedAt: "2026-01-04T09:00:00Z",
    inputSources: [],
    output,
  });

  it("accepts a candidate as the output of ISSUE_CANDIDATE and rejects it as the output of another task", () => {
    fc.assert(
      fc.property(candidateArbitrary, fc.constantFrom("ISSUE_SUMMARY", "BACKGROUND_DRAFT", "TERM_GLOSS", "THEME_CLASSIFY", "NEUTRALITY_REVIEW"), (candidate, task) => {
        expect(DraftRecordSchema.safeParse(record(candidate)).success).toBe(true);
        expect(DraftRecordSchema.safeParse(record(candidate, task)).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects the field disposition whatever its value", () => {
    fc.assert(
      fc.property(candidateArbitrary, fc.constantFrom("PENDING", "ADOPTED", "REJECTED", "", null), (candidate, disposition) => {
        expect(DraftRecordSchema.safeParse({ ...record(candidate), disposition }).success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe("contract property: the form of the draft events", () => {
  const kinds = ["DRAFTED", "REJECTED_BY_CHECKS", "HUMAN_ADOPTED", "HUMAN_EDITED", "HUMAN_REJECTED"] as const;

  it("accepts an event exactly when draftId, reviewerId and target follow the kind", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...kinds),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (kind, hasDraftId, hasReviewer, hasTarget) => {
          const event: Record<string, unknown> = {
            eventId: SHA,
            at: "2026-01-04T09:00:00Z",
            dataKind: "FIXTURE",
            task: "ISSUE_CANDIDATE",
            kind,
            draftId: hasDraftId ? SHA : null,
          };
          if (hasReviewer) event["reviewerId"] = "rev-1";
          if (hasTarget) event["target"] = { targetKind: "ISSUE", targetId: "issue-1" };
          const human = kind.startsWith("HUMAN_");
          const adoption = kind === "HUMAN_ADOPTED" || kind === "HUMAN_EDITED";
          const expected = hasDraftId === (kind !== "REJECTED_BY_CHECKS") && hasReviewer === human && hasTarget === adoption;
          expect(DraftEventSchema.safeParse(event).success).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
