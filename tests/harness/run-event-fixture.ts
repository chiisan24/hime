import {
  AnalysisRunSchema,
  RunEventAppendSchema,
  type AnalysisRun,
  type RunEventAppend,
  type RunEventPayload,
} from "@ehime-vote-navigator/contracts";

export const RUN_EVENT_FIXTURE_HASH_A = "a".repeat(64);
export const RUN_EVENT_FIXTURE_HASH_B = "b".repeat(64);
export const RUN_EVENT_FIXTURE_CREATED_AT = "2026-01-01T00:00:00.000Z";
export const RUN_EVENT_FIXTURE_STARTED_AT = "2026-01-01T00:00:01.000Z";
export const RUN_EVENT_FIXTURE_ENDED_AT = "2026-01-01T00:00:02.000Z";

export function createPendingAnalysisRun(
  runId = "run-event-fixture-1",
): AnalysisRun {
  return AnalysisRunSchema.parse({
    electionId: "election-fixture",
    candidateId: "candidate-fixture",
    sourceId: "source-fixture",
    revision: "revision-fixture-1",
    sourceChecksum: RUN_EVENT_FIXTURE_HASH_A,
    runId,
    dataKind: "REAL_AI",
    dedupeKey: RUN_EVENT_FIXTURE_HASH_B,
    status: "QUEUED",
    stages: [
      { name: "INGESTION", ordinal: 1 },
      { name: "SEGMENTATION", ordinal: 2 },
      { name: "RETRIEVAL", ordinal: 3 },
      { name: "STRUCTURED_EXTRACTION", ordinal: 4 },
      { name: "SUMMARY", ordinal: 5 },
      { name: "DETERMINISTIC_VERIFICATION", ordinal: 6 },
      { name: "SEMANTIC_VERIFICATION", ordinal: 7 },
    ].map(({ name, ordinal }) => ({
      name,
      ordinal,
      status: "PENDING",
      startedAt: null,
      endedAt: null,
      resultArtifactIds: [],
      errorClassification: null,
      lifecycleCode: null,
      safeReason: null,
    })),
    promptVersions: {
      extraction: "extraction-fixture-v1",
      summary: "summary-fixture-v1",
      semantic: "semantic-fixture-v1",
    },
    modelIds: {
      generation: "generation-fixture-model",
      verification: "verification-fixture-model",
      embedding: "embedding-fixture-model",
    },
    awsProfile: "default",
    awsRegion: "ap-northeast-1",
    crossRegionInference: false,
    retrievalConfig: {
      version: "retrieval-fixture-v1",
      normalizerVersion: "normalizer-fixture-v1",
      ngramSizes: [2, 3],
      bm25: { k1: 1.2, b: 0.75 },
      keywordThreshold: 0,
      cosineThreshold: 0,
      thresholdInclusive: true,
      rrfK: 60,
      topK: 5,
      tieBreak: [
        "rrf-desc",
        "keyword-desc",
        "cosine-desc",
        "policy-unit-key-asc",
      ],
    },
    retrievalConfigHash: RUN_EVENT_FIXTURE_HASH_A,
    priceTableVersion: "pricing-fixture-v1",
    createdAt: RUN_EVENT_FIXTURE_CREATED_AT,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    requests: [],
    safeDiagnostics: [],
  });
}

export function createRunEventAppend(
  payload: RunEventPayload,
  occurredAt = RUN_EVENT_FIXTURE_CREATED_AT,
  runId = "run-event-fixture-1",
): RunEventAppend {
  return RunEventAppendSchema.parse({ runId, occurredAt, payload });
}
