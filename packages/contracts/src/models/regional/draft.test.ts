import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  ApprovalLedgerRecordSchema,
  BackgroundDraftOutputSchema,
  DraftEventSchema,
  DraftRecordSchema,
  EvidenceUnitSchema,
  FactGroundedSentenceSchema,
  GroundedSentenceSchema,
  IssueCandidateOutputSchema,
  IssueConfirmationSchema,
  IssueSummaryOutputSchema,
  NeutralityReviewOutputSchema,
  QuestionDraftOutputSchema,
  ResponseDirectionCandidateSchema,
  TermGlossOutputSchema,
  ThemeClassifyOutputSchema,
} from "./draft.js";

type Json = Record<string, unknown>;

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

const factSentence = (overrides: Json = {}): Json => ({
  text: "架空市の空き家は100戸です。",
  groundFactIds: ["fact-1"],
  ...overrides,
});

const direction = (overrides: Json = {}): Json => ({
  label: "空き家の活用",
  description: "空き家を活用する取り組みを進める",
  category: "CHANGE",
  status: "REFERENCE_ONLY",
  ...overrides,
});

const candidate = (overrides: Json = {}): Json => ({
  themeId: "POPULATION_REVITALIZATION",
  title: "空き家の増加",
  statement: "空き家の増加が暮らしに影響している可能性があります。",
  basisFactIds: ["fact-1", "fact-2"],
  factSummary: [factSentence()],
  background: [],
  notDeterminable: ["増えた原因は資料から判断できません。"],
  additionalChecks: ["地区ごとの状況を確認する必要があります。"],
  decisionScenes: ["住まいを選ぶとき"],
  responseDirections: [direction()],
  ...overrides,
});

describe("IssueCandidateOutputSchema: accepted values", () => {
  it("accepts a candidate with every section", () => {
    expect(IssueCandidateOutputSchema.safeParse(candidate()).success).toBe(true);
  });

  it("accepts UNCLASSIFIED as the theme of a candidate (a person decides the theme at adoption)", () => {
    expect(IssueCandidateOutputSchema.safeParse(candidate({ themeId: "UNCLASSIFIED" })).success).toBe(true);
  });

  it("accepts the smallest candidate and the largest candidate", () => {
    const smallest = candidate({ responseDirections: [], decisionScenes: [], background: [] });
    expect(IssueCandidateOutputSchema.safeParse(smallest).success).toBe(true);

    const ids = Array.from({ length: 10 }, (_, index) => `fact-${index + 1}`);
    const largest = candidate({
      basisFactIds: ids,
      factSummary: Array.from({ length: 4 }, (_, index) => factSentence({ groundFactIds: [ids[index]] })),
      background: Array.from({ length: 4 }, (_, index) => factSentence({ groundFactIds: [ids[index + 4]] })),
      notDeterminable: Array.from({ length: 5 }, (_, index) => `判断できないこと${index}`),
      additionalChecks: Array.from({ length: 5 }, (_, index) => `追加の確認${index}`),
      decisionScenes: ["場面1", "場面2", "場面3"],
      responseDirections: Array.from({ length: 4 }, (_, index) => direction({ label: `方向${index}` })),
      title: "あ".repeat(40),
      statement: "い".repeat(60),
    });
    expect(IssueCandidateOutputSchema.safeParse(largest).success).toBe(true);
  });

  it("counts Unicode code points, not UTF-16 code units, for the length of a sentence", () => {
    // 60 code points that are each 2 code units long.
    const sixty = "𠮷".repeat(60);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ statement: sixty })).success).toBe(true);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ statement: `${sixty}あ` })).success).toBe(false);
  });
});

describe("IssueCandidateOutputSchema: rejected values", () => {
  it("rejects a candidate without a basis fact, with more than ten, or with a repeated one", () => {
    expect(rejectedPaths(IssueCandidateOutputSchema, candidate({ basisFactIds: [] }))).toContain("basisFactIds");
    expect(IssueCandidateOutputSchema.safeParse(candidate({ basisFactIds: undefined })).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, index) => `fact-${index + 1}`);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ basisFactIds: eleven, factSummary: [factSentence()] })).success).toBe(
      false,
    );
    expect(IssueCandidateOutputSchema.safeParse(candidate({ basisFactIds: ["fact-1", "fact-1"] })).success).toBe(false);
  });

  it("rejects a sentence without a ground, and a ground that is not one of the basis facts", () => {
    expect(rejectedPaths(IssueCandidateOutputSchema, candidate({ factSummary: [factSentence({ groundFactIds: [] })] }))).toContain(
      "factSummary.0.groundFactIds",
    );
    expect(
      rejectedPaths(IssueCandidateOutputSchema, candidate({ factSummary: [factSentence({ groundFactIds: ["fact-9"] })] })),
    ).toContain("factSummary.0.groundFactIds.0");
    expect(
      rejectedPaths(IssueCandidateOutputSchema, candidate({ background: [factSentence({ groundFactIds: ["fact-9"] })] })),
    ).toContain("background.0.groundFactIds.0");
    expect(rejectedPaths(IssueCandidateOutputSchema, candidate({ factSummary: [{ text: "根拠のない文です。" }] }))).not.toEqual([]);
  });

  it("rejects a sentence of 61 code points and a statement that is two sentences", () => {
    expect(
      IssueCandidateOutputSchema.safeParse(candidate({ factSummary: [factSentence({ text: "あ".repeat(61) })] })).success,
    ).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ statement: "あ".repeat(61) })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ statement: "可能性があります。そうかもしれません。" })).success).toBe(
      false,
    );
    expect(IssueCandidateOutputSchema.safeParse(candidate({ title: "あ".repeat(41) })).success).toBe(false);
  });

  it("rejects a theme that is neither one of the six nor UNCLASSIFIED", () => {
    expect(IssueCandidateOutputSchema.safeParse(candidate({ themeId: "OTHER" })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ themeId: "unclassified" })).success).toBe(false);
  });

  it("rejects too few or too many of the list sections", () => {
    expect(IssueCandidateOutputSchema.safeParse(candidate({ factSummary: [] })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ notDeterminable: [] })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ additionalChecks: [] })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ factSummary: Array.from({ length: 5 }, () => factSentence()) })).success).toBe(
      false,
    );
    expect(IssueCandidateOutputSchema.safeParse(candidate({ decisionScenes: ["a", "b", "c", "d"] })).success).toBe(false);
    expect(
      IssueCandidateOutputSchema.safeParse(candidate({ responseDirections: Array.from({ length: 5 }, () => direction()) })).success,
    ).toBe(false);
  });

  it.each(["rank", "score", "priority", "recommendation", "superiority", "disposition", "approval"])(
    "rejects the extra field %s (strict)",
    (field) => {
      expect(IssueCandidateOutputSchema.safeParse(candidate({ [field]: 1 })).success).toBe(false);
    },
  );

  it("rejects an extra field in a nested object", () => {
    expect(IssueCandidateOutputSchema.safeParse(candidate({ factSummary: [factSentence({ score: 1 })] })).success).toBe(false);
    expect(IssueCandidateOutputSchema.safeParse(candidate({ responseDirections: [direction({ rank: 1 })] })).success).toBe(false);
  });
});

describe("ResponseDirectionCandidateSchema", () => {
  it("allows only the fixed status REFERENCE_ONLY", () => {
    expect(ResponseDirectionCandidateSchema.safeParse(direction()).success).toBe(true);
    expect(ResponseDirectionCandidateSchema.safeParse(direction({ status: "SELECTED" })).success).toBe(false);
    expect(ResponseDirectionCandidateSchema.safeParse(direction({ status: undefined })).success).toBe(false);
  });

  it("limits the label to 30 and the description to 60 code points, and the category to three", () => {
    expect(ResponseDirectionCandidateSchema.safeParse(direction({ label: "あ".repeat(31) })).success).toBe(false);
    expect(ResponseDirectionCandidateSchema.safeParse(direction({ description: "あ".repeat(61) })).success).toBe(false);
    expect(ResponseDirectionCandidateSchema.safeParse(direction({ category: "BEST" })).success).toBe(false);
  });
});

describe("the sentences", () => {
  it("a grounded sentence has one or more different grounds and at most 60 code points", () => {
    expect(GroundedSentenceSchema.safeParse({ text: "空き家は100戸です。", groundIds: ["E1"] }).success).toBe(true);
    expect(GroundedSentenceSchema.safeParse({ text: "空き家は100戸です。", groundIds: [] }).success).toBe(false);
    expect(GroundedSentenceSchema.safeParse({ text: "空き家は100戸です。", groundIds: ["E1", "E1"] }).success).toBe(false);
    expect(GroundedSentenceSchema.safeParse({ text: "あ".repeat(61), groundIds: ["E1"] }).success).toBe(false);
  });

  it("a fact grounded sentence is one sentence", () => {
    expect(FactGroundedSentenceSchema.safeParse(factSentence()).success).toBe(true);
    expect(FactGroundedSentenceSchema.safeParse(factSentence({ text: "一つ目です。二つ目です。" })).success).toBe(false);
  });

  it("an evidence unit has a source, a locator and a quotation", () => {
    const unit = { evidenceId: "E1", sourceId: "src-1", locator: { kind: "pdf-page", page: 3 }, text: "空き家は100戸" };
    expect(EvidenceUnitSchema.safeParse(unit).success).toBe(true);
    expect(EvidenceUnitSchema.safeParse({ ...unit, text: "" }).success).toBe(false);
    expect(EvidenceUnitSchema.safeParse({ ...unit, locator: { kind: "pdf-page", page: 0 } }).success).toBe(false);
  });
});

describe("the outputs of the other tasks", () => {
  const sentence = { text: "空き家は100戸です。", groundIds: ["E1"] };

  it("accepts an issue summary of 1 to 4 sentences", () => {
    expect(IssueSummaryOutputSchema.safeParse({ sentences: [sentence] }).success).toBe(true);
    expect(IssueSummaryOutputSchema.safeParse({ sentences: [] }).success).toBe(false);
    expect(IssueSummaryOutputSchema.safeParse({ sentences: Array.from({ length: 5 }, () => sentence) }).success).toBe(false);
  });

  it("accepts a background draft of 1 to 6 sentences with a title of at most 40 code points", () => {
    expect(BackgroundDraftOutputSchema.safeParse({ title: "空き家", sentences: Array.from({ length: 6 }, () => sentence) }).success).toBe(true);
    expect(BackgroundDraftOutputSchema.safeParse({ title: "空き家", sentences: Array.from({ length: 7 }, () => sentence) }).success).toBe(false);
    expect(BackgroundDraftOutputSchema.safeParse({ title: "あ".repeat(41), sentences: [sentence] }).success).toBe(false);
  });

  it("accepts a gloss of 1 to 10 terms of 1 to 3 sentences", () => {
    const item = { term: "空き家", sentences: [sentence] };
    expect(TermGlossOutputSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(TermGlossOutputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(TermGlossOutputSchema.safeParse({ items: [{ ...item, sentences: [] }] }).success).toBe(false);
    expect(TermGlossOutputSchema.safeParse({ items: Array.from({ length: 11 }, () => item) }).success).toBe(false);
  });

  it("accepts the three kinds of a question draft", () => {
    const common = { explanation: "説明です。", unsureLabel: "わからない", declineLabel: "答えない" };
    expect(QuestionDraftOutputSchema.safeParse({ kind: "IMPORTANCE", themeId: "TRANSPORT", ...common }).success).toBe(true);
    expect(QuestionDraftOutputSchema.safeParse({ kind: "PRIORITY_PICK", text: "大切にしたいテーマは何ですか？", ...common }).success).toBe(true);
    const tradeoff = {
      kind: "TRADEOFF",
      themeId: "TRANSPORT",
      text: "どちらに近いですか？",
      premise: "予算は限られています。",
      directionA: { text: "路線を維持する", category: "CONTINUE" },
      directionB: { text: "新しい交通を試す", category: "CHANGE" },
      opinionLabels: ["A", "ややA", "どちらでもない", "ややB", "B"],
      ...common,
    };
    expect(QuestionDraftOutputSchema.safeParse(tradeoff).success).toBe(true);
    expect(QuestionDraftOutputSchema.safeParse({ ...tradeoff, opinionLabels: ["A", "B"] }).success).toBe(false);
    expect(QuestionDraftOutputSchema.safeParse({ ...tradeoff, themeId: "UNCLASSIFIED" }).success).toBe(false);
    expect(QuestionDraftOutputSchema.safeParse({ kind: "OTHER", ...common }).success).toBe(false);
  });

  it("accepts a neutrality review with findings of at most 100 code points", () => {
    expect(NeutralityReviewOutputSchema.safeParse({ verdict: "NO_BIAS_FOUND", findings: [] }).success).toBe(true);
    expect(
      NeutralityReviewOutputSchema.safeParse({ verdict: "BIAS_SUSPECTED", findings: [{ target: "PREMISE", note: "前提文が一方に寄っています。" }] }).success,
    ).toBe(true);
    expect(NeutralityReviewOutputSchema.safeParse({ verdict: "MAYBE", findings: [] }).success).toBe(false);
    expect(
      NeutralityReviewOutputSchema.safeParse({ verdict: "BIAS_SUSPECTED", findings: [{ target: "TEXT", note: "あ".repeat(101) }] }).success,
    ).toBe(false);
  });

  it("accepts a theme classification that is one of the six themes or UNCLASSIFIED only", () => {
    expect(ThemeClassifyOutputSchema.safeParse({ themeId: "TRANSPORT" }).success).toBe(true);
    expect(ThemeClassifyOutputSchema.safeParse({ themeId: "UNCLASSIFIED" }).success).toBe(true);
    expect(ThemeClassifyOutputSchema.safeParse({ themeId: "OTHER" }).success).toBe(false);
  });
});

describe("DraftRecordSchema", () => {
  const record = (overrides: Json = {}): Json => ({
    draftId: SHA_A,
    key: { task: "ISSUE_CANDIDATE", promptVersion: "rv-draft-1", modelId: "jp.anthropic.claude-haiku-5-5", inputHash: SHA_B },
    dataKind: "FIXTURE",
    aiClass: "AI_DRAFT",
    modelId: "jp.anthropic.claude-haiku-5-5",
    generatedAt: "2026-01-04T09:00:00Z",
    inputSources: [{ sourceId: "src-1", revision: "r1", sha256: SHA_C }],
    output: candidate(),
    ...overrides,
  });

  it("accepts a saved draft whose output is the output of its task", () => {
    expect(DraftRecordSchema.safeParse(record()).success).toBe(true);
    expect(
      DraftRecordSchema.safeParse(
        record({ key: { task: "THEME_CLASSIFY", promptVersion: "rv-draft-1", modelId: "jp.anthropic.claude-haiku-5-5", inputHash: SHA_B }, output: { themeId: "TRANSPORT" } }),
      ).success,
    ).toBe(true);
  });

  it("accepts a draft without an input source (a review of a question has no source)", () => {
    expect(DraftRecordSchema.safeParse(record({ inputSources: [] })).success).toBe(true);
  });

  it("rejects the field disposition (an adoption is derived, not stored)", () => {
    expect(rejectedPaths(DraftRecordSchema, record({ disposition: "ADOPTED" }))).not.toEqual([]);
    expect(DraftRecordSchema.safeParse(record({ disposition: "PENDING" })).success).toBe(false);
  });

  it("rejects an output that is not the output of the task", () => {
    expect(
      DraftRecordSchema.safeParse(record({ key: { task: "THEME_CLASSIFY", promptVersion: "p", modelId: "jp.anthropic.claude-haiku-5-5", inputHash: SHA_B } })).success,
    ).toBe(false);
    expect(DraftRecordSchema.safeParse(record({ output: undefined })).success).toBe(false);
    expect(DraftRecordSchema.safeParse(record({ output: null })).success).toBe(false);
  });

  it("checks the output again: a rank in the output is rejected with a path under output", () => {
    const paths = rejectedPaths(DraftRecordSchema, record({ output: candidate({ rank: 1 }) }));
    expect(paths.some((path) => path.startsWith("output"))).toBe(true);
  });

  it("rejects a class other than AI_DRAFT, a different model in the key, a bad hash and a repeated source revision", () => {
    expect(DraftRecordSchema.safeParse(record({ aiClass: "HUMAN" })).success).toBe(false);
    expect(DraftRecordSchema.safeParse(record({ modelId: "jp.anthropic.claude-opus-5-5" })).success).toBe(false);
    expect(DraftRecordSchema.safeParse(record({ draftId: "xyz" })).success).toBe(false);
    const source = { sourceId: "src-1", revision: "r1", sha256: SHA_C };
    expect(DraftRecordSchema.safeParse(record({ inputSources: [source, source] })).success).toBe(false);
  });
});

describe("DraftEventSchema", () => {
  const event = (overrides: Json = {}): Json => ({
    eventId: SHA_A,
    at: "2026-01-04T09:00:00Z",
    dataKind: "FIXTURE",
    task: "ISSUE_CANDIDATE",
    kind: "DRAFTED",
    draftId: SHA_B,
    ...overrides,
  });
  const target = { targetKind: "ISSUE", targetId: "issue-1" };

  it("accepts the five kinds in their forms", () => {
    expect(DraftEventSchema.safeParse(event()).success).toBe(true);
    expect(DraftEventSchema.safeParse(event({ kind: "REJECTED_BY_CHECKS", draftId: null })).success).toBe(true);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_ADOPTED", reviewerId: "rev-1", target })).success).toBe(true);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_EDITED", reviewerId: "rev-1", target })).success).toBe(true);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_REJECTED", reviewerId: "rev-1" })).success).toBe(true);
  });

  it("rejects a draftId on REJECTED_BY_CHECKS and a missing draftId on every other kind", () => {
    expect(DraftEventSchema.safeParse(event({ kind: "REJECTED_BY_CHECKS" })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ draftId: null })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_REJECTED", reviewerId: "rev-1", draftId: null })).success).toBe(false);
  });

  it("needs the reviewer for a human record and gives it to no other record", () => {
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_ADOPTED", target })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_REJECTED" })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ reviewerId: "rev-1" })).success).toBe(false);
  });

  it("gives the target to an adoption only", () => {
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_ADOPTED", reviewerId: "rev-1" })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_REJECTED", reviewerId: "rev-1", target })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ target })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ kind: "HUMAN_ADOPTED", reviewerId: "rev-1", target: { targetKind: "OTHER", targetId: "x" } })).success).toBe(false);
  });

  it("rejects an unknown kind and an extra field", () => {
    expect(DraftEventSchema.safeParse(event({ kind: "APPROVED" })).success).toBe(false);
    expect(DraftEventSchema.safeParse(event({ disposition: "ADOPTED" })).success).toBe(false);
  });
});

describe("ApprovalLedgerRecordSchema", () => {
  const checks = {
    factsMatch: true,
    factAndHypothesisSeparated: true,
    noCausalClaim: true,
    noRecommendation: true,
    unknownsStated: true,
    sourcesShown: true,
  };
  const issueApprove = (overrides: Json = {}): Json => ({
    type: "APPROVE",
    targetKind: "ISSUE",
    targetId: "issue-1",
    targetHash: SHA_A,
    targetVersion: 2,
    approverId: "approver-1",
    approvedAt: "2026-01-04T09:00:00Z",
    issueChecks: checks,
    ...overrides,
  });
  const cardApprove = (overrides: Json = {}): Json => ({
    type: "APPROVE",
    targetKind: "CARD",
    targetId: "card-1",
    targetHash: SHA_A,
    approverId: "approver-1",
    approvedAt: "2026-01-04T09:00:00Z",
    ...overrides,
  });

  it("accepts an approval of an issue with its version and the six confirmations", () => {
    expect(ApprovalLedgerRecordSchema.safeParse(issueApprove()).success).toBe(true);
  });

  it("accepts an approval of every other kind without the version and the confirmations", () => {
    for (const targetKind of ["QUESTION", "CARD", "RESULT_TEXT", "FIXED_TEXT"]) {
      expect(ApprovalLedgerRecordSchema.safeParse(cardApprove({ targetKind })).success, targetKind).toBe(true);
    }
  });

  it("accepts a revoke of every kind of target", () => {
    for (const targetKind of ["QUESTION", "CARD", "RESULT_TEXT", "FIXED_TEXT", "ISSUE"]) {
      const revoke = { type: "REVOKE", targetKind, targetId: "t-1", targetHash: SHA_A, revokerId: "rev-1", revokedAt: "2026-01-05T09:00:00Z" };
      expect(ApprovalLedgerRecordSchema.safeParse(revoke).success, targetKind).toBe(true);
    }
  });

  it("rejects an approval of an issue without the confirmations or without the version", () => {
    expect(rejectedPaths(ApprovalLedgerRecordSchema, issueApprove({ issueChecks: undefined }))).toContain("issueChecks");
    expect(rejectedPaths(ApprovalLedgerRecordSchema, issueApprove({ targetVersion: undefined }))).toContain("targetVersion");
    expect(ApprovalLedgerRecordSchema.safeParse(issueApprove({ targetVersion: 0 })).success).toBe(false);
  });

  it.each(Object.keys(checks))("rejects an approval whose confirmation %s is false (a false confirmation is not a weaker approval)", (name) => {
    const record = issueApprove({ issueChecks: { ...checks, [name]: false } });
    expect(rejectedPaths(ApprovalLedgerRecordSchema, record)).toContain(`issueChecks.${name}`);
  });

  it("rejects a missing confirmation and an extra confirmation", () => {
    const { sourcesShown, ...five } = checks;
    void sourcesShown;
    expect(IssueConfirmationSchema.safeParse(five).success).toBe(false);
    expect(IssueConfirmationSchema.safeParse({ ...checks, extra: true }).success).toBe(false);
  });

  it("rejects the confirmations or the version on an approval that is not of an issue", () => {
    expect(rejectedPaths(ApprovalLedgerRecordSchema, cardApprove({ issueChecks: checks }))).toContain("issueChecks");
    expect(rejectedPaths(ApprovalLedgerRecordSchema, cardApprove({ targetVersion: 1 }))).toContain("targetVersion");
  });

  it("is not a place for the adoption of a draft, and a revoke has no approver", () => {
    expect(ApprovalLedgerRecordSchema.safeParse({ ...cardApprove(), type: "HUMAN_ADOPTED" }).success).toBe(false);
    const revoke = { type: "REVOKE", targetKind: "CARD", targetId: "c", targetHash: SHA_A, revokerId: "r", revokedAt: "2026-01-05T09:00:00Z" };
    expect(ApprovalLedgerRecordSchema.safeParse({ ...revoke, approverId: "a" }).success).toBe(false);
    expect(ApprovalLedgerRecordSchema.safeParse({ ...revoke, revokerId: undefined }).success).toBe(false);
  });
});
