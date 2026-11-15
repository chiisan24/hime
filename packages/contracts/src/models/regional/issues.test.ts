import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { THEME_IDS } from "./core.js";
import {
  ApprovedIssueSchema,
  ISSUES_SCHEMA_VERSION,
  IssueLinksFileSchema,
  IssueSourceRecordSchema,
  IssuesExportReportSchema,
  IssuesFileSchema,
  IssuesReceiptSchema,
  WITHDRAWN_REASONS,
  WithdrawnIssueSchema,
} from "./issues.js";

type Json = Record<string, unknown>;

const SHA = "a".repeat(64);
const SHA_2 = "b".repeat(64);
const SHA_3 = "c".repeat(64);

function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

const LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };

const fixtureFact = (factId = "fact-1", overrides: Json = {}): Json => ({
  dataKind: "FIXTURE",
  factId,
  sentence: "架空市の空き家は100戸です。",
  value: { amount: 100, unit: "戸" },
  surveyDate: 2024,
  area: "架空市",
  fictionalSourceId: "src-1",
  ...overrides,
});

const realFact = (factId = "fact-1", overrides: Json = {}): Json => ({
  dataKind: "REAL_AI",
  factId,
  sentence: "空き家は100戸です。",
  value: { amount: 100, unit: "戸" },
  surveyDate: "2024-04-01",
  area: "試験用の地域",
  publisher: "試験用の公開者",
  sourceUrl: "https://example.com/a.csv",
  datasetUrl: "https://example.com/data",
  license: LICENSE,
  retrievedAt: "2026-02-01T00:00:00Z",
  sha256: SHA,
  locator: { kind: "text-lines", startLine: 2, endLine: 101 },
  method: { kind: "COMPUTED", aggregation: "COUNT_ROWS", column: null, equals: null, description: "行数を数える" },
  verification: { status: "VERIFIED", verifierId: "verifier-1", verifiedAt: "2026-02-02T09:00:00Z" },
  ...overrides,
});

const realSource = (overrides: Json = {}): Json => ({
  dataKind: "REAL_AI",
  sourceId: "src-r1",
  revision: "rev-1",
  reference: { kind: "url", url: "https://example.com/a.csv" },
  publisher: "試験用の公開者",
  publishedOn: "2026-01-01",
  retrievedAt: "2026-02-01T00:00:00Z",
  locator: { kind: "text-lines", startLine: 1, endLine: 101 },
  sha256: SHA,
  usage: { status: "CONFIRMED", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" },
  datasetNote: null,
  transmission: { status: "ALLOWED", checkedBy: "analyst-1", checkedAt: "2026-02-01T00:00:00Z", evidence: "規約に制限の記載がない" },
  license: LICENSE,
  ...overrides,
});

const direction = (overrides: Json = {}): Json => ({
  label: "空き家の活用",
  description: "空き家を活用する取り組みを進める",
  category: "CHANGE",
  status: "REFERENCE_ONLY",
  ...overrides,
});

const content = (overrides: Json = {}): Json => ({
  issueId: "issue-1",
  version: 1,
  themeId: "POPULATION_REVITALIZATION",
  title: "空き家の増加",
  statement: "空き家の増加が暮らしに影響している可能性があります。",
  factSummary: [{ text: "架空市の空き家は100戸です。", groundFactIds: ["fact-1"] }],
  background: [],
  notDeterminable: ["増えた原因は資料から判断できません。"],
  additionalChecks: ["地区ごとの状況を確認する必要があります。"],
  decisionScenes: ["住まいを選ぶとき"],
  responseDirections: [direction()],
  provenance: {
    aiInvolvement: "AI_DRAFT",
    draftId: SHA_2,
    modelId: "jp.anthropic.claude-haiku-5-5",
    promptVersion: "rv-draft-1",
    generatedAt: "2026-01-04T09:00:00Z",
    humanEdited: false,
  },
  ...overrides,
});

const approval: Json = { status: "APPROVED", approverId: "approver-1", approvedAt: "2026-01-05T09:00:00Z", approverCount: 2 };

const fixtureIssue = (overrides: Json = {}): Json => ({
  dataKind: "FIXTURE",
  ...content(),
  approval,
  issueHash: SHA_3,
  basisFacts: [fixtureFact()],
  sources: [{ dataKind: "FIXTURE", sourceId: "src-1" }],
  ...overrides,
});

const realIssue = (overrides: Json = {}): Json => ({
  dataKind: "REAL_AI",
  ...content({ factSummary: [{ text: "空き家は100戸です。", groundFactIds: ["fact-1"] }] }),
  approval,
  issueHash: SHA_3,
  basisFacts: [realFact()],
  sources: [realSource()],
  ...overrides,
});

describe("IssueSourceRecordSchema", () => {
  const record = (overrides: Json = {}): Json => ({ ...content(), dataKind: "FIXTURE", basisFactIds: ["fact-1"], ...overrides });

  it("accepts the content of one version of an issue", () => {
    expect(IssueSourceRecordSchema.safeParse(record()).success).toBe(true);
    expect(IssueSourceRecordSchema.safeParse(record({ dataKind: "REAL_AI" })).success).toBe(true);
  });

  it("does not allow UNCLASSIFIED: a person decides the theme when a candidate is adopted", () => {
    expect(rejectedPaths(IssueSourceRecordSchema, record({ themeId: "UNCLASSIFIED" }))).toContain("themeId");
  });

  it("needs 1 to 10 different basis facts, and every ground to be one of them", () => {
    expect(IssueSourceRecordSchema.safeParse(record({ basisFactIds: [] })).success).toBe(false);
    expect(IssueSourceRecordSchema.safeParse(record({ basisFactIds: ["fact-1", "fact-1"] })).success).toBe(false);
    expect(
      rejectedPaths(IssueSourceRecordSchema, record({ factSummary: [{ text: "文です。", groundFactIds: ["fact-9"] }] })),
    ).toContain("factSummary.0.groundFactIds.0");
  });

  it("is the content only: the approval, the hash, the facts and the sources are not fields", () => {
    for (const field of ["approval", "issueHash", "basisFacts", "sources"]) {
      expect(IssueSourceRecordSchema.safeParse(record({ [field]: approval })).success, field).toBe(false);
    }
  });

  it("needs a version that is a positive whole number", () => {
    expect(IssueSourceRecordSchema.safeParse(record({ version: 0 })).success).toBe(false);
    expect(IssueSourceRecordSchema.safeParse(record({ version: 1.5 })).success).toBe(false);
    expect(IssueSourceRecordSchema.safeParse(record({ version: 3 })).success).toBe(true);
  });
});

describe("ApprovedIssueSchema: accepted values", () => {
  it("accepts an issue of fictional data and an issue of real data", () => {
    expect(ApprovedIssueSchema.safeParse(fixtureIssue()).success).toBe(true);
    expect(ApprovedIssueSchema.safeParse(realIssue()).success).toBe(true);
  });

  it("uses the contracts of the fact item and the source as they are: a derived fact is a fact", () => {
    const derived = realFact("fact-2", {
      method: { kind: "DERIVED", operation: "DIFFERENCE", operandFactIds: ["fact-3", "fact-4"], description: "差" },
    });
    const issue = realIssue({
      basisFacts: [realFact(), derived],
      factSummary: [{ text: "空き家は100戸です。", groundFactIds: ["fact-1", "fact-2"] }],
    });
    expect(ApprovedIssueSchema.safeParse(issue).success).toBe(true);
  });

  it("accepts the largest issue", () => {
    const facts = Array.from({ length: 10 }, (_, index) => fixtureFact(`fact-${index + 1}`));
    const issue = fixtureIssue({
      basisFacts: facts,
      factSummary: Array.from({ length: 4 }, (_, index) => ({ text: "架空市の空き家は100戸です。", groundFactIds: [`fact-${index + 1}`] })),
      background: Array.from({ length: 4 }, (_, index) => ({ text: "架空市の空き家は100戸です。", groundFactIds: [`fact-${index + 5}`] })),
      notDeterminable: ["a", "b", "c", "d", "e"],
      additionalChecks: ["a", "b", "c", "d", "e"],
      decisionScenes: ["a", "b", "c"],
      responseDirections: [direction(), direction(), direction(), direction()],
    });
    expect(ApprovedIssueSchema.safeParse(issue).success).toBe(true);
  });
});

describe("ApprovedIssueSchema: rejected values", () => {
  it("does not allow UNCLASSIFIED or a theme that is not one of the six", () => {
    expect(rejectedPaths(ApprovedIssueSchema, fixtureIssue({ themeId: "UNCLASSIFIED" }))).toContain("themeId");
    expect(ApprovedIssueSchema.safeParse(realIssue({ themeId: "OTHER" })).success).toBe(false);
  });

  it.each(["rank", "score", "priority", "recommendation", "superiority", "revision", "withdrawnAt"])(
    "does not have the field %s",
    (field) => {
      expect(ApprovedIssueSchema.safeParse(fixtureIssue({ [field]: 1 })).success).toBe(false);
      expect(ApprovedIssueSchema.safeParse(realIssue({ [field]: 1 })).success).toBe(false);
    },
  );

  it("needs the response directions to be for reference only", () => {
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ responseDirections: [direction({ status: "SELECTED" })] })).success).toBe(false);
  });

  it("needs a ground to be one of the facts of the issue, and a fact to be listed once", () => {
    expect(
      rejectedPaths(ApprovedIssueSchema, fixtureIssue({ factSummary: [{ text: "文です。", groundFactIds: ["fact-9"] }] })),
    ).toContain("factSummary.0.groundFactIds.0");
    expect(
      rejectedPaths(ApprovedIssueSchema, fixtureIssue({ background: [{ text: "文です。", groundFactIds: ["fact-9"] }] })),
    ).toContain("background.0.groundFactIds.0");
    expect(rejectedPaths(ApprovedIssueSchema, fixtureIssue({ basisFacts: [fixtureFact(), fixtureFact()] }))).toContain("basisFacts.1.factId");
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ basisFacts: [] })).success).toBe(false);
  });

  it("needs the source of a fact to be one of the sources of the issue", () => {
    expect(
      rejectedPaths(ApprovedIssueSchema, fixtureIssue({ basisFacts: [fixtureFact("fact-1", { fictionalSourceId: "src-9" })] })),
    ).toContain("basisFacts.0.fictionalSourceId");
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ basisFacts: [realFact("fact-1", { sha256: SHA_2 })] }))).toContain("basisFacts.0.sha256");
    expect(rejectedPaths(ApprovedIssueSchema, fixtureIssue({ sources: [{ dataKind: "FIXTURE", sourceId: "src-1" }, { dataKind: "FIXTURE", sourceId: "src-1" }] }))).toContain(
      "sources.1.sourceId",
    );
  });

  it("does not mix the data kinds of an issue, its facts and its sources", () => {
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ basisFacts: [realFact()] })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ sources: [realSource()] })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(realIssue({ basisFacts: [fixtureFact()] })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(realIssue({ sources: [{ dataKind: "FIXTURE", sourceId: "src-1" }] })).success).toBe(false);
  });

  it("needs every fact of real data to be VERIFIED", () => {
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ basisFacts: [realFact("fact-1", { verification: { status: "PROVISIONAL" } })] }))).toContain(
      "basisFacts.0.verification.status",
    );
  });

  it("needs every source of real data to have its terms CONFIRMED and to be allowed to be sent to an external AI", () => {
    const unknownUsage = { status: "UNKNOWN", checkedAt: "2026-02-01", checkedTarget: "利用規約", evidence: "規約の記載" };
    const restricted = { ...unknownUsage, status: "RESTRICTED" };
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ sources: [realSource({ usage: unknownUsage })] }))).toContain("sources.0.usage.status");
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ sources: [realSource({ usage: restricted })] }))).toContain("sources.0.usage.status");
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ sources: [realSource({ transmission: { status: "UNKNOWN" } })] }))).toContain(
      "sources.0.transmission.status",
    );
    const denied = { status: "DENIED", checkedBy: "a", checkedAt: "2026-02-01T00:00:00Z", evidence: "規約" };
    expect(rejectedPaths(ApprovedIssueSchema, realIssue({ sources: [realSource({ transmission: denied })] }))).toContain(
      "sources.0.transmission.status",
    );
  });

  it("needs the approval to be APPROVED with at least one approver, the hash and the AI draft class", () => {
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ approval: { status: "PENDING" } })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ approval: { ...approval, approverCount: 0 } })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ issueHash: undefined })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ issueHash: "xyz" })).success).toBe(false);
    const provenance = { ...(content()["provenance"] as Json), aiInvolvement: "HUMAN" };
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ provenance })).success).toBe(false);
  });

  it("limits the lengths: a title of 41, a statement of 61 and two sentences are rejected", () => {
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ title: "あ".repeat(41) })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ statement: "あ".repeat(61) })).success).toBe(false);
    expect(ApprovedIssueSchema.safeParse(fixtureIssue({ statement: "一つ目です。二つ目です。" })).success).toBe(false);
  });
});

describe("WithdrawnIssueSchema", () => {
  it("accepts the seven reasons, in the order of precedence", () => {
    expect([...WITHDRAWN_REASONS]).toEqual([
      "REVOKED",
      "CONTENT_CHANGED",
      "APPROVAL_INSUFFICIENT",
      "SOURCE_CHANGED",
      "FACT_UNVERIFIED",
      "USAGE_CHANGED",
      "CHECK_FAILED",
    ]);
    for (const reason of WITHDRAWN_REASONS) {
      expect(WithdrawnIssueSchema.safeParse({ issueId: "issue-1", version: 2, reason }).success, reason).toBe(true);
    }
  });

  it("rejects another reason, a date, and a version that is not positive", () => {
    expect(WithdrawnIssueSchema.safeParse({ issueId: "issue-1", version: 2, reason: "OTHER" }).success).toBe(false);
    expect(WithdrawnIssueSchema.safeParse({ issueId: "issue-1", version: 2, reason: "REVOKED", withdrawnAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(WithdrawnIssueSchema.safeParse({ issueId: "issue-1", version: 0, reason: "REVOKED" }).success).toBe(false);
  });
});

describe("IssuesFileSchema", () => {
  function coverageOf(issues: readonly Json[]): Json[] {
    return THEME_IDS.map((themeId) => ({ themeId, issueCount: issues.filter((issue) => issue["themeId"] === themeId).length }));
  }
  const file = (issues: Json[] = [fixtureIssue()], overrides: Json = {}): Json => ({
    meta: {
      schemaVersion: ISSUES_SCHEMA_VERSION,
      kind: "ISSUES",
      dataKind: "FIXTURE",
      generatedAt: "2026-01-04T09:00:00Z",
      inputDigest: SHA,
      contentHash: SHA_2,
    },
    issues,
    withdrawn: [],
    coverage: coverageOf(issues),
    ...overrides,
  });

  it("starts at the version 1, apart from the version of the question contracts", () => {
    expect(ISSUES_SCHEMA_VERSION).toBe(1);
  });

  it("accepts a file with issues, a file with withdrawn issues, and an empty file", () => {
    expect(IssuesFileSchema.safeParse(file()).success).toBe(true);
    expect(IssuesFileSchema.safeParse(file([], {})).success).toBe(true);
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { withdrawn: [{ issueId: "issue-2", version: 3, reason: "REVOKED" }] })).success).toBe(true);
  });

  it("accepts a file of real data", () => {
    const issues = [realIssue()];
    const real = file(issues, { meta: { ...(file()["meta"] as Json), dataKind: "REAL_AI" } });
    expect(IssuesFileSchema.safeParse(real).success).toBe(true);
  });

  it("does not mix fictional and real data", () => {
    expect(rejectedPaths(IssuesFileSchema, file([realIssue()]))).toContain("issues.0.dataKind");
    const mixed = file([fixtureIssue(), realIssue({ issueId: "issue-2" })]);
    expect(rejectedPaths(IssuesFileSchema, mixed)).toContain("issues.1.dataKind");
  });

  it("lists an issue once: not twice in the issues, and not also in the withdrawn issues", () => {
    expect(rejectedPaths(IssuesFileSchema, file([fixtureIssue(), fixtureIssue()]))).toContain("issues.1.issueId");
    expect(
      rejectedPaths(IssuesFileSchema, file([fixtureIssue()], { withdrawn: [{ issueId: "issue-1", version: 1, reason: "REVOKED" }] })),
    ).toContain("withdrawn.0.issueId");
    const twice = [
      { issueId: "issue-2", version: 1, reason: "REVOKED" },
      { issueId: "issue-2", version: 2, reason: "CHECK_FAILED" },
    ];
    expect(rejectedPaths(IssuesFileSchema, file([], { withdrawn: twice }))).toContain("withdrawn.1.issueId");
  });

  it("has the six themes in the order of their definition, with the number of issues of each", () => {
    const wrongCount = coverageOf([fixtureIssue()]).map((entry) => ({ ...entry, issueCount: 0 }));
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { coverage: wrongCount })).success).toBe(false);
    const reversed = [...coverageOf([])].reverse();
    expect(IssuesFileSchema.safeParse(file([], { coverage: reversed })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([], { coverage: coverageOf([]).slice(1) })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([], { coverage: [...coverageOf([]), { themeId: "TRANSPORT", issueCount: 0 }] })).success).toBe(false);
  });

  it("needs the meta: the version, the kind, the input digest and the content hash", () => {
    const meta = file()["meta"] as Json;
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { meta: { ...meta, schemaVersion: 2 } })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { meta: { ...meta, kind: "BUNDLE" } })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { meta: { ...meta, inputDigest: undefined } })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { meta: { ...meta, contentHash: "abc" } })).success).toBe(false);
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { meta: { ...meta, extra: 1 } })).success).toBe(false);
  });

  it("rejects an extra field of the file", () => {
    expect(IssuesFileSchema.safeParse(file([fixtureIssue()], { questions: [] })).success).toBe(false);
  });
});

describe("IssueLinksFileSchema", () => {
  const links = (list: Json[], overrides: Json = {}): Json => ({ schemaVersion: 1, dataKind: "FIXTURE", links: list, ...overrides });
  const link = (overrides: Json = {}): Json => ({ targetKind: "QUESTION", targetId: "q-1", issueId: "issue-1", issueVersion: 1, ...overrides });

  it("accepts the links of a question and of an issue card, and a target that names two issues", () => {
    expect(IssueLinksFileSchema.safeParse(links([link(), link({ targetKind: "ISSUE_CARD", targetId: "card-1" })])).success).toBe(true);
    expect(IssueLinksFileSchema.safeParse(links([link(), link({ issueId: "issue-2" })])).success).toBe(true);
    expect(IssueLinksFileSchema.safeParse(links([])).success).toBe(true);
  });

  it("does not let a target name the same issue twice", () => {
    expect(rejectedPaths(IssueLinksFileSchema, links([link(), link({ issueVersion: 2 })]))).toContain("links.1");
  });

  it("rejects another kind of target and a version that is not positive", () => {
    expect(IssueLinksFileSchema.safeParse(links([link({ targetKind: "CARD" })])).success).toBe(false);
    expect(IssueLinksFileSchema.safeParse(links([link({ issueVersion: 0 })])).success).toBe(false);
    expect(IssueLinksFileSchema.safeParse(links([link()], { schemaVersion: 2 })).success).toBe(false);
    expect(IssueLinksFileSchema.safeParse(links([link({ extra: 1 })])).success).toBe(false);
  });
});

describe("IssuesExportReportSchema", () => {
  const output = (overrides: Json = {}): Json => ({
    fileSha256: SHA,
    contentHash: SHA_2,
    inputDigest: SHA_3,
    generatedAt: "2026-01-04T09:00:00Z",
    issuesSchemaVersion: 1,
    issueCount: 3,
    withdrawnCount: 1,
    ...overrides,
  });
  const lastSuccess: Json = { fileSha256: SHA_2, contentHash: SHA_3, inputDigest: SHA, generatedAt: "2026-01-03T09:00:00Z" };
  const report = (overrides: Json = {}): Json => ({
    schemaVersion: 1,
    kind: "ISSUES_EXPORT_REPORT",
    dataKind: "REAL_AI",
    status: "SUCCESS",
    startedAt: "2026-01-04T09:00:00Z",
    finishedAt: "2026-01-04T09:00:05Z",
    exitCode: 0,
    failureCode: null,
    inputDigest: SHA_3,
    invalidated: null,
    output: output(),
    lastSuccess,
    ...overrides,
  });
  const running = (overrides: Json = {}): Json =>
    report({ status: "RUNNING", finishedAt: null, exitCode: null, inputDigest: null, output: null, ...overrides });
  const failed = (overrides: Json = {}): Json =>
    report({ status: "FAILED", exitCode: 1, failureCode: "WRITE_FAILED", output: null, ...overrides });

  it("accepts a state of each of the three statuses", () => {
    expect(IssuesExportReportSchema.safeParse(report()).success).toBe(true);
    expect(IssuesExportReportSchema.safeParse(running()).success).toBe(true);
    expect(IssuesExportReportSchema.safeParse(failed()).success).toBe(true);
  });

  it("keeps the last success in every state, and the old file that a run made invalid", () => {
    const invalidated = { fileSha256: SHA_2, contentHash: SHA_3, deleted: false };
    expect(IssuesExportReportSchema.safeParse(running({ lastSuccess, invalidated })).success).toBe(true);
    expect(IssuesExportReportSchema.safeParse(failed({ lastSuccess, invalidated, failureCode: "DELETE_FAILED" })).success).toBe(true);
    expect(IssuesExportReportSchema.safeParse(report({ lastSuccess: null })).success).toBe(true);
  });

  it("keeps the input of a run that failed", () => {
    expect(IssuesExportReportSchema.safeParse(failed({ inputDigest: SHA_3, failureCode: "CONTRACT_INVALID" })).success).toBe(true);
    expect(IssuesExportReportSchema.safeParse(failed({ inputDigest: null, failureCode: "INPUT_UNREADABLE" })).success).toBe(true);
  });

  it("does not let SUCCESS lack the output, have a failure code, or have another exit code", () => {
    expect(rejectedPaths(IssuesExportReportSchema, report({ output: null }))).toContain("output");
    expect(rejectedPaths(IssuesExportReportSchema, report({ failureCode: "WRITE_FAILED" }))).toContain("failureCode");
    expect(rejectedPaths(IssuesExportReportSchema, report({ exitCode: 1 }))).toContain("exitCode");
    expect(rejectedPaths(IssuesExportReportSchema, report({ finishedAt: null }))).toContain("finishedAt");
  });

  it("needs the input of a successful run to be the input of its output", () => {
    expect(rejectedPaths(IssuesExportReportSchema, report({ inputDigest: SHA }))).toContain("inputDigest");
    expect(rejectedPaths(IssuesExportReportSchema, report({ inputDigest: null }))).toContain("inputDigest");
  });

  it("does not let FAILED lack the failure code, have an output, or have another exit code", () => {
    expect(rejectedPaths(IssuesExportReportSchema, failed({ failureCode: null }))).toContain("failureCode");
    expect(rejectedPaths(IssuesExportReportSchema, failed({ output: output() }))).toContain("output");
    expect(rejectedPaths(IssuesExportReportSchema, failed({ exitCode: 0 }))).toContain("exitCode");
    expect(rejectedPaths(IssuesExportReportSchema, failed({ finishedAt: null }))).toContain("finishedAt");
    expect(IssuesExportReportSchema.safeParse(failed({ failureCode: "OTHER" })).success).toBe(false);
  });

  it("does not let RUNNING have an exit code, a failure code, an output, or a time it finished", () => {
    expect(rejectedPaths(IssuesExportReportSchema, running({ exitCode: 0 }))).toContain("exitCode");
    expect(rejectedPaths(IssuesExportReportSchema, running({ failureCode: "WRITE_FAILED" }))).toContain("failureCode");
    expect(rejectedPaths(IssuesExportReportSchema, running({ output: output() }))).toContain("output");
    expect(rejectedPaths(IssuesExportReportSchema, running({ finishedAt: "2026-01-04T09:00:05Z" }))).toContain("finishedAt");
  });

  it("needs the version of the contract of the file in the output", () => {
    expect(IssuesExportReportSchema.safeParse(report({ output: output({ issuesSchemaVersion: undefined }) })).success).toBe(false);
    expect(IssuesExportReportSchema.safeParse(report({ output: output({ issuesSchemaVersion: 0 }) })).success).toBe(false);
  });

  it("does not finish before it started, and has no text of an issue", () => {
    expect(rejectedPaths(IssuesExportReportSchema, report({ finishedAt: "2026-01-04T08:59:59Z" }))).toContain("finishedAt");
    expect(IssuesExportReportSchema.safeParse(report({ issues: [] })).success).toBe(false);
    expect(IssuesExportReportSchema.safeParse(report({ output: output({ issues: [] }) })).success).toBe(false);
  });
});

describe("IssuesReceiptSchema", () => {
  const receipt = (overrides: Json = {}): Json => ({
    schemaVersion: 1,
    kind: "ISSUES_RECEIPT",
    dataKind: "REAL_AI",
    issuesSchemaVersion: 1,
    generatedAt: "2026-01-04T09:00:00Z",
    fileSha256: SHA,
    contentHash: SHA_2,
    inputDigest: SHA_3,
    issueCount: 3,
    withdrawnCount: 0,
    deliveredBy: "analyst-1",
    receivedBy: "developer-1",
    receivedAt: "2026-01-05T09:00:00Z",
    attestation: "SELF_REPORTED",
    ...overrides,
  });

  it("accepts a receipt of a file of real data", () => {
    expect(IssuesReceiptSchema.safeParse(receipt()).success).toBe(true);
  });

  it("is for real data only: a file of fictional data is handed over in Git and has no receipt", () => {
    expect(IssuesReceiptSchema.safeParse(receipt({ dataKind: "FIXTURE" })).success).toBe(false);
  });

  it("says that the persons and the time are self-reported", () => {
    expect(IssuesReceiptSchema.safeParse(receipt({ attestation: undefined })).success).toBe(false);
    expect(IssuesReceiptSchema.safeParse(receipt({ attestation: "VERIFIED" })).success).toBe(false);
  });

  it("has no text of an issue: an issue, a list of issues or a title is not a field", () => {
    for (const field of ["issues", "withdrawn", "title", "approvedIssues"]) {
      expect(IssuesReceiptSchema.safeParse(receipt({ [field]: [] })).success, field).toBe(false);
    }
  });

  it("needs what the receiver checks: the SHA-256 of the file, the content hash, the input digest, the time and the version", () => {
    for (const field of ["fileSha256", "contentHash", "inputDigest", "generatedAt", "issuesSchemaVersion", "deliveredBy", "receivedBy", "receivedAt"]) {
      expect(IssuesReceiptSchema.safeParse(receipt({ [field]: undefined })).success, field).toBe(false);
    }
    expect(IssuesReceiptSchema.safeParse(receipt({ fileSha256: "ABC" })).success).toBe(false);
    expect(IssuesReceiptSchema.safeParse(receipt({ issuesSchemaVersion: 0 })).success).toBe(false);
    expect(IssuesReceiptSchema.safeParse(receipt({ deliveredBy: "" })).success).toBe(false);
    expect(IssuesReceiptSchema.safeParse(receipt({ receivedAt: "yesterday" })).success).toBe(false);
    expect(IssuesReceiptSchema.safeParse(receipt({ issueCount: -1 })).success).toBe(false);
  });
});
