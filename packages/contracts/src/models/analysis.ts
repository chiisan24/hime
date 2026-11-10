import { z } from "zod";

import {
  CandidateIdSchema,
  ElectionIdSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  RunIdSchema,
  Sha256Schema,
  SourceIdSchema,
} from "./primitives.js";
import { UrlSourceReferenceSchema } from "./sources.js";

/**
 * Contracts for the source-agnostic ingest and the staged AI analysis.
 *
 * They sit next to the existing Source Manifest contracts and reuse its
 * primitives. An ingest record is immutable per revision; its analysis and
 * approval progress are derived from stage runs and human decisions instead of
 * being rewritten into the record.
 */

export const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const REVISION_PATTERN = /^r[1-9][0-9]*$/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const MAX_OFFICIAL_URL_LENGTH = 2048;

/** 1 to 64 lowercase letters, digits or hyphens; no reserved device names. */
export function isValidIngestSourceId(value: string): boolean {
  return SOURCE_ID_PATTERN.test(value) && !WINDOWS_RESERVED_NAME.test(value);
}

/** An https URL without credentials, whitespace or an excessive length. */
export function isValidOfficialUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_OFFICIAL_URL_LENGTH) {
    return false;
  }
  if (/\s/u.test(value)) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.hostname !== ""
  );
}

/** Path of a raw document below `data/real/raw`, derived from its SHA-256. */
export function rawObjectRelativePath(sha256: string): string {
  return `objects/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.pdf`;
}

export const IngestSourceIdSchema = SourceIdSchema.refine(
  isValidIngestSourceId,
  "Must be 1 to 64 lowercase letters, digits or hyphens and not a reserved name",
);
export const IngestRevisionSchema = RevisionSchema.refine(
  (value) => REVISION_PATTERN.test(value),
  "Must look like r1, r2, ...",
);
export const OfficialUrlSchema = UrlSourceReferenceSchema.shape.url.refine(
  isValidOfficialUrl,
  "Must be an https URL without credentials",
);

export const ASSIGNMENT_STATES = ["ASSIGNED", "SHARED", "UNASSIGNED"] as const;

export const AssignedAssignmentSchema = z
  .object({
    state: z.literal("ASSIGNED"),
    candidateId: CandidateIdSchema,
  })
  .strict();
export const SharedAssignmentSchema = z
  .object({ state: z.literal("SHARED") })
  .strict();
export const UnassignedAssignmentSchema = z
  .object({ state: z.literal("UNASSIGNED") })
  .strict();

/** How a document relates to candidates; never guessed. */
export const AssignmentSchema = z.discriminatedUnion("state", [
  AssignedAssignmentSchema,
  SharedAssignmentSchema,
  UnassignedAssignmentSchema,
]);
/** A single passage is either tied to one candidate or left unassigned. */
export const PassageAssignmentSchema = z.discriminatedUnion("state", [
  AssignedAssignmentSchema,
  UnassignedAssignmentSchema,
]);

export const ANALYSIS_STATUSES = [
  "NOT_ANALYZED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "NOT_READY",
] as const;
export const AnalysisStatusSchema = z.enum(ANALYSIS_STATUSES);

/** One immutable record per source revision. No supplier kind or ingest time. */
export const IngestRecordSchema = z
  .object({
    sourceId: IngestSourceIdSchema,
    electionId: ElectionIdSchema,
    revision: IngestRevisionSchema,
    assignment: AssignmentSchema,
    officialUrl: OfficialUrlSchema,
    retrievedAt: ISOInstantSchema,
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
    /** Relative to `data/real/raw`. */
    rawSnapshotRelativePath: NonEmptyStringSchema,
    analysisStatus: z.literal("NOT_ANALYZED"),
    approvalStatus: z.literal("PENDING"),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.rawSnapshotRelativePath !== rawObjectRelativePath(record.sha256)) {
      context.addIssue({
        code: "custom",
        message: "rawSnapshotRelativePath must be derived from the SHA-256",
        path: ["rawSnapshotRelativePath"],
      });
    }
  });

export const PassageEvidenceSchema = z
  .object({
    nameForm: NonEmptyStringSchema,
    page: z.number().int().positive(),
  })
  .strict();

export const PassageSchema = z
  .object({
    passageId: NonEmptyStringSchema,
    page: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    text: NonEmptyStringSchema,
    textSha256: Sha256Schema,
    assignment: PassageAssignmentSchema,
    evidence: PassageEvidenceSchema.nullable(),
  })
  .strict()
  .superRefine((passage, context) => {
    if (passage.charEnd <= passage.charStart) {
      context.addIssue({
        code: "custom",
        message: "charEnd must be greater than charStart",
        path: ["charEnd"],
      });
    }
    if (passage.assignment.state === "ASSIGNED" && passage.evidence === null) {
      context.addIssue({
        code: "custom",
        message: "An assigned passage needs name evidence",
        path: ["evidence"],
      });
    }
    if (passage.assignment.state === "UNASSIGNED" && passage.evidence !== null) {
      context.addIssue({
        code: "custom",
        message: "An unassigned passage must not carry name evidence",
        path: ["evidence"],
      });
    }
    if (passage.evidence !== null && passage.evidence.page !== passage.page) {
      context.addIssue({
        code: "custom",
        message: "The evidence must come from the passage page",
        path: ["evidence", "page"],
      });
    }
  });

export const NOT_READY_REASONS = [
  "PDF_CORRUPT",
  "PDF_ENCRYPTED",
  "PDF_NO_PAGES",
  "PDF_TOO_LARGE",
  "PDF_TOO_MANY_PAGES",
  "ALL_PAGES_IMAGE",
] as const;
export const NotReadyReasonSchema = z.enum(NOT_READY_REASONS);

export const ExtractedPageSchema = z
  .object({
    page: z.number().int().positive(),
    text: z.string(),
  })
  .strict();

export const ExtractionOutputSchema = z
  .object({
    pageCount: z.number().int().nonnegative(),
    imagePages: z.array(z.number().int().positive()),
    pages: z.array(ExtractedPageSchema),
    passages: z.array(PassageSchema),
    notReady: NotReadyReasonSchema.nullable(),
  })
  .strict()
  .superRefine((output, context) => {
    if (
      output.notReady !== null &&
      (output.pages.length > 0 || output.passages.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "A not-ready extraction must not keep pages or passages",
        path: ["notReady"],
      });
    }
    if (output.imagePages.some((page) => page > output.pageCount)) {
      context.addIssue({
        code: "custom",
        message: "An image page is outside the page count",
        path: ["imagePages"],
      });
    }
    if (output.pages.length > output.pageCount) {
      context.addIssue({
        code: "custom",
        message: "There are more pages than the page count",
        path: ["pages"],
      });
    }
    if (output.passages.some((passage) => passage.page > output.pageCount)) {
      context.addIssue({
        code: "custom",
        message: "A passage is outside the page count",
        path: ["passages"],
      });
    }
  });

export const ANALYSIS_STAGES = [
  "EXTRACT",
  "CLASSIFY",
  "SUMMARISE",
  "VERIFY",
  "GROUND",
  "JUDGE",
] as const;
export const AnalysisStageSchema = z.enum(ANALYSIS_STAGES);

export const STAGE_RUN_SCOPES = ["PILOT", "FULL", "STAGE"] as const;
export const STAGE_RUN_STATUSES = ["SUCCEEDED", "FAILED"] as const;

export const StageRunKeySchema = z
  .object({
    sourceSha256: Sha256Schema,
    revision: IngestRevisionSchema,
    stage: AnalysisStageSchema,
    modelId: z.string().min(1).nullable(),
    inputHash: Sha256Schema,
  })
  .strict();

/** Stored result of one stage execution; input and output are re-validated per stage. */
export const StageRunSchema = z
  .object({
    stageRunId: Sha256Schema,
    key: StageRunKeySchema,
    runId: RunIdSchema,
    scope: z.enum(STAGE_RUN_SCOPES),
    passageId: NonEmptyStringSchema.nullable(),
    status: z.enum(STAGE_RUN_STATUSES),
    input: z.unknown(),
    output: z.unknown().nullable(),
    errorClass: NonEmptyStringSchema.nullable(),
    createdAt: ISOInstantSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (run.status === "SUCCEEDED" && (run.output === null || run.output === undefined || run.errorClass !== null)) {
      context.addIssue({
        code: "custom",
        message: "A succeeded run needs an output and no error class",
        path: ["status"],
      });
    }
    if (run.status === "FAILED" && (run.output !== null || run.errorClass === null)) {
      context.addIssue({
        code: "custom",
        message: "A failed run needs an error class and no output",
        path: ["status"],
      });
    }
  });

export type Assignment = z.infer<typeof AssignmentSchema>;
export type PassageAssignment = z.infer<typeof PassageAssignmentSchema>;
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;
export type IngestRecord = z.infer<typeof IngestRecordSchema>;
export type Passage = z.infer<typeof PassageSchema>;
export type NotReadyReason = z.infer<typeof NotReadyReasonSchema>;
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
export type AnalysisStage = z.infer<typeof AnalysisStageSchema>;
export type StageRunKey = z.infer<typeof StageRunKeySchema>;
export type StageRun = z.infer<typeof StageRunSchema>;