import { z } from "zod";

import {
  CandidateIdSchema,
  ElectionIdSchema,
  ISODateSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
  RevisionSchema,
  Sha256Schema,
  SourceIdSchema,
  UsageStatusSchema,
} from "./primitives.js";

export const PdfPageLocatorSchema = z
  .object({
    kind: z.literal("pdf-page"),
    page: z.number().int().positive(),
  })
  .strict();

export const HtmlParagraphLocatorSchema = z
  .object({
    kind: z.literal("html-paragraph"),
    headings: z.array(NonEmptyStringSchema).readonly(),
    paragraph: z.number().int().positive(),
  })
  .strict();

export const TextLinesLocatorSchema = z
  .object({
    kind: z.literal("text-lines"),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .refine(({ startLine, endLine }) => endLine >= startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });

export const LocatorSchema = z.discriminatedUnion("kind", [
  PdfPageLocatorSchema,
  HtmlParagraphLocatorSchema,
  TextLinesLocatorSchema,
]);

export const UsageReviewSchema = z
  .object({
    status: UsageStatusSchema,
    checkedAt: ISODateSchema,
    checkedTarget: NonEmptyStringSchema,
    evidence: NonEmptyStringSchema,
  })
  .strict();

export const UrlSourceReferenceSchema = z
  .object({
    kind: z.literal("url"),
    url: z.string().url(),
  })
  .strict();

export const LocalFileSourceReferenceSchema = z
  .object({
    kind: z.literal("local-file"),
    relativePath: NonEmptyStringSchema,
  })
  .strict();

export const SourceReferenceSchema = z.discriminatedUnion("kind", [
  UrlSourceReferenceSchema,
  LocalFileSourceReferenceSchema,
]);

export const SOURCE_TYPES = [
  "election-bulletin",
  "candidate-policy",
  "party-policy",
  "official-result",
  "official-order",
  "ocr-derivative",
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);

export const ADOPTION_DECISIONS = ["ADOPTED", "EXCLUDED"] as const;
export const AdoptionDecisionSchema = z.enum(ADOPTION_DECISIONS);

export const OcrHumanReviewSchema = z
  .object({
    reviewerId: NonEmptyStringSchema,
    reviewedAt: ISOInstantSchema,
    matchedOriginal: z.literal(true),
    originalSourceId: SourceIdSchema,
    originalRevision: RevisionSchema,
  })
  .strict();

export const SourceManifestRecordSchema = z
  .object({
    dataKind: RealAiDataKindSchema,
    sourceId: SourceIdSchema,
    revision: RevisionSchema,
    electionId: ElectionIdSchema,
    candidateId: CandidateIdSchema.nullable(),
    issuer: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    sourceType: SourceTypeSchema,
    reference: SourceReferenceSchema,
    rawSnapshotRelativePath: NonEmptyStringSchema,
    publishedAt: ISODateSchema,
    retrievedAt: ISODateSchema,
    usage: UsageReviewSchema,
    sourceChecksum: Sha256Schema,
    electionCorrespondenceEvidence: NonEmptyStringSchema,
    adoptionRuleVersion: NonEmptyStringSchema,
    adoptionDecision: AdoptionDecisionSchema,
    adoptionReason: NonEmptyStringSchema,
    ocrHumanReview: OcrHumanReviewSchema.optional(),
  })
  .strict();

const ProvenanceShape = {
  electionId: ElectionIdSchema,
  candidateId: CandidateIdSchema,
  sourceId: SourceIdSchema,
  revision: RevisionSchema,
  sourceChecksum: Sha256Schema,
} as const;

export const ProvenanceSchema = z.object(ProvenanceShape).strict();

export const ExtractedSegmentSchema = z
  .object({
    ...ProvenanceShape,
    segmentId: NonEmptyStringSchema,
    locator: LocatorSchema,
    text: NonEmptyStringSchema,
    textSha256: Sha256Schema,
    extractorVersion: NonEmptyStringSchema,
  })
  .strict();

export const PolicyUnitSchema = z
  .object({
    ...ProvenanceShape,
    policyUnitId: NonEmptyStringSchema,
    locator: LocatorSchema,
    originalText: NonEmptyStringSchema,
    originalTextSha256: Sha256Schema,
    segmentId: NonEmptyStringSchema,
    segmenterVersion: NonEmptyStringSchema,
    dataKind: RealAiDataKindSchema,
  })
  .strict();

export type Locator = z.infer<typeof LocatorSchema>;
export type UsageReview = z.infer<typeof UsageReviewSchema>;
export type SourceReference = z.infer<typeof SourceReferenceSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type AdoptionDecision = z.infer<typeof AdoptionDecisionSchema>;
export type OcrHumanReview = z.infer<typeof OcrHumanReviewSchema>;
export type SourceManifestRecord = z.infer<typeof SourceManifestRecordSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ExtractedSegment = z.infer<typeof ExtractedSegmentSchema>;
export type PolicyUnit = z.infer<typeof PolicyUnitSchema>;
