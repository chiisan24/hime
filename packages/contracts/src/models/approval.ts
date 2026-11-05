import { z } from "zod";

import { ModelIdsSchema, PromptVersionsSchema } from "./artifacts.js";
import { StructuredPolicySchema } from "./policy.js";
import {
  ArtifactIdSchema,
  CandidateIdSchema,
  ElectionIdSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  Sha256Schema,
  SourceIdSchema,
} from "./primitives.js";

const DecisionReasonSchema = NonEmptyStringSchema.refine(
  (value) => Array.from(value).length <= 500,
  "Must contain no more than 500 Unicode code points",
);

export const ApprovalSnapshotSchema = z
  .object({
    electionId: ElectionIdSchema,
    candidateId: CandidateIdSchema,
    sourceId: SourceIdSchema,
    sourceChecksum: Sha256Schema,
    revision: RevisionSchema,
    structured: StructuredPolicySchema,
    beginnerSummary: NonEmptyStringSchema.refine(
      (value) => Array.from(value).length <= 300,
      "Must contain no more than 300 Unicode code points",
    ),
    promptVersions: PromptVersionsSchema,
    modelIds: ModelIdsSchema,
    artifactContentHash: Sha256Schema,
    automaticStatus: z.literal("PASS"),
  })
  .strict();

export const ApprovalRecordSchema = z
  .object({
    decision: z.literal("APPROVED"),
    approvalId: NonEmptyStringSchema,
    artifactId: ArtifactIdSchema,
    approverId: NonEmptyStringSchema,
    decidedAt: ISOInstantSchema,
    reason: DecisionReasonSchema,
    snapshot: ApprovalSnapshotSchema,
    approvalSnapshotHash: Sha256Schema,
    previousRecordHash: Sha256Schema.nullable(),
  })
  .strict();

export const RejectionRecordSchema = z
  .object({
    decision: z.literal("REJECTED"),
    rejectionId: NonEmptyStringSchema,
    artifactId: ArtifactIdSchema,
    approverId: NonEmptyStringSchema,
    decidedAt: ISOInstantSchema,
    reason: DecisionReasonSchema,
    sourceChecksum: Sha256Schema,
    revision: RevisionSchema,
    previousRecordHash: Sha256Schema.nullable(),
  })
  .strict();

export const HumanDecisionSchema = z.discriminatedUnion("decision", [
  ApprovalRecordSchema,
  RejectionRecordSchema,
]);

export type ApprovalSnapshot = z.infer<typeof ApprovalSnapshotSchema>;
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export type RejectionRecord = z.infer<typeof RejectionRecordSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
