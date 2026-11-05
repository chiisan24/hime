import { z } from "zod";

import { ModelIdsSchema, PromptVersionsSchema } from "./artifacts.js";
import { StructuredPolicySchema } from "./policy.js";
import {
  ISOInstantSchema,
  NonEmptyStringSchema,
  Sha256Schema,
} from "./primitives.js";
import { EstimatedCostSchema } from "./runs.js";
import { LocatorSchema, ProvenanceSchema } from "./sources.js";

export const EVALUATION_CATEGORIES = [
  "CONDITION",
  "NEGATION",
  "STAGE",
  "DEADLINE",
  "MEANING_CHANGE",
  "UNSUPPORTED_ADDITION",
  "INSUFFICIENT_EVIDENCE",
] as const;
export const EvaluationCategorySchema = z.enum(EVALUATION_CATEGORIES);

export const EvaluationExpectationSchema = z
  .object({
    citation: NonEmptyStringSchema,
    structured: StructuredPolicySchema,
    publishable: z.boolean(),
    categories: z.array(EvaluationCategorySchema).readonly(),
  })
  .strict();

export const EvaluationReviewerResultSchema = z
  .object({
    reviewerId: NonEmptyStringSchema,
    matchedOriginal: z.boolean(),
    fieldResults: z.record(z.string(), z.boolean()).readonly(),
  })
  .strict();

export const EvaluationExampleSchema = z
  .object({
    ...ProvenanceSchema.shape,
    exampleId: NonEmptyStringSchema,
    locator: LocatorSchema,
    expected: EvaluationExpectationSchema,
    reviewerResults: z.array(EvaluationReviewerResultSchema).readonly(),
  })
  .strict();

export const EvaluationDatasetSchema = z
  .object({
    datasetVersion: NonEmptyStringSchema,
    createdAt: ISOInstantSchema,
    examples: z.array(EvaluationExampleSchema).readonly(),
    artifactSetId: NonEmptyStringSchema,
    generationModelId: NonEmptyStringSchema,
    promptVersion: NonEmptyStringSchema,
    retrievalConfigHash: Sha256Schema,
  })
  .strict();

export const RateMetricSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    value: z.number().finite().nullable(),
    unavailableReason: z.literal("ZERO_DENOMINATOR").nullable(),
  })
  .strict();

export const EVALUATION_MODES = [
  "WITH_VERIFICATION",
  "WITHOUT_VERIFICATION",
] as const;
export const EvaluationModeSchema = z.enum(EVALUATION_MODES);

export const ExcludedEvaluationExampleSchema = z
  .object({
    exampleId: NonEmptyStringSchema,
    reasons: z.array(NonEmptyStringSchema).readonly(),
  })
  .strict();

export const EvaluationConfigurationSchema = z
  .object({
    modelIds: ModelIdsSchema,
    awsRegion: NonEmptyStringSchema,
    promptVersions: PromptVersionsSchema,
    retrievalConfigHash: Sha256Schema,
  })
  .strict();

export const EvaluationResultSchema = z
  .object({
    evaluationId: NonEmptyStringSchema,
    datasetVersion: NonEmptyStringSchema,
    mode: EvaluationModeSchema,
    metrics: z.record(z.string(), RateMetricSchema).readonly(),
    excludedExamples: z.array(ExcludedEvaluationExampleSchema).readonly(),
    startedAt: ISOInstantSchema,
    endedAt: ISOInstantSchema,
    durationMs: z.number().int().nonnegative(),
    estimatedCost: EstimatedCostSchema.nullable(),
    configuration: EvaluationConfigurationSchema,
  })
  .strict()
  .refine(({ startedAt, endedAt, durationMs }) => {
    const difference = Date.parse(endedAt) - Date.parse(startedAt);
    return difference >= 0 && durationMs === difference;
  }, {
    message: "durationMs must equal endedAt minus startedAt",
    path: ["durationMs"],
  });

export type EvaluationCategory = z.infer<typeof EvaluationCategorySchema>;
export type EvaluationExpectation = z.infer<
  typeof EvaluationExpectationSchema
>;
export type EvaluationReviewerResult = z.infer<
  typeof EvaluationReviewerResultSchema
>;
export type EvaluationExample = z.infer<typeof EvaluationExampleSchema>;
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;
export type RateMetric = z.infer<typeof RateMetricSchema>;
export type EvaluationMode = z.infer<typeof EvaluationModeSchema>;
export type ExcludedEvaluationExample = z.infer<
  typeof ExcludedEvaluationExampleSchema
>;
export type EvaluationConfiguration = z.infer<
  typeof EvaluationConfigurationSchema
>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
