import { describe, expect, it } from "vitest";

import * as contracts from "../index.js";
import {
  ANALYSIS_STAGES,
  ANALYSIS_STATUSES,
  ASSIGNMENT_STATES,
  AssignmentSchema,
  ExtractionOutputSchema,
  IngestRecordSchema,
  PassageSchema,
  StageRunSchema,
  isValidIngestSourceId,
  isValidOfficialUrl,
  rawObjectRelativePath,
} from "./analysis.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function ingestRecord(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "bulletin-a",
    electionId: "test-election-a",
    revision: "r1",
    assignment: { state: "UNASSIGNED" },
    officialUrl: "https://example.test/official/bulletin.pdf",
    retrievedAt: "2026-11-08T03:04:05.000Z",
    sha256: SHA_A,
    byteLength: 1024,
    rawSnapshotRelativePath: rawObjectRelativePath(SHA_A),
    analysisStatus: "NOT_ANALYZED",
    approvalStatus: "PENDING",
    ...overrides,
  };
}

function passage(overrides: Record<string, unknown> = {}) {
  return {
    passageId: "bulletin-a:r1:p1:0",
    page: 1,
    index: 0,
    charStart: 0,
    charEnd: 10,
    text: "placeholder passage text",
    textSha256: SHA_A,
    assignment: { state: "UNASSIGNED" },
    evidence: null,
    ...overrides,
  };
}

describe("constants and helpers", () => {
  it("lists the documented states and stages", () => {
    expect(ASSIGNMENT_STATES).toEqual(["ASSIGNED", "SHARED", "UNASSIGNED"]);
    expect(ANALYSIS_STATUSES).toEqual(["NOT_ANALYZED", "IN_PROGRESS", "COMPLETED", "FAILED", "NOT_READY"]);
    expect(ANALYSIS_STAGES).toEqual(["EXTRACT", "CLASSIFY", "SUMMARISE", "VERIFY", "GROUND", "JUDGE"]);
  });

  it("derives the raw object path from the SHA-256", () => {
    expect(rawObjectRelativePath(SHA_A)).toBe(`objects/aa/aa/${SHA_A}.pdf`);
  });

  it.each(["a", "bulletin-a", "a".repeat(64), "0abc", "a-b-c"])("accepts the source ID %s", (value) => {
    expect(isValidIngestSourceId(value)).toBe(true);
  });

  it.each(["", "A", "-a", "a_b", "a.b", "a b", "a".repeat(65), "con", "nul", "com1", "lpt9", "選挙"])(
    "rejects the source ID %j",
    (value) => {
      expect(isValidIngestSourceId(value)).toBe(false);
    },
  );

  it("accepts only https URLs without credentials", () => {
    expect(isValidOfficialUrl("https://example.test/a/b.pdf?x=1")).toBe(true);
    for (const value of ["", "http://example.test/a", "ftp://example.test/a", "https://user:pw@example.test/a", "https://user@example.test/a", "https://example.test/a b", "not a url", `https://example.test/${"a".repeat(2100)}`]) {
      expect(isValidOfficialUrl(value)).toBe(false);
    }
  });

  it("is exported from the package entry", () => {
    expect(contracts.IngestRecordSchema).toBe(IngestRecordSchema);
    expect(contracts.AssignmentSchema).toBe(AssignmentSchema);
    expect(contracts.StageRunSchema).toBe(StageRunSchema);
  });
});

describe("AssignmentSchema", () => {
  it("accepts the three states and rejects stray keys", () => {
    expect(AssignmentSchema.safeParse({ state: "ASSIGNED", candidateId: "candidate-a" }).success).toBe(true);
    expect(AssignmentSchema.safeParse({ state: "SHARED" }).success).toBe(true);
    expect(AssignmentSchema.safeParse({ state: "UNASSIGNED" }).success).toBe(true);
    expect(AssignmentSchema.safeParse({ state: "ASSIGNED" }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ state: "SHARED", candidateId: "candidate-a" }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ state: "UNASSIGNED", candidateId: "candidate-a" }).success).toBe(false);
    expect(AssignmentSchema.safeParse({ state: "OTHER" }).success).toBe(false);
  });
});

describe("IngestRecordSchema", () => {
  it("accepts a valid record for each assignment", () => {
    expect(IngestRecordSchema.safeParse(ingestRecord()).success).toBe(true);
    expect(IngestRecordSchema.safeParse(ingestRecord({ assignment: { state: "SHARED" } })).success).toBe(true);
    expect(
      IngestRecordSchema.safeParse(ingestRecord({ assignment: { state: "ASSIGNED", candidateId: "candidate-a" } })).success,
    ).toBe(true);
  });

  it.each([
    ["an extra key", { supplierKind: "manual" }],
    ["a revision without the r prefix", { revision: "1" }],
    ["revision r0", { revision: "r0" }],
    ["an uppercase source ID", { sourceId: "Bulletin" }],
    ["a bad SHA-256", { sha256: "XYZ" }],
    ["an uppercase SHA-256", { sha256: "A".repeat(64) }],
    ["a raw path that does not match the hash", { rawSnapshotRelativePath: rawObjectRelativePath(SHA_B) }],
    ["a raw path outside objects", { rawSnapshotRelativePath: "koho.pdf" }],
    ["an http URL", { officialUrl: "http://example.test/a.pdf" }],
    ["a URL with credentials", { officialUrl: "https://u:p@example.test/a.pdf" }],
    ["a retrieval time without a timezone", { retrievedAt: "2026-11-08T03:04:05" }],
    ["a date instead of an instant", { retrievedAt: "2026-11-08" }],
    ["a zero byte length", { byteLength: 0 }],
    ["an analysis status other than NOT_ANALYZED", { analysisStatus: "COMPLETED" }],
    ["an approval status other than PENDING", { approvalStatus: "APPROVED" }],
  ])("rejects %s", (_label, overrides) => {
    expect(IngestRecordSchema.safeParse(ingestRecord(overrides)).success).toBe(false);
  });

  it("accepts an offset timezone", () => {
    expect(IngestRecordSchema.safeParse(ingestRecord({ retrievedAt: "2026-11-08T12:04:05+09:00" })).success).toBe(true);
  });
});

describe("PassageSchema", () => {
  it("accepts an unassigned passage and an assigned passage with evidence", () => {
    expect(PassageSchema.safeParse(passage()).success).toBe(true);
    expect(
      PassageSchema.safeParse(
        passage({
          assignment: { state: "ASSIGNED", candidateId: "candidate-a" },
          evidence: { nameForm: "Test Candidate A", page: 1 },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["a SHARED passage", { assignment: { state: "SHARED" } }],
    ["an assigned passage without evidence", { assignment: { state: "ASSIGNED", candidateId: "candidate-a" } }],
    ["an unassigned passage with evidence", { evidence: { nameForm: "x", page: 1 } }],
    ["evidence from another page", { assignment: { state: "ASSIGNED", candidateId: "candidate-a" }, evidence: { nameForm: "x", page: 2 } }],
    ["an empty range", { charStart: 5, charEnd: 5 }],
    ["page zero", { page: 0 }],
    ["blank text", { text: "   " }],
  ])("rejects %s", (_label, overrides) => {
    expect(PassageSchema.safeParse(passage(overrides)).success).toBe(false);
  });
});

describe("ExtractionOutputSchema", () => {
  const output = (overrides: Record<string, unknown> = {}) => ({
    pageCount: 2,
    imagePages: [2],
    pages: [{ page: 1, text: "placeholder" }],
    passages: [passage()],
    notReady: null,
    ...overrides,
  });

  it("accepts a normal extraction and a not-ready extraction without content", () => {
    expect(ExtractionOutputSchema.safeParse(output()).success).toBe(true);
    expect(
      ExtractionOutputSchema.safeParse({ pageCount: 3, imagePages: [1, 2, 3], pages: [], passages: [], notReady: "ALL_PAGES_IMAGE" }).success,
    ).toBe(true);
    expect(
      ExtractionOutputSchema.safeParse({ pageCount: 0, imagePages: [], pages: [], passages: [], notReady: "PDF_NO_PAGES" }).success,
    ).toBe(true);
  });

  it.each([
    ["a not-ready extraction that keeps passages", { notReady: "ALL_PAGES_IMAGE" }],
    ["an unknown not-ready reason", { notReady: "OTHER" }],
    ["an image page beyond the page count", { imagePages: [3] }],
    ["more pages than the page count", { pageCount: 0, imagePages: [], passages: [] }],
    ["a passage beyond the page count", { pageCount: 1, imagePages: [], passages: [passage({ page: 2 })] }],
  ])("rejects %s", (_label, overrides) => {
    expect(ExtractionOutputSchema.safeParse(output(overrides)).success).toBe(false);
  });
});

describe("StageRunSchema", () => {
  const run = (overrides: Record<string, unknown> = {}) => ({
    stageRunId: SHA_A,
    key: { sourceSha256: SHA_A, revision: "r1", stage: "CLASSIFY", modelId: "jp.anthropic.claude-haiku-5-5", inputHash: SHA_B },
    runId: "run-1",
    scope: "PILOT",
    passageId: "bulletin-a:r1:p1:0",
    status: "SUCCEEDED",
    input: { any: "value" },
    output: { theme: "x" },
    errorClass: null,
    createdAt: "2026-11-08T03:04:05.000Z",
    ...overrides,
  });

  it("accepts a succeeded run, a failed run and a model-free stage", () => {
    expect(StageRunSchema.safeParse(run()).success).toBe(true);
    expect(StageRunSchema.safeParse(run({ status: "FAILED", output: null, errorClass: "HTTP_ERROR" })).success).toBe(true);
    expect(
      StageRunSchema.safeParse(
        run({ key: { sourceSha256: SHA_A, revision: "r1", stage: "EXTRACT", modelId: null, inputHash: SHA_B }, passageId: null, scope: "STAGE" }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["a succeeded run without output", { output: null }],
    ["a succeeded run with an error class", { errorClass: "X" }],
    ["a failed run with output", { status: "FAILED", errorClass: "X" }],
    ["a failed run without an error class", { status: "FAILED", output: null }],
    ["an unknown stage", { key: { sourceSha256: SHA_A, revision: "r1", stage: "OTHER", modelId: null, inputHash: SHA_B } }],
    ["an unknown scope", { scope: "ALL" }],
    ["a bad run ID hash", { stageRunId: "nope" }],
    ["an extra key", { prompt: "secret" }],
  ])("rejects %s", (_label, overrides) => {
    expect(StageRunSchema.safeParse(run(overrides)).success).toBe(false);
  });
});