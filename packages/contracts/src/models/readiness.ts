import { z } from "zod";

import {
  ArtifactIdSchema,
  CandidateIdSchema,
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  ReadinessStatusSchema,
  RevisionSchema,
  SourceIdSchema,
  UsageStatusSchema,
} from "./primitives.js";

export const ReadinessIssueSchema = z
  .object({
    candidateId: CandidateIdSchema.nullable(),
    sourceId: SourceIdSchema.nullable(),
    revision: RevisionSchema.nullable(),
    code: NonEmptyStringSchema,
    fieldPaths: z.array(NonEmptyStringSchema).readonly(),
    safeMessage: NonEmptyStringSchema,
  })
  .strict();

export const ReadinessMaterialSchema = z
  .object({
    sourceId: SourceIdSchema,
    revision: RevisionSchema,
    title: NonEmptyStringSchema,
    sourceType: NonEmptyStringSchema,
    publishedAt: ISODateSchema,
    retrievedAt: ISODateSchema,
    usageStatus: UsageStatusSchema,
    electionMatch: z.boolean(),
  })
  .strict();

export const CandidateMaterialSummarySchema = z
  .object({
    candidateId: CandidateIdSchema,
    materials: z.array(ReadinessMaterialSchema).readonly(),
  })
  .strict();

export const ReadinessReportSchema = z
  .object({
    status: ReadinessStatusSchema,
    evaluatedAt: ISOInstantSchema,
    adoptionRuleVersion: NonEmptyStringSchema,
    candidateMaterialSummary: z
      .array(CandidateMaterialSummarySchema)
      .readonly(),
    issues: z.array(ReadinessIssueSchema).readonly(),
  })
  .strict();

export const PublicationDecisionSchema = z
  .object({
    publishable: z.boolean(),
    artifactId: ArtifactIdSchema,
    snapshotMatched: z.boolean(),
    reasons: z.array(NonEmptyStringSchema).readonly(),
  })
  .strict();

export const MaterialVolumeSchema = z
  .object({
    adoptedSourceCount: z.number().int().nonnegative(),
    extractedCodePointCount: z.number().int().nonnegative(),
    verifiedPolicyUnitCount: z.number().int().nonnegative(),
  })
  .strict();

export type ReadinessIssue = z.infer<typeof ReadinessIssueSchema>;
export type ReadinessMaterial = z.infer<typeof ReadinessMaterialSchema>;
export type CandidateMaterialSummary = z.infer<
  typeof CandidateMaterialSummarySchema
>;
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;
export type PublicationDecision = z.infer<typeof PublicationDecisionSchema>;
export type MaterialVolume = z.infer<typeof MaterialVolumeSchema>;
