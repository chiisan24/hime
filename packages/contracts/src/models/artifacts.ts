import { z } from "zod";

import {
  ArtifactIdSchema,
  AutomaticStatusSchema,
  HumanStatusSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
  RunIdSchema,
  Sha256Schema,
} from "./primitives.js";
import { CitationSchema, StructuredPolicySchema } from "./policy.js";
import { ProvenanceSchema } from "./sources.js";
import {
  DeterministicCheckSchema,
  SemanticCheckSchema,
} from "./verification.js";

const BeginnerSummarySchema = NonEmptyStringSchema.refine(
  (value) => Array.from(value).length <= 300,
  "Must contain no more than 300 Unicode code points",
);

export const PromptVersionsSchema = z
  .object({
    extraction: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    semantic: NonEmptyStringSchema,
  })
  .strict();

export const ModelIdsSchema = z
  .object({
    generation: NonEmptyStringSchema,
    verification: NonEmptyStringSchema,
    embedding: NonEmptyStringSchema,
  })
  .strict();

export const AiArtifactSchema = z
  .object({
    ...ProvenanceSchema.shape,
    artifactId: ArtifactIdSchema,
    dataKind: RealAiDataKindSchema,
    runId: RunIdSchema,
    policyUnitId: NonEmptyStringSchema,
    structured: StructuredPolicySchema,
    beginnerSummary: BeginnerSummarySchema,
    citations: z.array(CitationSchema).readonly(),
    deterministicChecks: z.array(DeterministicCheckSchema).readonly(),
    semanticCheck: SemanticCheckSchema,
    automaticStatus: AutomaticStatusSchema,
    humanStatus: HumanStatusSchema,
    promptVersions: PromptVersionsSchema,
    modelIds: ModelIdsSchema,
    artifactContentHash: Sha256Schema,
    createdAt: ISOInstantSchema,
  })
  .strict();

export type PromptVersions = z.infer<typeof PromptVersionsSchema>;
export type ModelIds = z.infer<typeof ModelIdsSchema>;
export type AiArtifact = z.infer<typeof AiArtifactSchema>;
