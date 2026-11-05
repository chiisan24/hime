import { z } from "zod";

import { ModelIdsSchema, PromptVersionsSchema } from "./artifacts.js";
import {
  ErrorClassificationSchema,
  ISOInstantSchema,
  NonEmptyStringSchema,
  RealAiDataKindSchema,
  RunIdSchema,
  Sha256Schema,
} from "./primitives.js";
import { RetrievalConfigSchema } from "./retrieval.js";
import { ProvenanceSchema } from "./sources.js";

export const RUN_STAGE_NAMES = [
  "INGESTION",
  "SEGMENTATION",
  "RETRIEVAL",
  "STRUCTURED_EXTRACTION",
  "SUMMARY",
  "DETERMINISTIC_VERIFICATION",
  "SEMANTIC_VERIFICATION",
] as const;
export const RunStageNameSchema = z.enum(RUN_STAGE_NAMES);

export const RUN_STAGE_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
] as const;
export const RunStageStatusSchema = z.enum(RUN_STAGE_STATUSES);

export const RUN_LIFECYCLE_CODES = [
  "RUN_INTERRUPTED",
  "CANCELLED_BEFORE_START",
] as const;
export const RunLifecycleCodeSchema = z.enum(RUN_LIFECYCLE_CODES);

const RunStageCommonShape = {
  status: RunStageStatusSchema,
  startedAt: ISOInstantSchema.nullable(),
  endedAt: ISOInstantSchema.nullable(),
  resultArtifactIds: z.array(NonEmptyStringSchema).readonly(),
  errorClassification: ErrorClassificationSchema.nullable(),
  lifecycleCode: RunLifecycleCodeSchema.nullable(),
  safeReason: NonEmptyStringSchema.nullable(),
} as const;

function createRunStageSchema<
  const TName extends (typeof RUN_STAGE_NAMES)[number],
  const TOrdinal extends 1 | 2 | 3 | 4 | 5 | 6 | 7,
>(name: TName, ordinal: TOrdinal) {
  return z
    .object({
      name: z.literal(name),
      ordinal: z.literal(ordinal),
      ...RunStageCommonShape,
    })
    .strict();
}

export const IngestionRunStageSchema = createRunStageSchema("INGESTION", 1);
export const SegmentationRunStageSchema = createRunStageSchema(
  "SEGMENTATION",
  2,
);
export const RetrievalRunStageSchema = createRunStageSchema("RETRIEVAL", 3);
export const StructuredExtractionRunStageSchema = createRunStageSchema(
  "STRUCTURED_EXTRACTION",
  4,
);
export const SummaryRunStageSchema = createRunStageSchema("SUMMARY", 5);
export const DeterministicVerificationRunStageSchema = createRunStageSchema(
  "DETERMINISTIC_VERIFICATION",
  6,
);
export const SemanticVerificationRunStageSchema = createRunStageSchema(
  "SEMANTIC_VERIFICATION",
  7,
);

export const RunStageSchema = z.discriminatedUnion("name", [
  IngestionRunStageSchema,
  SegmentationRunStageSchema,
  RetrievalRunStageSchema,
  StructuredExtractionRunStageSchema,
  SummaryRunStageSchema,
  DeterministicVerificationRunStageSchema,
  SemanticVerificationRunStageSchema,
]);

export const RunStagesSchema = z
  .tuple([
    IngestionRunStageSchema,
    SegmentationRunStageSchema,
    RetrievalRunStageSchema,
    StructuredExtractionRunStageSchema,
    SummaryRunStageSchema,
    DeterministicVerificationRunStageSchema,
    SemanticVerificationRunStageSchema,
  ])
  .superRefine((stages, context) => {
    const runningCount = stages.filter(({ status }) => status === "RUNNING").length;
    if (runningCount > 1) {
      context.addIssue({
        code: "custom",
        message: "At most one run stage may be RUNNING",
      });
    }

    const firstFailedIndex = stages.findIndex(({ status }) => status === "FAILED");
    if (firstFailedIndex >= 0) {
      for (let index = firstFailedIndex + 1; index < stages.length; index += 1) {
        if (stages[index]?.status !== "SKIPPED") {
          context.addIssue({
            code: "custom",
            message: "Every stage after a failed stage must be SKIPPED",
            path: [index, "status"],
          });
        }
      }
    }

    let previousEnd = Number.NEGATIVE_INFINITY;
    stages.forEach((stage, index) => {
      const start = stage.startedAt === null ? null : Date.parse(stage.startedAt);
      const end = stage.endedAt === null ? null : Date.parse(stage.endedAt);
      if (start !== null && end !== null && end < start) {
        context.addIssue({
          code: "custom",
          message: "Stage end must not precede stage start",
          path: [index, "endedAt"],
        });
      }
      if (start !== null && start < previousEnd) {
        context.addIssue({
          code: "custom",
          message: "A stage must not start before the preceding completed stage ends",
          path: [index, "startedAt"],
        });
      }
      if (end !== null) {
        previousEnd = Math.max(previousEnd, end);
      }
    });
  });

export const MODEL_REQUEST_PURPOSES = [
  "GENERATION",
  "SUMMARY",
  "VERIFICATION",
  "EMBEDDING",
] as const;
export const ModelRequestPurposeSchema = z.enum(MODEL_REQUEST_PURPOSES);

export const ModelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
    unit: z.literal("TOKENS"),
    unavailableReason: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const EstimatedCostSchema = z
  .object({
    currency: NonEmptyStringSchema,
    amount: NonEmptyStringSchema,
  })
  .strict();

export const ModelRequestCostSchema = z
  .object({
    requestId: NonEmptyStringSchema,
    purpose: ModelRequestPurposeSchema,
    modelId: NonEmptyStringSchema,
    attempt: z.number().int().positive(),
    startedAt: ISOInstantSchema,
    endedAt: ISOInstantSchema,
    usage: ModelUsageSchema,
    priceTableVersion: NonEmptyStringSchema,
    formula: NonEmptyStringSchema.nullable(),
    estimatedCost: EstimatedCostSchema.nullable(),
    unavailableReason: NonEmptyStringSchema.nullable(),
  })
  .strict()
  .refine(({ startedAt, endedAt }) => Date.parse(endedAt) >= Date.parse(startedAt), {
    message: "endedAt must not precede startedAt",
    path: ["endedAt"],
  });

export const ANALYSIS_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;
export const AnalysisRunStatusSchema = z.enum(ANALYSIS_RUN_STATUSES);

export const AnalysisRunSchema = z
  .object({
    ...ProvenanceSchema.shape,
    runId: RunIdSchema,
    dataKind: RealAiDataKindSchema,
    dedupeKey: Sha256Schema,
    status: AnalysisRunStatusSchema,
    stages: RunStagesSchema,
    promptVersions: PromptVersionsSchema,
    modelIds: ModelIdsSchema,
    awsProfile: NonEmptyStringSchema,
    awsRegion: NonEmptyStringSchema,
    crossRegionInference: z.literal(false),
    retrievalConfig: RetrievalConfigSchema,
    retrievalConfigHash: Sha256Schema,
    priceTableVersion: NonEmptyStringSchema,
    createdAt: ISOInstantSchema,
    startedAt: ISOInstantSchema.nullable(),
    endedAt: ISOInstantSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    requests: z.array(ModelRequestCostSchema).readonly(),
    safeDiagnostics: z.array(NonEmptyStringSchema).readonly(),
  })
  .strict()
  .superRefine(({ createdAt, startedAt, endedAt, durationMs }, context) => {
    const created = Date.parse(createdAt);
    const started = startedAt === null ? null : Date.parse(startedAt);
    const ended = endedAt === null ? null : Date.parse(endedAt);

    if (started !== null && started < created) {
      context.addIssue({
        code: "custom",
        message: "startedAt must not precede createdAt",
        path: ["startedAt"],
      });
    }
    if (ended !== null && started === null) {
      context.addIssue({
        code: "custom",
        message: "endedAt requires startedAt",
        path: ["endedAt"],
      });
    }
    if (started !== null && ended !== null) {
      const expectedDuration = ended - started;
      if (expectedDuration < 0) {
        context.addIssue({
          code: "custom",
          message: "endedAt must not precede startedAt",
          path: ["endedAt"],
        });
      }
      if (durationMs !== expectedDuration) {
        context.addIssue({
          code: "custom",
          message: "durationMs must equal endedAt minus startedAt",
          path: ["durationMs"],
        });
      }
    } else if (durationMs !== null) {
      context.addIssue({
        code: "custom",
        message: "durationMs requires both startedAt and endedAt",
        path: ["durationMs"],
      });
    }
  });

export type RunStageName = z.infer<typeof RunStageNameSchema>;
export type RunStageStatus = z.infer<typeof RunStageStatusSchema>;
export type RunLifecycleCode = z.infer<typeof RunLifecycleCodeSchema>;
export type RunStage = z.infer<typeof RunStageSchema>;
export type ModelRequestPurpose = z.infer<typeof ModelRequestPurposeSchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type EstimatedCost = z.infer<typeof EstimatedCostSchema>;
export type ModelRequestCost = z.infer<typeof ModelRequestCostSchema>;
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;

export const RUN_EVENT_SCHEMA_VERSION = 1 as const;

export const RUN_EVENT_TYPES = [
  "RUN_CREATED",
  "RUN_STATUS_RECORDED",
  "RUN_STAGE_RECORDED",
  "MODEL_REQUEST_RECORDED",
  "SAFE_DIAGNOSTIC_RECORDED",
] as const;
export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES);

export const RunCreatedEventPayloadSchema = z
  .object({
    type: z.literal("RUN_CREATED"),
    run: AnalysisRunSchema,
  })
  .strict();

export const RunStatusRecordedEventPayloadSchema = z
  .object({
    type: z.literal("RUN_STATUS_RECORDED"),
    status: AnalysisRunStatusSchema,
    startedAt: ISOInstantSchema.nullable(),
    endedAt: ISOInstantSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const RunStageRecordedEventPayloadSchema = z
  .object({
    type: z.literal("RUN_STAGE_RECORDED"),
    stage: RunStageSchema,
  })
  .strict();

export const ModelRequestRecordedEventPayloadSchema = z
  .object({
    type: z.literal("MODEL_REQUEST_RECORDED"),
    request: ModelRequestCostSchema,
  })
  .strict();

export const SafeDiagnosticRecordedEventPayloadSchema = z
  .object({
    type: z.literal("SAFE_DIAGNOSTIC_RECORDED"),
    diagnostic: NonEmptyStringSchema,
  })
  .strict();

export const RunEventPayloadSchema = z.discriminatedUnion("type", [
  RunCreatedEventPayloadSchema,
  RunStatusRecordedEventPayloadSchema,
  RunStageRecordedEventPayloadSchema,
  ModelRequestRecordedEventPayloadSchema,
  SafeDiagnosticRecordedEventPayloadSchema,
]);

const RunEventAppendShape = {
  runId: RunIdSchema,
  occurredAt: ISOInstantSchema,
  payload: RunEventPayloadSchema,
} as const;

function requireCreatedRunIdMatch(
  event: { runId: string; payload: z.infer<typeof RunEventPayloadSchema> },
  context: z.core.$RefinementCtx,
): void {
  if (
    event.payload.type === "RUN_CREATED" &&
    event.payload.run.runId !== event.runId
  ) {
    context.addIssue({
      code: "custom",
      message: "A RUN_CREATED payload must use the envelope runId",
      path: ["payload", "run", "runId"],
    });
  }
}

export const RunEventAppendSchema = z
  .object(RunEventAppendShape)
  .strict()
  .superRefine(requireCreatedRunIdMatch);

export const RunEventContentSchema = z
  .object({
    schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
    sequence: z.number().int().positive(),
    previousEventHash: Sha256Schema.nullable(),
    ...RunEventAppendShape,
  })
  .strict()
  .superRefine(requireCreatedRunIdMatch);

export const RunEventSchema = z
  .object({
    schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
    sequence: z.number().int().positive(),
    previousEventHash: Sha256Schema.nullable(),
    ...RunEventAppendShape,
    eventHash: Sha256Schema,
  })
  .strict()
  .superRefine(requireCreatedRunIdMatch);

export type RunEventType = z.infer<typeof RunEventTypeSchema>;
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>;
export type RunEventAppend = z.infer<typeof RunEventAppendSchema>;
export type RunEventContent = z.infer<typeof RunEventContentSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
