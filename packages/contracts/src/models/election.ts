import { z } from "zod";

import {
  CandidateIdSchema,
  ElectionIdSchema,
  ISODateSchema,
  NonEmptyStringSchema,
  SourceIdSchema,
} from "./primitives.js";

export const TARGET_ELECTION_ID = "ehime-governor-2022-20" as const;
export const TARGET_ELECTION_NAME =
  "令和4年（2022年）第20回愛媛県知事選挙" as const;

export const ElectionSchema = z
  .object({
    electionId: z.literal(TARGET_ELECTION_ID).brand<"ElectionId">(),
    name: z.literal(TARGET_ELECTION_NAME),
    electionDate: z.literal("2022-11-20").brand<"ISODate">(),
    timeZone: z.literal("Asia/Tokyo"),
    sourceIds: z.array(SourceIdSchema).readonly(),
    lastUpdated: ISODateSchema,
  })
  .strict();

export const CandidateNameEvidenceSchema = z
  .object({
    displayedName: NonEmptyStringSchema,
    sourceSpelling: NonEmptyStringSchema,
    sourceId: SourceIdSchema,
  })
  .strict();

export const CandidateResultSchema = z
  .object({
    votes: z.number().int().nonnegative(),
    sourceId: SourceIdSchema,
  })
  .strict();

export const ConfirmedCandidatePhotoSchema = z
  .object({
    kind: z.literal("confirmed"),
    localAssetId: NonEmptyStringSchema,
    sourceId: SourceIdSchema,
    usageStatus: z.literal("CONFIRMED"),
  })
  .strict();

export const PlaceholderCandidatePhotoSchema = z
  .object({
    kind: z.literal("placeholder"),
    placeholderId: z.literal("neutral-person-placeholder"),
  })
  .strict();

export const CandidatePhotoSchema = z.discriminatedUnion("kind", [
  ConfirmedCandidatePhotoSchema,
  PlaceholderCandidatePhotoSchema,
]);

export const CandidateSchema = z
  .object({
    candidateId: CandidateIdSchema,
    electionId: ElectionIdSchema,
    canonicalName: z.enum(["中村時広", "林紀子"]),
    nameEvidence: z.array(CandidateNameEvidenceSchema).readonly(),
    affiliation: NonEmptyStringSchema.nullable(),
    result: CandidateResultSchema.nullable(),
    career: z.array(NonEmptyStringSchema).readonly().nullable(),
    sourceIds: z.array(SourceIdSchema).readonly(),
    lastUpdated: ISODateSchema,
    photo: CandidatePhotoSchema,
  })
  .strict();

export type Election = z.infer<typeof ElectionSchema>;
export type CandidateNameEvidence = z.infer<typeof CandidateNameEvidenceSchema>;
export type CandidateResult = z.infer<typeof CandidateResultSchema>;
export type CandidatePhoto = z.infer<typeof CandidatePhotoSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
