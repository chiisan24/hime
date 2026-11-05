import { z } from "zod";

import {
  CandidateIdSchema,
  ElectionIdSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  Sha256Schema,
} from "./primitives.js";
import { LocatorSchema, ProvenanceSchema } from "./sources.js";

export const RetrievalFilterSchema = z
  .object({
    electionId: ElectionIdSchema,
    candidateId: CandidateIdSchema,
    revision: RevisionSchema,
  })
  .strict();

export const RetrievalConfigSchema = z
  .object({
    version: NonEmptyStringSchema,
    normalizerVersion: NonEmptyStringSchema,
    ngramSizes: z.tuple([z.literal(2), z.literal(3)]).readonly(),
    bm25: z
      .object({
        k1: z.literal(1.2),
        b: z.literal(0.75),
      })
      .strict(),
    keywordThreshold: z.number().finite(),
    cosineThreshold: z.number().finite(),
    thresholdInclusive: z.literal(true),
    rrfK: z.literal(60),
    topK: z.number().int().positive(),
    tieBreak: z
      .tuple([
        z.literal("rrf-desc"),
        z.literal("keyword-desc"),
        z.literal("cosine-desc"),
        z.literal("policy-unit-key-asc"),
      ])
      .readonly(),
  })
  .strict();

export const RetrievalHitSchema = z
  .object({
    ...ProvenanceSchema.shape,
    policyUnitId: NonEmptyStringSchema,
    policyUnitKey: NonEmptyStringSchema,
    locator: LocatorSchema,
    originalText: NonEmptyStringSchema,
    keywordScore: z.number().finite().nullable(),
    keywordRank: z.number().int().positive().nullable(),
    cosineSimilarity: z.number().finite().nullable(),
    semanticRank: z.number().int().positive().nullable(),
    rrfScore: z.number().finite().nonnegative(),
    finalRank: z.number().int().positive(),
    retrievalConfigHash: Sha256Schema,
    embeddingModelId: NonEmptyStringSchema,
  })
  .strict();

export type RetrievalFilter = z.infer<typeof RetrievalFilterSchema>;
export type RetrievalConfig = z.infer<typeof RetrievalConfigSchema>;
export type PolicyUnitKey = string;
export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;
